import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { ActionProposal, AutomationJob, Conversation, ConversationMessage, ConversationRead, ConversationType, Task } from '../models.js';
import { pageLatestByCreatedAt } from '../pagination.js';
import { DEFAULT_CONVERSATION_TYPE_ID, conversationTypeDto, defaultConversationType } from '../conversation-workflows.js';
import { DomainError, type Actor, type Service } from '../service.js';

function ensure(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(message, status);
}

function conversationDto(item: any, unread?: { count: number; cursor: string | null }, workflow?: any, includeStages = false) {
  const resolvedWorkflow = workflow ?? item.conversationTypeSnapshot ?? defaultConversationType(item.projectId);
  const conversationType = {
    _id: resolvedWorkflow._id ?? resolvedWorkflow.typeId ?? DEFAULT_CONVERSATION_TYPE_ID,
    name: resolvedWorkflow.name ?? 'Geral', version: resolvedWorkflow.version ?? 0,
    isDefault: resolvedWorkflow.isDefault ?? false,
    ...(includeStages ? { description: resolvedWorkflow.description ?? '', stages: resolvedWorkflow.stages ?? [] } : {})
  };
  return {
    _id: item._id, projectId: item.projectId, taskId: item.taskId ?? null, title: item.title,
    conversationTypeId: item.conversationTypeId ?? conversationType._id, conversationType,
    status: item.status, version: item.version, createdAt: item.createdAt,
    updatedAt: item.updatedAt, lastMessageAt: item.lastMessageAt ?? null,
    ...(unread ? { unread } : {})
  };
}

function messageCursor(message: any) {
  return `${new Date(message.createdAt).toISOString()}|${message._id}`;
}

function cursorPoint(value?: string | null) {
  if (!value) return null;
  const separator = value.indexOf('|');
  if (separator < 0) return null;
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  return Number.isFinite(createdAt.getTime()) && id ? { createdAt, id } : null;
}

function messageDto(item: any) {
  return { _id: item._id, conversationId: item.conversationId, author: item.author, authorType: item.authorType, clientName: item.clientName ?? null, content: item.content, createdAt: item.createdAt };
}

function proposalDto(item: any, currentTaskVersion?: number) {
  return {
    _id: item._id, conversationId: item.conversationId, taskId: item.taskId,
    expectedTaskVersion: item.expectedTaskVersion, approvedTaskVersion: item.approvedTaskVersion ?? null,
    title: item.title, summary: item.summary, taskPatch: item.taskPatch, provider: item.provider ?? null,
    status: item.status, version: item.version, createdBy: item.createdBy,
    approvedBy: item.approvedBy ?? null, approvedAt: item.approvedAt ?? null,
    jobId: item.jobId ?? null, stale: item.status === 'pending' && currentTaskVersion !== undefined && currentTaskVersion !== item.expectedTaskVersion,
    createdAt: item.createdAt, updatedAt: item.updatedAt
  };
}

export class ConversationService {
  constructor(private service: Service) {}

  private requireTypeManager(actor: Actor) {
    ensure(actor.scope === 'human' || actor.scope === 'trusted_local', 'Human access required to manage conversation types', 403);
  }

  private async workflowFor(projectId: string, typeId: string | undefined, session?: ClientSession, includeArchived = false) {
    if (!typeId || typeId === DEFAULT_CONVERSATION_TYPE_ID) return defaultConversationType(projectId);
    let query = ConversationType.findOne({ _id: typeId, projectId, ...(includeArchived ? {} : { archived: false }) });
    if (session) query = query.session(session) as typeof query;
    const item = await query.lean();
    ensure(item, 'Conversation type not found or archived', 404);
    return conversationTypeDto(item);
  }

  private async workflowForConversation(conversation: any) {
    if (conversation.conversationTypeSnapshot) return conversation.conversationTypeSnapshot;
    if (!conversation.conversationTypeId || conversation.conversationTypeId === DEFAULT_CONVERSATION_TYPE_ID) return defaultConversationType(conversation.projectId);
    const item = await ConversationType.findOne({ _id: conversation.conversationTypeId, projectId: conversation.projectId }).lean();
    return item ? conversationTypeDto(item) : defaultConversationType(conversation.projectId);
  }

  private typeNameKey(name: string) {
    return name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
  }

  private async ensureTypeNameAvailable(projectId: string, name: string, session: ClientSession, excludeId?: string) {
    const nameKey = this.typeNameKey(name);
    ensure(nameKey !== 'geral', 'The built-in conversation type name is reserved', 409);
    const exists = await ConversationType.exists({ projectId, nameKey, archived: false, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).session(session);
    ensure(!exists, 'Conversation type name already exists', 409);
  }

  async listTypes(_actor: Actor, a: any) {
    const items = await ConversationType.find({ projectId: a.projectId }).sort({ archived: 1, nameKey: 1, _id: 1 }).lean();
    return { items: [conversationTypeDto(defaultConversationType(a.projectId)), ...items.map(conversationTypeDto)] };
  }

  async getType(_actor: Actor, a: any) {
    if (a.typeId === DEFAULT_CONVERSATION_TYPE_ID) return conversationTypeDto(defaultConversationType(a.projectId));
    const item = await ConversationType.findOne({ _id: a.typeId, projectId: a.projectId }).lean();
    ensure(item, 'Conversation type not found', 404);
    return conversationTypeDto(item);
  }

  async createType(actor: Actor, a: any) {
    this.requireTypeManager(actor);
    return this.service.mutate(actor, 'create_conversation_type', a, async (session: ClientSession) => {
      await this.ensureTypeNameAvailable(a.projectId, a.data.name, session);
      const type = new ConversationType({ _id: randomUUID(), projectId: a.projectId, ...a.data, nameKey: this.typeNameKey(a.data.name) });
      try { await type.save({ session }); }
      catch (error: any) { if (error?.code === 11000) throw new DomainError('Conversation type name already exists', 409); throw error; }
      await this.service.event(session, actor, 'create_conversation_type', a.projectId, type._id!, { typeId: type._id, name: type.name, version: type.version });
      return conversationTypeDto(type);
    }, false);
  }

  async updateType(actor: Actor, a: any) {
    this.requireTypeManager(actor);
    return this.service.mutate(actor, 'update_conversation_type', a, async (session: ClientSession) => {
      const type = await ConversationType.findOne({ _id: a.typeId, projectId: a.projectId, archived: false }).session(session);
      ensure(type, 'Conversation type not found or archived', 404);
      ensure(type.version === a.version, 'Conversation type version conflict');
      await this.ensureTypeNameAvailable(a.projectId, a.data.name, session, a.typeId);
      Object.assign(type, a.data, { nameKey: this.typeNameKey(a.data.name) });
      type.version! += 1;
      try { await type.save({ session }); }
      catch (error: any) { if (error?.code === 11000) throw new DomainError('Conversation type name already exists', 409); throw error; }
      await this.service.event(session, actor, 'update_conversation_type', a.projectId, type._id!, { typeId: type._id, name: type.name, version: type.version });
      return conversationTypeDto(type);
    }, false);
  }

  async duplicateType(actor: Actor, a: any) {
    this.requireTypeManager(actor);
    return this.service.mutate(actor, 'duplicate_conversation_type', a, async (session: ClientSession) => {
      const source = await ConversationType.findOne({ _id: a.sourceTypeId, projectId: a.projectId, archived: false }).session(session);
      ensure(source, 'Conversation type not found or archived', 404);
      ensure(source.version === a.sourceVersion, 'Conversation type version conflict');
      await this.ensureTypeNameAvailable(a.projectId, a.name, session);
      const duplicate = new ConversationType({
        _id: randomUUID(), projectId: a.projectId, name: a.name, nameKey: this.typeNameKey(a.name),
        description: source.description ?? '', stages: JSON.parse(JSON.stringify(source.stages ?? []))
      });
      try { await duplicate.save({ session }); }
      catch (error: any) { if (error?.code === 11000) throw new DomainError('Conversation type name already exists', 409); throw error; }
      await this.service.event(session, actor, 'duplicate_conversation_type', a.projectId, duplicate._id!, { typeId: duplicate._id, sourceTypeId: source._id, name: duplicate.name, version: duplicate.version });
      return conversationTypeDto(duplicate);
    }, false);
  }

  async archiveType(actor: Actor, a: any) {
    this.requireTypeManager(actor);
    return this.service.mutate(actor, 'archive_conversation_type', a, async (session: ClientSession) => {
      const type = await ConversationType.findOne({ _id: a.typeId, projectId: a.projectId, archived: false }).session(session);
      ensure(type, 'Conversation type not found or archived', 404);
      ensure(type.version === a.version, 'Conversation type version conflict');
      type.archived = true;
      type.version! += 1;
      await type.save({ session });
      await this.service.event(session, actor, 'archive_conversation_type', a.projectId, type._id!, { typeId: type._id, name: type.name, version: type.version });
      return conversationTypeDto(type);
    }, false);
  }

  async setType(actor: Actor, a: any) {
    this.requireTypeManager(actor);
    return this.service.mutate(actor, 'set_conversation_type', a, async (session: ClientSession) => {
      const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: 'open' }).session(session);
      ensure(conversation, 'Conversation not found or closed', 404);
      ensure(conversation.version === a.version, 'Conversation version conflict');
      const workflow = await this.workflowFor(a.projectId, a.typeId, session);
      conversation.conversationTypeId = workflow._id;
      conversation.conversationTypeSnapshot = workflow;
      conversation.version! += 1;
      await conversation.save({ session });
      await this.service.event(session, actor, 'set_conversation_type', a.projectId, conversation._id!, {
        conversationId: conversation._id, typeId: workflow._id, typeName: workflow.name, version: conversation.version
      });
      return conversationDto(conversation, undefined, workflow, true);
    }, false);
  }

  private async unreadState(projectId: string, conversationId: string, userId: string) {
    const read = await ConversationRead.findOne({ projectId, conversationId, userId }).select('lastReadCursor').lean();
    const point = cursorPoint(read?.lastReadCursor);
    const filter: any = { projectId, conversationId, author: { $ne: userId } };
    if (point) filter.$or = [
      { createdAt: { $gt: point.createdAt } },
      { createdAt: point.createdAt, _id: { $gt: point.id } }
    ];
    const [count, latest] = await Promise.all([
      ConversationMessage.countDocuments(filter),
      ConversationMessage.findOne(filter).select('_id').sort({ createdAt: -1, _id: -1 }).lean()
    ]);
    return { count, cursor: latest?._id ?? null };
  }

  async create(actor: Actor, a: any) {
    return this.service.mutate(actor, 'create_conversation', a, async (session: ClientSession) => {
      const workflow = await this.workflowFor(a.projectId, a.typeId, session);
      if (a.taskId) {
        const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).select('_id').session(session).lean();
        ensure(task, 'Task not found', 404);
      }
      const conversation = new Conversation({
        _id: randomUUID(), projectId: a.projectId, taskId: a.taskId, createdBy: actor.userId,
        title: a.title ?? 'Nova conversa', conversationTypeId: workflow._id, conversationTypeSnapshot: workflow
      });
      await conversation.save({ session });
      await this.service.event(session, actor, 'create_conversation', a.projectId, conversation._id!, { conversationId: conversation._id, taskId: conversation.taskId ?? null, typeId: workflow._id });
      return conversationDto(conversation, undefined, workflow, true);
    }, false, false);
  }

  async openTask(actor: Actor, a: any) {
    return this.service.mutate(actor, 'open_task_conversation', a, async (session: ClientSession) => {
      const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).select('_id name').session(session).lean();
      ensure(task, 'Task not found', 404);
      const existing = await Conversation.findOne({ projectId: a.projectId, taskId: a.taskId, status: 'open' })
        .sort({ lastMessageAt: -1, createdAt: -1, _id: -1 }).session(session).lean();
      if (existing) return { conversation: conversationDto(existing), created: false };

      const workflow = await this.workflowFor(a.projectId, a.typeId, session);

      const conversation = new Conversation({
        _id: randomUUID(), projectId: a.projectId, taskId: a.taskId,
        createdBy: actor.userId, title: `Task: ${task.name}`,
        conversationTypeId: workflow._id, conversationTypeSnapshot: workflow
      });
      await conversation.save({ session });
      await this.service.event(session, actor, 'open_task_conversation', a.projectId, conversation._id!, {
        conversationId: conversation._id, taskId: a.taskId, typeId: workflow._id
      });
      return { conversation: conversationDto(conversation, undefined, workflow, true), created: true };
    }, false, false);
  }

  async list(actor: Actor, a: any) {
    const page = await pageLatestByCreatedAt<any>(Conversation, { projectId: a.projectId, status: { $ne: 'deleted' } }, a.after, a.limit);
    const items = await Promise.all(page.items.map(async item => {
      const [unread, workflow] = await Promise.all([
        this.unreadState(a.projectId, item._id, actor.userId), this.workflowForConversation(item)
      ]);
      return conversationDto(item, unread, workflow);
    }));
    return { items, next: page.next };
  }

  async get(actor: Actor, a: any) {
    const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: { $ne: 'deleted' } }).lean();
    ensure(conversation, 'Conversation not found', 404);
    const [messagePage, proposals, unread] = await Promise.all([
      pageLatestByCreatedAt<any>(ConversationMessage, { projectId: a.projectId, conversationId: a.conversationId }, a.after, a.limit),
      ActionProposal.find({ projectId: a.projectId, conversationId: a.conversationId }).sort({ createdAt: -1, _id: -1 }).limit(25).lean(),
      this.unreadState(a.projectId, a.conversationId, actor.userId)
    ]);
    const workflow = await this.workflowForConversation(conversation);
    const taskId = conversation.taskId ?? proposals.find(proposal => proposal.status === 'pending')?.taskId;
    const jobIds = proposals.flatMap(proposal => typeof proposal.jobId === 'string' ? [proposal.jobId] : []);
    const [task, jobs] = await Promise.all([
      taskId ? Task.findOne({ _id: taskId, projectId: a.projectId }).select('_id version status name area featureId').lean() : Promise.resolve(null),
      jobIds.length ? AutomationJob.find({ projectId: a.projectId, _id: { $in: jobIds } }).select('_id status error request.title').lean() : Promise.resolve([])
    ]);
    return {
      conversation: conversationDto(conversation, unread, workflow, true),
      messages: messagePage.items.map(messageDto),
      next: messagePage.next,
      proposals: proposals.map(proposal => proposalDto(proposal, task?.version)),
      task: task ? { _id: task._id, version: task.version, status: task.status, name: task.name, area: task.area, featureId: task.featureId ?? null } : null,
      jobs: jobs.map(job => ({ _id: job._id, status: job.status, failed: job.status === 'failed' || Boolean(job.error), permissionTitle: job.status === 'waiting_human' ? job.request?.title ?? null : null }))
    };
  }

  async markRead(actor: Actor, a: any) {
    return this.service.mutate(actor, 'mark_conversation_read', a, async (session: ClientSession) => {
      const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: { $ne: 'deleted' } })
        .select('_id').session(session).lean();
      ensure(conversation, 'Conversation not found', 404);
      const message = await ConversationMessage.findOne({ _id: a.cursor, projectId: a.projectId, conversationId: a.conversationId })
        .select('_id createdAt').session(session).lean();
      ensure(message, 'Conversation message cursor not found', 404);
      await ConversationRead.findOneAndUpdate(
        { projectId: a.projectId, conversationId: a.conversationId, userId: actor.userId },
        { $max: { lastReadCursor: messageCursor(message) } },
        { upsert: true, returnDocument: 'after', session }
      );
      return { projectId: a.projectId, conversationId: a.conversationId, cursor: a.cursor };
    }, false, false);
  }

  async linkTask(actor: Actor, a: any) {
    return this.service.mutate(actor, 'link_conversation_task', a, async (session: ClientSession) => {
      const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: 'open' }).session(session);
      ensure(conversation, 'Conversation not found or closed', 404);
      ensure(conversation.version === a.version, 'Conversation version conflict');
      const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).select('_id').session(session).lean();
      ensure(task, 'Task not found', 404);
      ensure(!conversation.taskId || conversation.taskId === task._id, 'Conversation is already linked to another task');
      const proposal = await ActionProposal.findOne({ projectId: a.projectId, conversationId: a.conversationId, status: 'pending' }).select('taskId').session(session).lean();
      ensure(!proposal || proposal.taskId === task._id, 'Conversation has a pending proposal for another task');
      if (conversation.taskId === task._id) return conversationDto(conversation);
      conversation.taskId = task._id;
      conversation.version! += 1;
      await conversation.save({ session });
      await this.service.event(session, actor, 'link_conversation_task', a.projectId, conversation._id!, {
        conversationId: conversation._id, taskId: task._id, summary: 'Conversa vinculada à tarefa'
      });
      return conversationDto(conversation);
    }, false, false);
  }

  async updateTitle(actor: Actor, a: any) {
    return this.service.mutate(actor, 'update_conversation_title', a, async (session: ClientSession) => {
      const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: 'open' }).session(session);
      ensure(conversation, 'Conversation not found or closed', 404);
      ensure(conversation.version === a.version, 'Conversation version conflict');
      conversation.title = a.title;
      conversation.version! += 1;
      await conversation.save({ session });
      await this.service.event(session, actor, 'update_conversation_title', a.projectId, conversation._id!, {
        conversationId: conversation._id, title: conversation.title, version: conversation.version, summary: 'Título da conversa atualizado'
      });
      return conversationDto(conversation);
    }, false, false);
  }

  async delete(actor: Actor, a: any) {
    return this.service.mutate(actor, 'delete_conversation', a, async (session: ClientSession) => {
      const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId }).session(session);
      ensure(conversation && conversation.status !== 'deleted', 'Conversation not found', 404);
      ensure(conversation.version === a.version, 'Conversation version conflict');
      conversation.status = 'deleted';
      conversation.version! += 1;
      await conversation.save({ session });
      await this.service.event(session, actor, 'delete_conversation', a.projectId, conversation._id!, {
        conversationId: conversation._id, taskId: conversation.taskId ?? null, summary: 'Conversa removida do histórico'
      });
      return { deleted: true, conversationId: conversation._id, version: conversation.version };
    }, false, false);
  }

  async sendMessage(actor: Actor, a: any) {
    return this.service.mutate(actor, 'send_conversation_message', a, async (session: ClientSession) => {
      const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: 'open' }).session(session);
      ensure(conversation, 'Conversation not found or closed', 404);
      if (actor.jobId) {
        ensure(conversation.taskId, 'Runner replies require a task-linked conversation', 403);
        await this.service.automation.guard(actor, 'send_conversation_message', { ...a, taskId: conversation.taskId }, session);
      }
      const authorType = actor.scope === 'agent' ? 'agent' : 'human';
      const clientName = authorType === 'agent' && typeof actor.clientName === 'string' && actor.clientName.trim()
        ? actor.clientName.trim().slice(0, 100)
        : undefined;
      const message = new ConversationMessage({
        _id: randomUUID(), projectId: a.projectId, conversationId: a.conversationId,
        author: actor.userId, authorType, ...(clientName ? { clientName } : {}), senderId: actor.id, operationId: a.operationId,
        content: a.content, createdAt: new Date()
      });
      await message.save({ session });
      const update: Record<string, unknown> = { lastMessageAt: message.createdAt };
      if (conversation.title === 'Nova conversa' && authorType === 'human') update.title = Array.from(a.content.trim()).slice(0, 80).join(' ') || 'Nova conversa';
      conversation.set(update);
      conversation.version! += 1;
      await conversation.save({ session });
      await this.service.event(session, actor, 'conversation_message', a.projectId, message._id!, {
        conversationId: a.conversationId, messageId: message._id, taskId: conversation.taskId,
        authorType, summary: authorType === 'agent' ? 'Resposta da IA na conversa' : 'Nova mensagem na conversa'
      });
      // Keep the idempotency receipt small; content is fetched through get_conversation.
      return { _id: message._id, conversationId: a.conversationId, author: actor.userId, authorType, clientName: clientName ?? null, createdAt: message.createdAt };
    }, false, false);
  }

  async createProposal(actor: Actor, a: any) {
    ensure(actor.scope === 'agent' || actor.scope === 'trusted_local', 'AI agent scope required', 403);
    return this.service.mutate(actor, 'create_action_proposal', a, async (session: ClientSession) => {
      const [conversation, task] = await Promise.all([
        Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: 'open' }).session(session),
        Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(session)
      ]);
      ensure(conversation, 'Conversation not found or closed', 404);
      ensure(task, 'Task not found', 404);
      ensure(task.version === a.expectedTaskVersion && task.status === 'pendente', 'Task version conflict or task is not pending');
      ensure(!conversation.taskId || conversation.taskId === task._id, 'Conversation is linked to another task');
      const pendingProposal = await ActionProposal.findOne({ projectId: a.projectId, conversationId: a.conversationId, status: 'pending' }).select('taskId').session(session).lean();
      ensure(!pendingProposal || pendingProposal.taskId === task._id, 'Conversation already has a proposal for another task');
      const patch = {
        ...(a.instructions !== undefined ? { instructions: a.instructions } : {}),
        ...(a.acceptance !== undefined ? { acceptance: a.acceptance } : {})
      };
      const proposal = new ActionProposal({
        _id: randomUUID(), projectId: a.projectId, conversationId: a.conversationId, taskId: task._id,
        expectedTaskVersion: a.expectedTaskVersion, title: a.title, summary: a.summary,
        taskPatch: patch, provider: a.provider, status: 'pending', createdBy: actor.userId
      });
      await proposal.save({ session });
      conversation.version! += 1;
      await conversation.save({ session });
      await this.service.event(session, actor, 'create_action_proposal', a.projectId, proposal._id!, {
        conversationId: a.conversationId, taskId: task._id, proposalId: proposal._id,
        summary: 'Proposta de execução aguardando aprovação'
      });
      // Keep the idempotency receipt small; the complete proposal is available through get_conversation.
      return { _id: proposal._id, conversationId: proposal.conversationId, taskId: proposal.taskId, expectedTaskVersion: proposal.expectedTaskVersion, status: proposal.status, version: proposal.version };
    }, false, true);
  }
}
