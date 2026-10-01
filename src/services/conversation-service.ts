import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { ActionProposal, AutomationJob, Conversation, ConversationMessage, Task } from '../models.js';
import { pageLatestByCreatedAt } from '../pagination.js';
import { DomainError, type Actor, type Service } from '../service.js';

function ensure(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(message, status);
}

function conversationDto(item: any) {
  return {
    _id: item._id, projectId: item.projectId, taskId: item.taskId ?? null, title: item.title,
    status: item.status, version: item.version, createdAt: item.createdAt,
    updatedAt: item.updatedAt, lastMessageAt: item.lastMessageAt ?? null
  };
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

  async create(actor: Actor, a: any) {
    return this.service.mutate(actor, 'create_conversation', a, async (session: ClientSession) => {
      if (a.taskId) {
        const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).select('_id').session(session).lean();
        ensure(task, 'Task not found', 404);
      }
      const conversation = new Conversation({ _id: randomUUID(), projectId: a.projectId, taskId: a.taskId, createdBy: actor.userId, title: a.title ?? 'Nova conversa' });
      await conversation.save({ session });
      await this.service.event(session, actor, 'create_conversation', a.projectId, conversation._id!, { conversationId: conversation._id, taskId: conversation.taskId ?? null });
      return conversationDto(conversation);
    }, false, false);
  }

  async openTask(actor: Actor, a: any) {
    return this.service.mutate(actor, 'open_task_conversation', a, async (session: ClientSession) => {
      const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).select('_id name').session(session).lean();
      ensure(task, 'Task not found', 404);
      const existing = await Conversation.findOne({ projectId: a.projectId, taskId: a.taskId, status: 'open' })
        .sort({ lastMessageAt: -1, createdAt: -1, _id: -1 }).session(session).lean();
      if (existing) return { conversation: conversationDto(existing), created: false };

      const conversation = new Conversation({
        _id: randomUUID(), projectId: a.projectId, taskId: a.taskId,
        createdBy: actor.userId, title: `Task: ${task.name}`
      });
      await conversation.save({ session });
      await this.service.event(session, actor, 'open_task_conversation', a.projectId, conversation._id!, {
        conversationId: conversation._id, taskId: a.taskId
      });
      return { conversation: conversationDto(conversation), created: true };
    }, false, false);
  }

  async list(a: any) {
    const page = await pageLatestByCreatedAt<any>(Conversation, { projectId: a.projectId, status: { $ne: 'deleted' } }, a.after, a.limit);
    return { items: page.items.map(conversationDto), next: page.next };
  }

  async get(a: any) {
    const conversation = await Conversation.findOne({ _id: a.conversationId, projectId: a.projectId, status: { $ne: 'deleted' } }).lean();
    ensure(conversation, 'Conversation not found', 404);
    const [messagePage, proposals] = await Promise.all([
      pageLatestByCreatedAt<any>(ConversationMessage, { projectId: a.projectId, conversationId: a.conversationId }, a.after, a.limit),
      ActionProposal.find({ projectId: a.projectId, conversationId: a.conversationId }).sort({ createdAt: -1, _id: -1 }).limit(25).lean()
    ]);
    const taskId = conversation.taskId ?? proposals.find(proposal => proposal.status === 'pending')?.taskId;
    const jobIds = proposals.flatMap(proposal => typeof proposal.jobId === 'string' ? [proposal.jobId] : []);
    const [task, jobs] = await Promise.all([
      taskId ? Task.findOne({ _id: taskId, projectId: a.projectId }).select('_id version status name area featureId').lean() : Promise.resolve(null),
      jobIds.length ? AutomationJob.find({ projectId: a.projectId, _id: { $in: jobIds } }).select('_id status error request.title').lean() : Promise.resolve([])
    ]);
    return {
      conversation: conversationDto(conversation),
      messages: messagePage.items.map(messageDto),
      next: messagePage.next,
      proposals: proposals.map(proposal => proposalDto(proposal, task?.version)),
      task: task ? { _id: task._id, version: task.version, status: task.status, name: task.name, area: task.area, featureId: task.featureId ?? null } : null,
      jobs: jobs.map(job => ({ _id: job._id, status: job.status, failed: job.status === 'failed' || Boolean(job.error), permissionTitle: job.status === 'waiting_human' ? job.request?.title ?? null : null }))
    };
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
