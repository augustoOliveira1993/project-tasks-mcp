import mongoose, { type ClientSession, type Model } from 'mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ActionProposal, AutomationPolicy, Project, Feature, Task, Execution, Event, TaskMessage, Conversation, ConversationMessage, DeliveryEvent, DeliveryRead, TaskRead, TaskDiff, AutomationJob, MarkdownDocument, MarkdownRevision, Operation, Credential, Bootstrap } from './db.js';
import type { TaskContextDto } from './contracts.js';
import { pageByCreatedAt, pageByDate, PageCursorError } from './pagination.js';
import { EventHub, readEvents } from './events.js';
import { logger } from './logger.js';
import { validateTaskDependencyGraph } from './services/task-dependency-service.js';
import { getTaskContext } from './services/task-context-service.js';
import { Automation } from './services/automation-service.js';
import { deleteProjectCascade, ProjectDeletionConflict } from './services/project-deletion-service.js';
import { deleteTaskCascade, TaskDeletionConflict } from './services/task-deletion-service.js';
import { ConversationService } from './services/conversation-service.js';
import { tools, adminSchema, approveActionProposalSchema, approveTasksSchema, changeTaskStatusSchema, setTaskAcceptanceCriterionSchema, setTaskCheckedSchema, projectData, featureData, taskData, states, userId as userIdSchema } from './schema.js';

export class DomainError extends Error { constructor(message: string, public status = 409) { super(message); } }
export type Actor = { id: string; userId: string; scope: string; systemAdmin: boolean; projectToken?: string; sessionId?: string; jobId?: string; runnerId?: string; clientName?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const projectDto = (project: any) => ({
  _id: project._id, version: project.version, archived: project.archived, name: project.name,
  description: project.description, instructions: project.instructions, visibility: project.visibility,
  repositories: project.repositories, createdAt: project.createdAt, updatedAt: project.updatedAt
});
const memberKey = (userId: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(userId) ? userId : 'email_' + hash(userId.toLowerCase()).slice(0, 32);
const projectTaskReadKey = '__project_baseline__';
function normalizeWorkspaceRoot(value: string) {
  let root = value.trim();
  if (/^file:/i.test(root)) {
    try { root = decodeURIComponent(new URL(root).pathname); } catch { }
  }
  root = root.replaceAll('\\', '/').replace(/^\/([a-z]:\/)/i, '$1').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(root) ? root.toLowerCase() : root;
}
function normalizeGitRemote(value: string) {
  return value.trim().replace(/^git@([^:]+):/i, '$1/').replace(/^(?:https?|ssh):\/\//i, '').replace(/^git@/i, '').replace(/\.git\/?$/i, '').replace(/\/+$/, '').toLowerCase();
}
function requireThat(value: unknown, message: string, status = 409): asserts value { if (!value) throw new DomainError(message, status); }
const models: Record<string, Model<any>> = { project: Project, feature: Feature, task: Task };
export async function authenticate(token: string, scope: string): Promise<Actor> {
  const c = await Credential.findOne({ hash: hash(token), revoked: false, scope }).lean();
  requireThat(c, 'Invalid credential or scope', 401);
  return { id: c._id!, userId: c.userId!, scope: c.scope!, systemAdmin: !!c.systemAdmin };
}
export async function authenticateAny(token: string): Promise<Actor> {
  const c = await Credential.findOne({ hash: hash(token), revoked: false }).lean();
  requireThat(c, 'Invalid credential', 401);
  return { id: c._id!, userId: c.userId!, scope: c.scope!, systemAdmin: !!c.systemAdmin };
}
export function trustedLocal(email: string, projectToken?: string): Actor {
  const normalized = email.trim().toLowerCase();
  requireThat(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized), 'X-Project-Tasks-Email must be a valid email', 401);
  return { id: 'trusted:' + memberKey(normalized), userId: normalized, scope: 'trusted_local', systemAdmin: false, projectToken };
}
export async function bootstrap(userId: string) {
  userIdSchema.parse(userId);
  const token = randomBytes(32).toString('hex');
  await mongoose.connection.transaction(async s => {
    await Bootstrap.create([{ _id: 'initial-admin' }], { session: s });
    const credentialId = randomUUID();
    await Credential.create([{ _id: credentialId, userId, hash: hash(token), scope: 'human', systemAdmin: true }], { session: s });
    await Event.create([{ _id: randomUUID(), entityId: credentialId, action: 'bootstrap', author: userId, at: new Date() }], { session: s });
  });
  return token;
}
export async function recoverHumanToken(userId: string) {
  userIdSchema.parse(userId);
  const token = randomBytes(32).toString('hex');
  await mongoose.connection.transaction(async s => {
    const credentials = await Credential.find({ userId, scope: 'human', revoked: false }).session(s).lean();
    requireThat(credentials.length > 0, 'No active human credential for user', 404);
    await Credential.updateMany({ _id: { $in: credentials.map(c => c._id) } }, { $set: { revoked: true }, $inc: { fence: 1 } }, { session: s });
    const credentialId = randomUUID();
    await Credential.create([{ _id: credentialId, userId, hash: hash(token), scope: 'human', systemAdmin: credentials.some(c => c.systemAdmin) }], { session: s });
    await Event.create([{ _id: randomUUID(), entityId: credentialId, action: 'recover', author: userId, at: new Date() }], { session: s });
  });
  return token;
}
export async function restoreSystemAdminToken(userId: string) {
  userIdSchema.parse(userId);
  const token = randomBytes(32).toString('hex');
  await mongoose.connection.transaction(async s => {
    requireThat(!await Credential.exists({ scope: 'human', systemAdmin: true, revoked: false }).session(s), 'An active system administrator already exists', 409);
    const credentialId = randomUUID();
    await Credential.create([{ _id: credentialId, userId, hash: hash(token), scope: 'human', systemAdmin: true }], { session: s });
    await Event.create([{ _id: randomUUID(), entityId: credentialId, action: 'restore_system_admin', author: userId, at: new Date() }], { session: s });
  });
  return token;
}
export class Service {
  readonly events = new EventHub();
  readonly automation = new Automation(this);
  readonly conversations = new ConversationService(this);
  constructor(public leaseMs = 30 * 60 * 1000) { requireThat(Number.isFinite(leaseMs) && leaseMs > 0, 'Invalid lease'); }
  private responsibleFor(actor: Actor) { const responsible = actor.userId.trim(); requireThat(responsible, 'Authenticated agent has no user identity', 401); return responsible; }
  onTaskEvent(listener: (event: any) => void) { return this.events.on(listener); }
  private markdownMeta(doc: any) { const value = plain(doc); delete value.__v; return value; }
  private async markdowns(projectId: string, targetKind: string, targetId: string, after?: string, limit = 25) {
    const filter: any = { projectId, targetKind, targetId };
    const items = await MarkdownDocument.find(after ? { $and: [filter, { _id: { $gt: after } }] } : filter).sort({ _id: 1 }).limit(limit + 1).lean();
    const more = items.length > limit; if (more) items.pop();
    return { items: items.map(d => this.markdownMeta(d)), next: more ? items.at(-1)!._id : null };
  }
  private async taskReadBaseline(projectId: string, userId: string, session?: ClientSession, persist = false) {
    const filter = { projectId, userId, taskId: projectTaskReadKey };
    const existing = await TaskRead.findOne(filter).session(session ?? null).lean();
    if (existing) return existing.lastSequence ?? 0;
    const [projectRead, project] = await Promise.all([
      DeliveryRead.findOne({ projectId, userId }).select('lastSequence').session(session ?? null).lean(),
      Project.findById(projectId).select('eventSequence').session(session ?? null).lean()
    ]);
    const cursor = projectRead?.lastSequence ?? project?.eventSequence ?? 0;
    if (!persist) return cursor;
    try {
      const baseline = await TaskRead.findOneAndUpdate(filter, { $setOnInsert: { lastSequence: cursor } }, { upsert: true, returnDocument: 'after', session }).lean();
      return baseline?.lastSequence ?? cursor;
    } catch (error) {
      if (session || (error as any)?.code !== 11000) throw error;
      return (await TaskRead.findOne(filter).select('lastSequence').lean())?.lastSequence ?? cursor;
    }
  }
  private async taskReadCursor(projectId: string, userId: string, taskId: string, session?: ClientSession) {
    const [baseline, read] = await Promise.all([
      this.taskReadBaseline(projectId, userId, session),
      TaskRead.findOne({ projectId, userId, taskId }).select('lastSequence').session(session ?? null).lean()
    ]);
    return Math.max(baseline, read?.lastSequence ?? 0);
  }
  private async unreadTasks(actor: Actor, projectId: string, baseline: number) {
    const grouped = await DeliveryEvent.aggregate([
      { $match: { projectId, sequence: { $gt: baseline }, author: { $ne: actor.userId }, taskIds: { $exists: true, $ne: [] } } },
      { $unwind: '$taskIds' },
      { $lookup: { from: TaskRead.collection.name, let: { taskId: '$taskIds' }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$projectId', projectId] }, { $eq: ['$userId', actor.userId] }, { $eq: ['$taskId', '$$taskId'] }] } } },
        { $project: { _id: 0, lastSequence: 1 } }, { $limit: 1 }
      ], as: 'taskRead' } },
      { $addFields: { effectiveRead: { $max: [baseline, { $ifNull: [{ $arrayElemAt: ['$taskRead.lastSequence', 0] }, 0] }] } } },
      { $match: { $expr: { $gt: ['$sequence', '$effectiveRead'] } } },
      { $group: { _id: '$taskIds', unreadCount: { $sum: 1 }, lastSequence: { $max: '$sequence' }, lastActivity: { $max: '$at' } } },
      { $sort: { lastActivity: -1, _id: 1 } }, { $limit: 1000 }
    ]);
    const tasks = await Task.find({ projectId, archived: false, _id: { $in: grouped.map((row: any) => row._id) } }).select('_id name status featureId').lean();
    const taskById = new Map(tasks.map((task: any) => [task._id, task]));
    return grouped.flatMap((row: any) => {
      const task: any = taskById.get(row._id);
      return task ? [{ taskId: task._id, name: task.name, status: task.status, featureId: task.featureId ?? null, unreadCount: row.unreadCount, lastSequence: row.lastSequence, lastActivity: row.lastActivity }] : [];
    });
  }
  private async projectSyncReport(actor: Actor, a: any) {
    if (a.featureId) requireThat(await Feature.exists({ _id: a.featureId, projectId: a.projectId, archived: false }), 'Feature not found', 404);
    const tasks = await Task.find({ projectId: a.projectId, archived: false, ...(a.featureId ? { featureId: a.featureId } : {}) }).select('_id name status featureId updatedAt').sort({ createdAt: 1, _id: 1 }).lean();
    const taskIds = tasks.map((task: any) => task._id);
    if (!taskIds.length) return { projectId: a.projectId, featureId: a.featureId ?? null, generatedAt: new Date(), summary: { taskCount: 0, unreadTaskCount: 0, openQuestionCount: 0 }, tasks: [] };
    const [diffRows, activityRows, questions] = await Promise.all([
      TaskDiff.aggregate([
        { $match: { projectId: a.projectId, taskId: { $in: taskIds } } }, { $sort: { createdAt: -1, _id: -1 } },
        { $group: { _id: '$taskId', diff: { $first: { _id: '$_id', baseCommit: '$baseCommit', commit: '$commit', branch: '$branch', files: '$files', truncated: '$truncated', author: '$author', agent: '$agent', createdAt: '$createdAt' } } } }
      ]),
      DeliveryEvent.aggregate([
        { $match: { projectId: a.projectId, taskIds: { $in: taskIds } } }, { $unwind: '$taskIds' }, { $match: { taskIds: { $in: taskIds } } },
        { $sort: { sequence: -1 } }, { $group: { _id: '$taskIds', activity: { $first: { sequence: '$sequence', kind: '$kind', summary: '$summary', author: '$author', at: '$at' } } } }
      ]),
      TaskMessage.find({ projectId: a.projectId, taskId: { $in: taskIds }, type: 'pergunta' }).select('_id taskId relatedTaskId author message createdAt conversationId').sort({ createdAt: 1, _id: 1 }).lean()
    ]);
    const questionIds = questions.map((question: any) => question._id);
    const answers = questionIds.length ? await TaskMessage.find({ projectId: a.projectId, type: 'resposta', $or: [{ replyTo: { $in: questionIds } }, { conversationId: { $in: questions.map((question: any) => question.conversationId).filter(Boolean) } }] }).select('_id replyTo conversationId createdAt').sort({ createdAt: 1, _id: 1 }).lean() : [];
    const explicitlyAnswered = new Set(answers.map((answer: any) => answer.replyTo).filter(Boolean));
    const consumedLegacyAnswers = new Set<string>();
    const openQuestionsByTask = new Map<string, any[]>();
    for (const question of questions as any[]) {
      let answered = explicitlyAnswered.has(question._id);
      if (!answered && question.conversationId) {
        const legacyAnswer = (answers as any[]).find(answer => !answer.replyTo && answer.conversationId === question.conversationId && !consumedLegacyAnswers.has(answer._id) && answer.createdAt >= question.createdAt);
        if (legacyAnswer) { consumedLegacyAnswers.add(legacyAnswer._id); answered = true; }
      }
      if (!answered) openQuestionsByTask.set(question.taskId, [...(openQuestionsByTask.get(question.taskId) ?? []), {
        id: question._id, taskId: question.taskId, relatedTaskId: question.relatedTaskId ?? null, author: question.author,
        message: question.message, createdAt: question.createdAt, conversationId: question.conversationId ?? null
      }]);
    }
    const diffByTask = new Map(diffRows.map((row: any) => [row._id, row.diff]));
    const activityByTask = new Map(activityRows.map((row: any) => [row._id, row.activity]));
    const baseline = await this.taskReadBaseline(a.projectId, actor.userId, undefined, true);
    const unreadRows = (await this.unreadTasks(actor, a.projectId, baseline)).filter((row: any) => taskIds.includes(row.taskId));
    const unreadByTask = new Map(unreadRows.map((row: any) => [row.taskId, row]));
    const reportTasks = (tasks as any[]).map(task => {
      const diff: any = diffByTask.get(task._id);
      const activity: any = activityByTask.get(task._id);
      const questionActivity = openQuestionsByTask.get(task._id)?.at(-1);
      const candidates = [
        activity && { at: activity.at, kind: activity.kind, summary: activity.summary, author: activity.author, sequence: activity.sequence },
        diff && { at: diff.createdAt, kind: 'task.diff.published', summary: `Diff ${diff.commit ?? ''}`.trim(), author: diff.author },
        questionActivity && { at: questionActivity.createdAt, kind: 'task.question.open', summary: questionActivity.message, author: questionActivity.author },
        task.updatedAt && { at: task.updatedAt, kind: 'task.updated', summary: 'Tarefa atualizada' }
      ].filter(Boolean) as any[];
      candidates.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
      const unread: any = unreadByTask.get(task._id);
      return {
        taskId: task._id, name: task.name, status: task.status, featureId: task.featureId ?? null,
        latestActivity: candidates[0] ?? null,
        gitDiff: diff ?? null,
        openQuestions: openQuestionsByTask.get(task._id) ?? [],
        unread: { count: unread?.unreadCount ?? 0, cursor: unread?.lastSequence ?? null }
      };
    });
    return {
      projectId: a.projectId, featureId: a.featureId ?? null, generatedAt: new Date(),
      summary: { taskCount: reportTasks.length, unreadTaskCount: unreadRows.length, openQuestionCount: reportTasks.reduce((count, task) => count + task.openQuestions.length, 0) },
      tasks: reportTasks
    };
  }
  async access(actor: Actor, projectId: string, write = false, admin = false, session?: ClientSession) {
    if (actor.scope !== 'trusted_local' && actor.scope !== 'system') requireThat(await Credential.exists({ _id: actor.id, revoked: false, scope: actor.scope }).session(session ?? null), 'Credential revoked', 401);
    const p = await Project.findById(projectId).session(session ?? null);
    if (actor.systemAdmin) {
      requireThat(p, 'Project access denied', 403);
      if (write) requireThat(!p.archived, 'Project archived');
      return p;
    }
    if (actor.scope === 'trusted_local') {
      requireThat(p, 'Project access denied', 403);
      requireThat(p.visibility !== 'private' || (!!actor.projectToken && hash(actor.projectToken) === p.accessTokenHash), 'Project access token required', 403);
      if (admin) requireThat(p.members?.get(memberKey(actor.userId)) === 'administrador', 'Project administrator required', 403);
      if (write) requireThat(!p.archived, 'Project archived');
      return p;
    }
    const role = p?.members?.get(memberKey(actor.userId));
    requireThat(p && role && (!write || role !== 'leitor') && (!admin || role === 'administrador'), 'Project access denied', 403);
    if (write) requireThat(!p.archived, 'Project archived');
    return p;
  }
  async listCredentials(actor: Actor, query: { projectId?: string; scope?: 'human' | 'agent'; status?: 'active' | 'revoked'; email?: string; after?: string; limit: number }) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const credential = await Credential.findOne({ _id: actor.id, scope: 'human', revoked: false }).select('systemAdmin').lean();
    requireThat(credential, 'Credential revoked', 401);
    const systemAdmin = !!credential.systemAdmin;
    requireThat(systemAdmin || !!query.projectId, 'System administrator or project administrator required', 403);
    if (query.projectId) {
      requireThat(query.scope !== 'agent', 'Agent credentials require system administrator access without a project filter', 403);
      await this.access(actor, query.projectId, false, true);
      const emailPattern = query.email?.trim() ? new RegExp(query.email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined;
      const credentialFilter: Record<string, unknown> = { 'credential.scope': 'human' };
      if (query.after) credentialFilter['credential._id'] = { $gt: query.after };
      if (query.status) credentialFilter['credential.revoked'] = query.status === 'revoked';
      if (emailPattern) credentialFilter['credential.userId'] = emailPattern;
      const events = await Event.aggregate([
        { $match: { projectId: query.projectId, action: 'issue_project_member' } },
        { $lookup: { from: Credential.collection.name, localField: 'entityId', foreignField: '_id', as: 'credential' } },
        { $unwind: '$credential' },
        { $match: credentialFilter },
        { $sort: { 'credential._id': 1 } },
        { $limit: query.limit + 1 },
        { $project: { _id: '$credential._id', userId: '$credential.userId', scope: '$credential.scope', systemAdmin: '$credential.systemAdmin', revoked: '$credential.revoked', createdAt: '$credential.createdAt', projectId: 1, role: '$data.role' } }
      ]);
      const more = events.length > query.limit;
      if (more) events.pop();
      const project = await Project.findById(query.projectId).select('_id name').lean();
      const items = events.map(item => ({ credentialId: item._id, email: item.userId, scope: item.scope, systemAdmin: item.systemAdmin === true, state: item.revoked ? 'revoked' : 'active', createdAt: item.createdAt ?? null, projectId: item.projectId, projectName: project?.name ?? null, role: item.role ?? null }));
      return { items, next: more ? events.at(-1)?._id ?? null : null };
    }

    const filter: Record<string, unknown> = {};
    if (query.scope) filter.scope = query.scope;
    if (query.status) filter.revoked = query.status === 'revoked';
    if (query.email?.trim()) filter.userId = new RegExp(query.email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (query.after) filter._id = { $gt: query.after };
    const credentials = await Credential.find(filter).select('_id userId scope systemAdmin revoked createdAt').sort({ _id: 1 }).limit(query.limit + 1).lean();
    const more = credentials.length > query.limit;
    if (more) credentials.pop();
    const ids = credentials.map(item => item._id);
    const issuances = ids.length ? await Event.find({ entityId: { $in: ids }, action: 'issue_project_member' }).select('entityId projectId data').lean() : [];
    const issuanceByCredential = new Map(issuances.map(item => [item.entityId, item]));
    const projectIds = [...new Set(issuances.map(item => item.projectId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }).select('_id name').lean() : [];
    const projectById = new Map(projects.map(item => [item._id, item]));
    const items = credentials.map(item => {
      const issuance = issuanceByCredential.get(item._id);
      const project = typeof issuance?.projectId === 'string' ? projectById.get(issuance.projectId) : undefined;
      return { credentialId: item._id, email: item.userId, scope: item.scope, systemAdmin: item.systemAdmin === true, state: item.revoked ? 'revoked' : 'active', createdAt: item.createdAt ?? null, ...(issuance && typeof issuance.projectId === 'string' ? { projectId: issuance.projectId, projectName: project?.name ?? null, role: (issuance.data as any)?.role ?? null } : {}) };
    });
    return { items, next: more ? credentials.at(-1)?._id ?? null : null };
  }
  async deleteProject(actor: Actor, projectId: string, operationId: string) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    requireThat(actor.systemAdmin === true, 'System administrator required', 403);
    requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId), 'Invalid operationId', 400);

    const key = `${actor.id}:${operationId}`;
    const fingerprint = hash(JSON.stringify({ action: 'hard_delete_project', projectId }));
    return mongoose.connection.transaction(async s => {
      const activeAdmin = await Credential.updateOne(
        { _id: actor.id, scope: 'human', systemAdmin: true, revoked: false },
        { $inc: { fence: 1 } },
        { session: s }
      );
      requireThat(activeAdmin.matchedCount === 1, 'System administrator credential required', 403);

      const previous = await Operation.findById(key).session(s).lean();
      if (previous) {
        requireThat(previous.fingerprint === fingerprint, 'Operation ID reused with different arguments');
        return previous.result;
      }

      let result: Awaited<ReturnType<typeof deleteProjectCascade>>;
      try {
        result = await deleteProjectCascade(projectId, { id: actor.id, userId: actor.userId }, s);
      } catch (error) {
        if (error instanceof ProjectDeletionConflict) throw new DomainError(error.message, error.status);
        throw error;
      }
      requireThat(result, 'Project not found', 404);
      requireThat(result.removed.projects === 1, 'Project changed during deletion', 409);
      // This idempotency record intentionally has no projectId: it is the
      // minimal receipt needed to safely retry the destructive request.
      await Operation.create([{ _id: key, fingerprint, result }], { session: s });
      return result;
    });
  }
  async deleteTask(actor: Actor, projectId: string, taskId: string, operationId: string) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    requireThat(actor.systemAdmin === true, 'System administrator required', 403);
    requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId), 'Invalid operationId', 400);

    const key = `${actor.id}:${operationId}`;
    const fingerprint = hash(JSON.stringify({ action: 'hard_delete_task', projectId, taskId }));
    return mongoose.connection.transaction(async s => {
      const activeAdmin = await Credential.updateOne(
        { _id: actor.id, scope: 'human', systemAdmin: true, revoked: false },
        { $inc: { fence: 1 } },
        { session: s }
      );
      requireThat(activeAdmin.matchedCount === 1, 'System administrator credential required', 403);

      const previous = await Operation.findById(key).session(s).lean();
      if (previous) {
        requireThat(previous.fingerprint === fingerprint, 'Operation ID reused with different arguments');
        return previous.result;
      }

      let result;
      try { result = await deleteTaskCascade(projectId, taskId, { id: actor.id, userId: actor.userId }, s); }
      catch (error) {
        if (error instanceof TaskDeletionConflict) throw new DomainError(error.message, error.status);
        throw error;
      }
      requireThat(result, 'Task not found', 404);
      // Keep the retry receipt outside the task's deletion cascade.
      await Operation.create([{ _id: key, fingerprint, result }], { session: s });
      return result;
    });
  }
  async adminCapabilities(actor: Actor) {
    if (actor.scope === 'trusted_local') return { scope: actor.scope, systemAdmin: false, canHardDelete: false };
    const credential = await Credential.findOne({ _id: actor.id, scope: actor.scope, revoked: false }).select('scope systemAdmin').lean();
    requireThat(credential, 'Credential revoked', 401);
    const systemAdmin = credential.scope === 'human' && credential.systemAdmin === true;
    return { scope: credential.scope, systemAdmin, canHardDelete: systemAdmin };
  }
  async event(s: ClientSession, actor: Actor, action: string, projectId: string | undefined, entityId: string, data: any) {
    const eventId = randomUUID(); const at = new Date();
    const kind = ({ create_task: 'task.created', create_feature: 'feature.created', create_project: 'project.created', task_message: 'task.message.created', create_conversation: 'conversation.created', open_task_conversation: 'conversation.created', link_conversation_task: 'conversation.task.linked', delete_conversation: 'conversation.deleted', conversation_message: 'conversation.message.created', create_action_proposal: 'conversation.action_proposal.created', approve_action_proposal: 'conversation.action_proposal.approved', save_markdown: 'body.updated', update_markdown: 'body.updated', record_task_diff: 'task.diff.published', submit_task: 'task.submitted', claim_task: 'task.claimed', record_progress: 'task.progressed', set_acceptance_criterion: 'task.acceptance.progressed', block_task: 'task.blocked', approve: 'task.approved', set_task_status: 'task.status.changed', manual_status_change: 'task.status.changed', set_task_checked: 'task.check.changed', transfer_task: 'task.transferred' } as Record<string, string>)[action] ?? `project.${action}`;
    const summary = ({ 'task.created': 'Tarefa criada', 'feature.created': 'Feature criada', 'project.created': 'Projeto criado', 'task.message.created': 'Mensagem adicionada à tarefa', 'conversation.created': 'Conversa criada', 'conversation.message.created': data?.summary ?? 'Nova mensagem na conversa', 'conversation.action_proposal.created': 'Proposta de execução aguardando aprovação', 'conversation.action_proposal.approved': 'Proposta aprovada e execução autorizada', 'body.updated': 'Documento Markdown atualizado', 'task.diff.published': 'Diff de código publicado', 'task.submitted': 'Tarefa enviada para revisão', 'task.claimed': 'Tarefa assumida', 'task.progressed': 'Progresso registrado', 'task.acceptance.progressed': 'Critério de aceite atualizado', 'task.blocked': 'Tarefa bloqueada', 'task.approved': 'Tarefa aprovada', 'task.status.changed': 'Status da tarefa alterado', 'task.check.changed': 'Conferência da tarefa alterada', 'task.transferred': 'Tarefa transferida' } as Record<string, string>)[kind] ?? action;
    const agent = data?.agent ?? actor.clientName;
    const actorData = { userId: actor.userId, credentialId: actor.id, ...(agent ? { agent } : {}) };
    const git = data?.repositoryId ? { repositoryId: data.repositoryId, ...(data?.branch ? { branch: data.branch } : {}), ...(data?.commit ? { commit: data.commit } : {}) } : undefined;
    await Event.create([{ _id: eventId, projectId, entityId, action, kind, summary, actor: actorData, git, author: actor.userId, credentialId: actor.id, at, data }], { session: s });
    if (!projectId) return;
    const project = await Project.findByIdAndUpdate(projectId, { $inc: { eventSequence: 1 } }, { returnDocument: 'after', session: s });
    if (!project) return;
    const ids = new Set<string>([data?.taskId, data?.relatedTaskId].filter(Boolean));
    if (await Task.exists({ _id: entityId, projectId }).session(s)) ids.add(entityId);
    if (data?.targetKind === 'task') ids.add(data.targetId);
    if (data?.targetKind === 'feature' || await Feature.exists({ _id: entityId, projectId }).session(s)) {
      for (const task of await Task.find({ projectId, featureId: data?.targetKind === 'feature' ? data.targetId : entityId }).select('_id').session(s)) ids.add(task._id!);
    }
    await DeliveryEvent.create([{ _id: eventId, projectId, sequence: project.eventSequence, taskIds: [...ids], action, kind, summary, author: actor.userId, credentialId: actor.id, entityId, entityVersion: data?.task?.version ?? data?.version, at }], { session: s });
  }
  async mutate(actor: Actor, name: string, a: any, run: (s: ClientSession) => Promise<any>, projectAdmin = name === 'admin', projectWrite = name !== 'mark_project_read' && name !== 'mark_task_read') {
    const key = `${actor.id}:${a.operationId}`;
    const fingerprint = hash(JSON.stringify({ name, a }));
    const startedAt = Date.now();
    let outcome = 'error';
    const graphWrite = name === 'create_task' || name === 'set_task_status' || name === 'open_task_conversation'
      || name === 'edit_record' && a.kind === 'task'
      || name === 'archive_record' && a.kind === 'task'
      || name === 'admin' && (a.action === 'review' && a.decision === 'cancel' || a.action === 'change_task_status' && a.status === 'cancelada');
    try {
      const result = await mongoose.connection.transaction(async s => {
        // Credential fencing protects revocation; the project fence is reserved for shared graph invariants.
        if (actor.scope !== 'trusted_local') {
          const active = await Credential.updateOne({ _id: actor.id, revoked: false, scope: actor.scope }, { $inc: { fence: 1 } }, { session: s });
          requireThat(active.matchedCount, 'Credential revoked', 401);
        }
        if (a.projectId) await this.access(actor, a.projectId, false, projectAdmin, s);
        const targetProjectId = name === 'transfer_task' ? a.targetProjectId as string : undefined;
        if (targetProjectId) await this.access(actor, targetProjectId, false, projectAdmin, s);
        const old = await Operation.findById(key).session(s);
        if (old) { requireThat(old.fingerprint === fingerprint, 'Operation ID reused with different arguments'); return old.result; }
        if (a.projectId) await this.access(actor, a.projectId, projectWrite, projectAdmin, s);
        if (graphWrite && a.projectId) await Project.updateOne({ _id: a.projectId }, { $inc: { fence: 1 } }, { session: s });
        if (targetProjectId) {
          await this.access(actor, targetProjectId, projectWrite, projectAdmin, s);
          requireThat(await Project.exists({ _id: targetProjectId }).session(s), 'Destination project not found', 404);
        }
        const result = plain(await run(s));
        const projectId = a.projectId ?? (name === 'create_project' ? result?._id : undefined);
        await Operation.create([{ _id: key, ...(projectId ? { projectId } : {}), fingerprint, result }], { session: s });
        return result;
      });
      outcome = 'success';
      return result;
    } finally {
      logger.debug('mcp mutation measured', { operation: name, projectId: a.projectId, graphWrite, outcome, durationMs: Date.now() - startedAt });
    }
  }
  private async graph(projectId: string, taskId: string, data: any, s: ClientSession) {
    const p = await Project.findById(projectId).session(s);
    requireThat(p?.repositories.some(r => r.id === data.repositoryId), 'Unknown repository');
    if (data.featureId) requireThat(await Feature.exists({ _id: data.featureId, projectId, archived: false }).session(s), 'Unknown or archived feature');
    await validateTaskDependencyGraph(projectId, taskId, data.dependencies ?? [], s, requireThat);
  }
  private async taskTransferPlan(actor: Actor, a: any, s?: ClientSession) {
    const source: any = await this.access(actor, a.projectId, true, false, s);
    const destination: any = await this.access(actor, a.targetProjectId, true, false, s);
    requireThat(a.projectId !== a.targetProjectId, 'Source and destination projects must be different', 400);

    const task: any = await Task.findOne({ _id: a.taskId, projectId: a.projectId }).session(s ?? null).lean();
    requireThat(task, 'Task not found', 404);
    requireThat(task.version === a.version, 'Task version conflict');

    const blockers: string[] = [];
    if (task.archived) blockers.push('Archived tasks cannot be transferred.');
    if (!destination.repositories?.some((repository: any) => repository.id === a.targetRepositoryId)) blockers.push('Destination repository is not registered in the destination project.');
    if (a.targetFeatureId && !await Feature.exists({ _id: a.targetFeatureId, projectId: a.targetProjectId, archived: false }).session(s ?? null)) blockers.push('Destination feature is missing, archived, or belongs to another project.');
    if (await Task.exists({ _id: a.taskId, projectId: a.targetProjectId }).session(s ?? null)) blockers.push('Destination already contains this task ID.');
    if (await MarkdownDocument.exists({ projectId: a.targetProjectId, targetKind: 'task', targetId: a.taskId }).session(s ?? null)) blockers.push('Destination already contains Markdown documents for this task ID.');

    const dependents: any[] = await Task.find({ projectId: a.projectId, _id: { $ne: a.taskId }, dependencies: a.taskId }).select('_id').session(s ?? null).lean();
    if (task.dependencies?.length) blockers.push('Task has dependencies; transfer or remap them before moving this task.');
    if (dependents.length) blockers.push('Other tasks depend on this task; transfer or remap them before moving it.');

    const messages: any[] = await TaskMessage.find({ projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] }).select('_id taskId relatedTaskId').session(s ?? null).lean();
    if (messages.some(message => message.taskId !== a.taskId || (message.relatedTaskId && message.relatedTaskId !== a.taskId))) blockers.push('Task collaboration messages reference other tasks and cannot be moved independently.');

    const proposals: any[] = await ActionProposal.find({ projectId: a.projectId, taskId: a.taskId }).select('_id conversationId').session(s ?? null).lean();
    const conversations: any[] = await Conversation.find({ projectId: a.projectId, $or: [
      { taskId: a.taskId }, { _id: { $in: proposals.map(proposal => proposal.conversationId) } }
    ] }).select('_id').session(s ?? null).lean();
    const conversationIds = conversations.map(item => item._id);
    const conversationMessages: any[] = await ConversationMessage.find({ projectId: a.projectId, conversationId: { $in: conversationIds } }).select('_id conversationId').session(s ?? null).lean();

    const executions: any[] = await Execution.find({ $or: [{ projectId: a.projectId, taskId: a.taskId }, ...(task.executionId ? [{ _id: task.executionId }] : [])] }).select('_id').session(s ?? null).lean();
    const activeExecution = task.status === 'em_execucao' || !!(task.leaseUntil && task.leaseUntil > new Date()) || !!await Execution.exists({ status: 'em_execucao', $or: [{ projectId: a.projectId, taskId: a.taskId }, ...(task.executionId ? [{ _id: task.executionId }] : [])] }).session(s ?? null);
    const jobs: any[] = await AutomationJob.find({ projectId: a.projectId, taskId: a.taskId }).select('_id status turnInFlight').session(s ?? null).lean();
    if (activeExecution || jobs.some(job => ['queued', 'reserved', 'running', 'waiting_human'].includes(job.status) || job.turnInFlight)) blockers.push('Task has an active execution or automation job; finish or cancel it before transferring.');

    const [documents, diffs] = await Promise.all([
      MarkdownDocument.find({ projectId: a.projectId, targetKind: 'task', targetId: a.taskId }).select('_id').session(s ?? null).lean(),
      TaskDiff.find({ projectId: a.projectId, taskId: a.taskId }).select('_id').session(s ?? null).lean()
    ]);
    const linkedEntityIds = [...new Set([a.taskId, ...documents.map(item => item._id), ...diffs.map(item => item._id), ...jobs.map(item => item._id), ...messages.map(item => item._id), ...executions.map(item => item._id), ...conversationIds, ...conversationMessages.map(item => item._id), ...proposals.map(item => item._id)])];
    const eventFilter = { projectId: a.projectId, $or: [
      { entityId: { $in: linkedEntityIds } },
      { 'data.taskId': a.taskId },
      { 'data.relatedTaskId': a.taskId },
      { 'data.targetId': a.taskId },
      { 'data.task._id': a.taskId }
    ] };
    const events: any[] = await Event.find(eventFilter).select('_id').session(s ?? null).lean();
    const ids = (items: any[]) => items.map(item => item._id).sort();
    const recordIds = {
      messages: ids(messages), documents: ids(documents), diffs: ids(diffs), jobs: ids(jobs),
      executions: ids(executions), conversations: ids(conversations), conversationMessages: ids(conversationMessages),
      actionProposals: ids(proposals), events: ids(events), dependents: ids(dependents)
    };
    const planInput = {
      sourceProjectId: a.projectId, sourceProjectVersion: source.version ?? 0,
      targetProjectId: a.targetProjectId, targetProjectVersion: destination.version ?? 0,
      taskId: a.taskId, taskVersion: task.version, taskStatus: task.status, taskRepositoryId: task.repositoryId,
      taskFeatureId: task.featureId ?? null, dependencies: [...(task.dependencies ?? [])].sort(),
      targetRepositoryId: a.targetRepositoryId, targetFeatureId: a.targetFeatureId, recordIds
    };
    const planHash = blockers.length ? null : hash(JSON.stringify(planInput));
    return {
      eligible: blockers.length === 0,
      blockers,
      planHash,
      source: { projectId: source._id, name: source.name },
      destination: { projectId: destination._id, name: destination.name },
      task: { taskId: task._id, name: task.name, version: task.version, status: task.status, repositoryId: task.repositoryId, featureId: task.featureId ?? null },
      moveCounts: { messages: messages.length, documents: documents.length, diffs: diffs.length, jobs: jobs.length, executions: executions.length, conversations: conversations.length, conversationMessages: conversationMessages.length, actionProposals: proposals.length, historyEvents: events.length },
      internal: { task, messages, documents, diffs, jobs, executions, conversations, conversationMessages, actionProposals: proposals, events }
    };
  }
  async call(actor: Actor, name: string, input: unknown): Promise<any> {
    const conversationTools = new Set(['create_conversation', 'open_task_conversation', 'link_conversation_task', 'delete_conversation', 'send_conversation_message', 'send_collaboration_message']);
    requireThat(['agent', 'trusted_local'].includes(actor.scope) || (actor.scope === 'human' && (name === 'archive_record' || name === 'create_task' || name === 'create_feature' || name === 'mark_task_read' || conversationTools.has(name))), 'Agent scope required', 403);
    const schema = tools[name as keyof typeof tools];
    requireThat(schema, 'Unknown tool', 404);
    const a: any = schema.parse(input);
    if (!('operationId' in a)) return this.read(actor, name, a);
    if (name === 'send_collaboration_message') return this.automation.message(actor, a);
    if (name === 'create_conversation') return this.conversations.create(actor, a);
    if (name === 'open_task_conversation') return this.conversations.openTask(actor, a);
    if (name === 'link_conversation_task') return this.conversations.linkTask(actor, a);
    if (name === 'delete_conversation') return this.conversations.delete(actor, a);
    if (name === 'send_conversation_message') return this.conversations.sendMessage(actor, a);
    if (name === 'create_action_proposal') return this.conversations.createProposal(actor, a);
    const result = await this.mutate(actor, name, a, async s => {
      await this.automation.guard(actor, name, a, s);
      if (name.startsWith('create_')) {
        const kind = name.slice(7); const entityId = randomUUID();
        if (kind === 'task') await this.graph(a.projectId, entityId, a.data, s);
        if (kind === 'project') requireThat(new Set(a.data.repositories.map((r: any) => r.id)).size === a.data.repositories.length, 'Duplicate repository');
        const { accessToken, ...data } = a.data;
        const [created] = await models[kind].create([{ _id: entityId, ...data, ...(kind === 'task' ? { acceptanceProgress: data.acceptance.map(() => false) } : {}), ...(kind === 'project' ? { accessTokenHash: accessToken ? hash(accessToken) : undefined, members: { [memberKey(actor.userId)]: 'administrador' } } : { projectId: a.projectId }) }], { session: s });
        await this.event(s, actor, name, a.projectId ?? entityId, entityId, created);
        return created;
      }
      if (name === 'save_markdown') {
        const target = a.targetKind === 'task' ? await Task.findOne({ _id: a.targetId, projectId: a.projectId, archived: false }).session(s) : await Feature.findOne({ _id: a.targetId, projectId: a.projectId, archived: false }).session(s);
        requireThat(target, 'Markdown target not found or archived', 404);
        if (a.targetKind === 'task') {
          const t: any = target; const now = new Date();
          requireThat(['pendente', 'bloqueada', 'em_execucao'].includes(t.status), 'Task markdown cannot be changed in this state');
          if (t.status === 'em_execucao') { requireThat(t.executionId && t.leaseUntil > now, 'Execution inactive or expired'); const e = await Execution.findOne({ _id: t.executionId, credentialId: actor.id }).session(s); requireThat(e, 'Execution belongs to another credential', 403); }
        }
        const size = Buffer.byteLength(a.content, 'utf8'); const sha256 = hash(a.content); let doc: any;
        if (a.id) { requireThat(a.version !== undefined, 'Version required for markdown update'); doc = await MarkdownDocument.findOne({ _id: a.id, projectId: a.projectId, targetKind: a.targetKind, targetId: a.targetId }).session(s); requireThat(doc && doc.version === a.version, 'Markdown version conflict or not found'); }
        else { doc = await MarkdownDocument.findOne({ projectId: a.projectId, targetKind: a.targetKind, targetId: a.targetId, name: a.name }).session(s); requireThat(!doc, 'Markdown name already exists'); doc = new MarkdownDocument({ _id: randomUUID(), projectId: a.projectId, targetKind: a.targetKind, targetId: a.targetId, name: a.name, revision: 0 }); }
        if (doc.revision && doc.sha256 === sha256 && doc.summary === a.summary && doc.name === a.name) return this.markdownMeta(doc);
        doc.name = a.name; doc.summary = a.summary; doc.revision += 1; doc.author = actor.userId; doc.size = size; doc.sha256 = sha256; doc.version += 1; await doc.save({ session: s });
        await MarkdownRevision.create([{ _id: randomUUID(), projectId: a.projectId, documentId: doc._id, revision: doc.revision, summary: a.summary, content: a.content, author: actor.userId, size, sha256, createdAt: new Date() }], { session: s });
        const meta = this.markdownMeta(doc); await this.event(s, actor, 'save_markdown', a.projectId, doc._id, meta); return meta;
      }
      if (name === 'update_markdown') {
        const doc: any = await MarkdownDocument.findOne({ _id: a.documentId, projectId: a.projectId }).session(s);
        requireThat(doc, 'Markdown not found', 404);
        if (doc.revision !== a.baseRevision) throw new DomainError(`Markdown revision conflict: current=${doc.revision}; summary=${doc.summary ?? ''}; sha256=${doc.sha256 ?? ''}`, 409);
        const target = doc.targetKind === 'task' ? await Task.findOne({ _id: doc.targetId, projectId: a.projectId, archived: false }).session(s) : await Feature.findOne({ _id: doc.targetId, projectId: a.projectId, archived: false }).session(s);
        requireThat(target, 'Markdown target not found or archived', 404);
        if (doc.targetKind === 'task') {
          const task: any = target; requireThat(['pendente', 'bloqueada', 'em_execucao'].includes(task.status), 'Task markdown cannot be changed in this state');
          if (task.status === 'em_execucao') requireThat(await Execution.exists({ _id: task.executionId, credentialId: actor.id }).session(s), 'Execution belongs to another credential', 403);
        }
        const size = Buffer.byteLength(a.content, 'utf8'); const sha256 = hash(a.content);
        if (doc.sha256 === sha256 && doc.summary === a.summary) return this.markdownMeta(doc);
        doc.summary = a.summary; doc.revision += 1; doc.author = actor.userId; doc.size = size; doc.sha256 = sha256; doc.version += 1; await doc.save({ session: s });
        await MarkdownRevision.create([{ _id: randomUUID(), projectId: a.projectId, documentId: doc._id, revision: doc.revision, summary: a.summary, content: a.content, author: actor.userId, size, sha256, createdAt: new Date() }], { session: s });
        const meta = this.markdownMeta(doc); await this.event(s, actor, 'update_markdown', a.projectId, doc._id, meta); return meta;
      }
      if (name === 'record_task_diff') {
        const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
        requireThat(task, 'Task not found', 404);
        requireThat(task.repositoryId === a.repositoryId, 'Task repository mismatch', 400);
        if (task.status === 'em_execucao') requireThat(await Execution.exists({ _id: task.executionId, credentialId: actor.id }).session(s), 'Execution belongs to another credential', 403);
        const project = await Project.findById(a.projectId).session(s);
        requireThat(project?.repositories.some(repository => repository.id === a.repositoryId), 'Unknown repository', 404);
        requireThat(a.patch || a.truncated || a.files.length > 0, 'Diff must include files, patch, or truncation marker', 400);
        const patchSha256 = a.patch ? hash(a.patch) : a.patchSha256;
        if (a.patchSha256) requireThat(a.patchSha256 === patchSha256, 'Patch hash mismatch', 400);
        const diffId = randomUUID();
        const diff = new TaskDiff({ _id: diffId, projectId: a.projectId, taskId: a.taskId, repositoryId: a.repositoryId, baseCommit: a.baseCommit, commit: a.commit, branch: a.branch, files: a.files, patch: a.patch, patchSha256, truncated: a.truncated, author: actor.userId, credentialId: actor.id, agent: a.agent });
        await diff.save({ session: s });
        await this.event(s, actor, 'record_task_diff', a.projectId, diffId, { taskId: a.taskId, repositoryId: a.repositoryId, branch: a.branch, commit: a.commit, agent: a.agent });
        return diff;
      }
      if (name === 'mark_project_read') {
        const head = (await Project.findById(a.projectId).select('eventSequence').session(s).lean())?.eventSequence ?? 0;
        requireThat(a.cursor <= head, 'Read cursor is ahead of project', 400);
        await DeliveryRead.findOneAndUpdate({ projectId: a.projectId, userId: actor.userId }, { $max: { lastSequence: a.cursor } }, { upsert: true, returnDocument: 'after', session: s });
        return { projectId: a.projectId, cursor: a.cursor };
      }
      if (name === 'mark_task_read') {
        const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).select('_id').session(s).lean();
        requireThat(task, 'Task not found', 404);
        const head = (await Project.findById(a.projectId).select('eventSequence').session(s).lean())?.eventSequence ?? 0;
        requireThat(a.cursor <= head, 'Read cursor is ahead of project', 400);
        await this.taskReadBaseline(a.projectId, actor.userId, s, true);
        const read = await TaskRead.findOneAndUpdate({ projectId: a.projectId, userId: actor.userId, taskId: a.taskId }, { $max: { lastSequence: a.cursor } }, { upsert: true, returnDocument: 'after', session: s }).lean();
        return { projectId: a.projectId, taskId: a.taskId, cursor: Math.max(read?.lastSequence ?? 0, await this.taskReadBaseline(a.projectId, actor.userId, s)) };
      }
      if (name === 'edit_record' || name === 'archive_record') {
        const filter = a.kind === 'project' ? { _id: a.projectId } : { _id: a.id, projectId: a.projectId };
        requireThat(a.kind !== 'project' || a.id === a.projectId, 'Project mismatch');
        const doc = await models[a.kind].findOne(filter).session(s);
        requireThat(doc && doc.version === a.version && !doc.archived, 'Version conflict or archived');
        if (a.kind === 'project') await this.access(actor, a.projectId, true, true, s);
        if (a.kind === 'task') requireThat(['pendente', 'bloqueada'].includes(doc.status) || (name === 'archive_record' && ['concluida', 'cancelada'].includes(doc.status)), 'Task cannot be edited in this state');
        if (name === 'archive_record') {
          if (a.kind === 'task') {
            requireThat(['concluida', 'cancelada'].includes(doc.status), 'Only terminal tasks can be archived');
            requireThat(!await Task.exists({ projectId: a.projectId, dependencies: a.id, status: { $nin: ['concluida', 'cancelada'] } }).session(s), 'Task still required');
          } else requireThat(!await Task.exists({ projectId: a.projectId, ...(a.kind === 'feature' ? { featureId: a.id } : {}), status: { $nin: ['concluida', 'cancelada'] } }).session(s), 'Active tasks prevent archival');
          doc.archived = true;
        } else {
          const data = ({ project: projectData, feature: featureData, task: taskData }[a.kind as 'project' | 'feature' | 'task']).partial().parse(a.data);
          if (a.kind === 'task' && 'acceptance' in data && data.acceptance) (data as any).acceptanceProgress = data.acceptance.map(() => false);
          if (a.kind === 'project') {
            const projectData = data as any;
            if (projectData.accessToken) { projectData.accessTokenHash = hash(projectData.accessToken); delete projectData.accessToken; }
            if (projectData.visibility === 'private') requireThat(projectData.accessTokenHash || doc.accessTokenHash, 'Private project requires an access token');
            if (projectData.visibility === 'public') projectData.accessTokenHash = undefined;
          }
          if (a.kind === 'task') await this.graph(a.projectId, a.id, { ...plain(doc), ...data }, s);
          if (a.kind === 'project' && 'repositories' in data && data.repositories) {
            const ids = data.repositories.map((r: any) => r.id);
            requireThat(new Set(ids).size === ids.length, 'Duplicate repository');
            requireThat(!await Task.exists({ projectId: a.projectId, repositoryId: { $nin: ids } }).session(s), 'Repository is referenced');
          }
          Object.assign(doc, data);
        }
        doc.version += 1; await doc.save({ session: s });
        if (name === 'edit_record') {
          const affected = a.kind === 'task' ? [a.id] : (await Task.find({ projectId: a.projectId, ...(a.kind === 'feature' ? { featureId: a.id } : {}) }).select('_id').session(s)).map(t => t._id);
          await AutomationJob.updateMany({ projectId: a.projectId, taskId: { $in: affected } }, { $set: { authorizationValid: false }, $inc: { version: 1 } }, { session: s });
        }
        await this.event(s, actor, name, a.projectId, a.id, doc); return doc;
      }
      if (name === 'transfer_task') {
        const plan = await this.taskTransferPlan(actor, a, s);
        requireThat(plan.eligible, plan.blockers.join(' '));
        requireThat(plan.planHash === a.planHash, 'Transfer plan changed or confirmation is stale; preview the transfer again');
        const task = plan.internal.task;
        const sourceFilter = { projectId: a.projectId };
        const updateScope = async (model: Model<any>, filter: any, expected: number) => {
          const result = await model.updateMany(filter, { $set: { projectId: a.targetProjectId } }, { session: s });
          requireThat(result.matchedCount === expected, 'Transfer references changed; preview the transfer again');
        };
        const executionIds = plan.internal.executions.map((item: any) => item._id);
        if (executionIds.length) await updateScope(Execution, { _id: { $in: executionIds } }, executionIds.length);
        if (plan.internal.messages.length) await updateScope(TaskMessage, { ...sourceFilter, _id: { $in: plan.internal.messages.map((item: any) => item._id) } }, plan.internal.messages.length);
        if (plan.internal.conversations.length) await updateScope(Conversation, { ...sourceFilter, _id: { $in: plan.internal.conversations.map((item: any) => item._id) } }, plan.internal.conversations.length);
        if (plan.internal.conversationMessages.length) await updateScope(ConversationMessage, { ...sourceFilter, _id: { $in: plan.internal.conversationMessages.map((item: any) => item._id) } }, plan.internal.conversationMessages.length);
        if (plan.internal.actionProposals.length) await updateScope(ActionProposal, { ...sourceFilter, _id: { $in: plan.internal.actionProposals.map((item: any) => item._id) } }, plan.internal.actionProposals.length);
        if (plan.internal.diffs.length) await updateScope(TaskDiff, { ...sourceFilter, _id: { $in: plan.internal.diffs.map((item: any) => item._id) } }, plan.internal.diffs.length);
        const documentIds = plan.internal.documents.map((document: any) => document._id);
        if (documentIds.length) {
          await updateScope(MarkdownDocument, { ...sourceFilter, _id: { $in: documentIds } }, documentIds.length);
          await MarkdownRevision.updateMany({ ...sourceFilter, documentId: { $in: documentIds } }, { $set: { projectId: a.targetProjectId } }, { session: s });
        }
        if (plan.internal.jobs.length) {
          const jobs = await AutomationJob.updateMany({ ...sourceFilter, _id: { $in: plan.internal.jobs.map((item: any) => item._id) } }, { $set: { projectId: a.targetProjectId } }, { session: s });
          requireThat(jobs.matchedCount === plan.internal.jobs.length, 'Transfer references changed; preview the transfer again');
        }
        const eventIds = plan.internal.events.map((event: any) => event._id);
        if (eventIds.length) await updateScope(Event, { ...sourceFilter, _id: { $in: eventIds } }, eventIds.length);

        const changed = await Task.updateOne(
          { _id: a.taskId, projectId: a.projectId, version: a.version, archived: false },
          { $set: { projectId: a.targetProjectId, repositoryId: a.targetRepositoryId, featureId: a.targetFeatureId }, $inc: { version: 1 } },
          { session: s }
        );
        requireThat(changed.matchedCount === 1, 'Task version conflict');
        const movedTask = await Task.findById(a.taskId).session(s);
        requireThat(movedTask, 'Transferred task not found', 404);
        const audit = {
          operationId: a.operationId, taskId: a.taskId, sourceProjectId: a.projectId, targetProjectId: a.targetProjectId,
          sourceRepositoryId: task.repositoryId, targetRepositoryId: a.targetRepositoryId,
          sourceFeatureId: task.featureId ?? null, targetFeatureId: a.targetFeatureId,
          previousVersion: a.version, version: movedTask.version, moved: plan.moveCounts
        };
        await this.event(s, actor, name, a.projectId, a.taskId, audit);
        await this.event(s, actor, name, a.targetProjectId, a.taskId, audit);
        return { operationId: a.operationId, sourceProjectId: a.projectId, targetProjectId: a.targetProjectId, task: movedTask, moved: plan.moveCounts };
      }
      const t = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
      requireThat(t && t.version === a.version, 'Task missing or version conflict');
      if (t.featureId) requireThat(await Feature.exists({ _id: t.featureId, archived: false }).session(s), 'Feature archived');
      if (name === 'set_task_status') {
        const changed = await this.applyTaskStatus(actor, t, a, s, name, a.operationId);
        await this.automation.afterTaskMutation(actor, t, name, s);
        return changed;
      }
      const now = new Date();
      if (name === 'set_acceptance_criterion') {
        requireThat(t.status === 'em_execucao' && t.executionId === a.executionId && t.leaseUntil! > now, 'Execution inactive or expired');
        const acceptance = t.acceptance ?? [];
        requireThat(a.criterionIndex < acceptance.length, 'Acceptance criterion index out of range', 400);
        const execution = await Execution.findOne({ _id: a.executionId, taskId: t._id, credentialId: actor.id }).session(s);
        requireThat(execution, 'Execution belongs to another credential', 403);
        const progress = Array.from({ length: acceptance.length }, (_value, index) => t.acceptanceProgress?.[index] === true);
        progress[a.criterionIndex] = a.complete;
        t.acceptanceProgress = progress;
        execution.lastActivity = now;
        t.leaseUntil = new Date(now.getTime() + this.leaseMs);
        await execution.save({ session: s });
        t.version! += 1;
        await t.save({ session: s });
        await this.automation.afterTaskMutation(actor, t, name, s);
        await this.event(s, actor, name, a.projectId, a.taskId, { ...a, task: plain(t), repositoryId: t.repositoryId });
        return t;
      }
      if (name === 'send_task_message') {
        requireThat(t.status === 'em_execucao' && t.executionId === a.executionId && t.leaseUntil! > now, 'Execution inactive or expired');
        const execution = await Execution.findOne({ _id: a.executionId, taskId: t._id, credentialId: actor.id }).session(s);
        requireThat(execution, 'Execution belongs to another credential', 403);
        if (a.relatedTaskId) {
          const related = await Task.findOne({ _id: a.relatedTaskId, projectId: a.projectId, archived: false }).session(s);
          requireThat(related && (!!t.featureId && related.featureId === t.featureId || related.dependencies.includes(t._id!) || t.dependencies.includes(related._id!)), 'Tasks are not related', 403);
        }
        const [message] = await TaskMessage.create([{ _id: randomUUID(), projectId: a.projectId, taskId: t._id, relatedTaskId: a.relatedTaskId, executionId: a.executionId, operationId: a.operationId, author: actor.userId, type: a.type, message: a.message, references: a.references, createdAt: now }], { session: s });
        await this.automation.validateReply(a, s);
        Object.assign(message, { credentialId: actor.id, conversationId: a.conversationId, replyTo: a.replyTo, correlationId: a.correlationId }); await message.save({ session: s });
        await this.automation.onMessage(message, s);
        await this.event(s, actor, 'task_message', a.projectId, message._id!, { taskId: t._id, relatedTaskId: a.relatedTaskId, type: a.type });
        return message;
      }
      if (name === 'claim_task') {
        const orphaned = t.status === 'em_execucao' && !t.responsible?.trim() && !t.executionId && !t.leaseUntil
          && !await Execution.exists({ taskId: t._id }).session(s);
        requireThat(t.status === 'pendente' || orphaned, 'Task unavailable');
        const complete = await Task.countDocuments({ _id: { $in: t.dependencies }, projectId: a.projectId, status: 'concluida' }).session(s);
        requireThat(complete === new Set(t.dependencies).size, 'Dependencies not approved');
        if (actor.scope === 'trusted_local') {
          const project = await Project.findById(a.projectId).session(s);
          if (project?.visibility !== 'private' && !project?.members?.has(memberKey(actor.userId))) {
            project!.members!.set(memberKey(actor.userId), 'colaborador'); project!.version! += 1; await project!.save({ session: s });
            await this.event(s, actor, 'auto_member', a.projectId, a.projectId, { userId: actor.userId, role: 'colaborador' });
          }
        }
        t.executionId = randomUUID(); t.status = 'em_execucao'; t.responsible = this.responsibleFor(actor); t.leaseUntil = new Date(now.getTime() + this.leaseMs);
        await Execution.create([{ _id: t.executionId, projectId: a.projectId, taskId: t._id, credentialId: actor.id, userId: actor.userId, agent: a.agent, managedJobId: actor.jobId, startedAt: now, lastActivity: now, status: 'em_execucao' }], { session: s });
      } else {
        requireThat(t.status === 'em_execucao' && t.executionId === a.executionId && t.leaseUntil! > now, 'Execution inactive or expired');
        const e = await Execution.findOne({ _id: a.executionId, credentialId: actor.id }).session(s);
        requireThat(e, 'Execution belongs to another credential', 403);
        e.lastActivity = now; t.leaseUntil = new Date(now.getTime() + this.leaseMs);
        if (name === 'record_progress') e.progress.push(a.message);
        if (name === 'block_task') { t.status = 'bloqueada'; e.impediments.push(a.reason); }
        if (name === 'submit_task') { t.status = 'em_revisao'; e.result = a.result; }
        if (t.status !== 'em_execucao') { e.status = t.status; e.endedAt = now; t.leaseUntil = undefined; }
        await e.save({ session: s });
      }
      t.version! += 1; await t.save({ session: s });
      await this.automation.afterTaskMutation(actor, t, name, s);
      await this.event(s, actor, name, a.projectId, a.taskId, { ...a, task: plain(t), repositoryId: t.repositoryId, branch: a.result?.branch, commit: a.result?.commit, agent: a.agent }); return t;
    });
    if (['create_project', 'edit_record', 'archive_record'].includes(name) && (name === 'create_project' || a.kind === 'project')) return projectDto(result);
    return result;
  }
  async query(actor: Actor, name: string, input: unknown) {
    requireThat(['agent', 'human', 'trusted_local'].includes(actor.scope), 'Invalid scope', 403);
    const schema = tools[name as keyof typeof tools];
    requireThat(schema, 'Unknown query', 404);
    const args = schema.parse(input);
    requireThat(!('operationId' in args), 'Read-only query required', 400);
    return this.read(actor, name, args);
  }
  private async read(actor: Actor, name: string, a: any) {
    if (a.projectId) await this.access(actor, a.projectId);
    else requireThat((name === 'list_records' && a.kind === 'project') || name === 'resolve_project_context', 'Project required', 400);
    if (name === 'preview_task_transfer') {
      const plan = await this.taskTransferPlan(actor, a);
      const { internal: _internal, ...preview } = plan;
      return preview;
    }
    if (name === 'get_task_context') {
      const context = await getTaskContext(a.projectId, a.taskId, actor.scope === 'human' || actor.systemAdmin);
      requireThat(context, 'Task not found', 404);
      const readCursor = await this.taskReadCursor(a.projectId, actor.userId, a.taskId);
      const unread = await DeliveryEvent.exists({ projectId: a.projectId, taskIds: a.taskId, sequence: { $gt: readCursor }, author: { $ne: actor.userId } });
      return { ...context, task: { ...context.task, readCursor, unread: !!unread } };
    }
    if (name === 'list_conversations') return this.conversations.list(a);
    if (name === 'get_conversation') return this.conversations.get(a);
    const page = async (model: Model<any>, filter: any) => {
      const startedAt = Date.now();
      try {
        const result = await pageByCreatedAt(model, filter, a.after, a.limit);
        logger.debug('mcp page query completed', { collection: model.collection.collectionName, rows: result.items.length, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        if (error instanceof PageCursorError) throw new DomainError(error.message, 400);
        throw error;
      }
    };
    if (name === 'get_automation_status') return this.automation.status(actor, a);
    if (name === 'get_project_sync_report') return this.projectSyncReport(actor, a);
    if (name === 'get_project_novelties') {
      const read = await DeliveryRead.findOne({ projectId: a.projectId, userId: actor.userId }).lean();
      const after = a.after ?? read?.lastSequence ?? 0;
      const baseline = await this.taskReadBaseline(a.projectId, actor.userId, undefined, true);
      const rows = await DeliveryEvent.find({ projectId: a.projectId, sequence: { $gt: after }, credentialId: { $ne: actor.id } }).sort({ sequence: 1 }).limit(a.limit + 1).lean();
      const more = rows.length > a.limit; if (more) rows.pop();
      const cursor = rows.at(-1)?.sequence ?? after;
      return { count: rows.length, cursor, hasMore: more, items: rows.map(item => ({ sequence: item.sequence, taskId: item.taskIds?.[0] ?? null, kind: item.kind ?? `project.${item.action}`, summary: item.summary ?? item.action, author: item.author, at: item.at })), unreadTasks: await this.unreadTasks(actor, a.projectId, baseline) };
    }
    if (name.endsWith('_project_events')) {
      if (name === 'unsubscribe_project_events') return { subscribed: false };
      const filter = { projectId: a.projectId, taskIds: a.taskIds, actions: a.actions };
      const deadline = Date.now() + (a.timeoutMs ?? 0);
      let cursor = a.cursor;
      do {
        const wait = this.events.wait(filter, Math.max(1, deadline - Date.now()));
        let result;
        try { result = await readEvents(filter, cursor, a.limit ?? 50, name === 'subscribe_project_events'); }
        catch (error) { wait.cancel(); throw new DomainError((error as Error).message, 400); }
        if (name === 'subscribe_project_events' || result.items.length || Date.now() >= deadline || this.events.closed) { wait.cancel(); await this.access(actor, a.projectId); return { ...result, ...(name === 'subscribe_project_events' ? { subscribed: true } : {}) }; }
        cursor = result.cursor;
        await wait.promise; await this.access(actor, a.projectId);
      } while (true);
    }
    if (name === 'subscribe_task_events') {
      await this.access(actor, a.projectId);
      requireThat(await Task.exists({ _id: a.taskId, projectId: a.projectId, archived: false }), 'Task not found', 404);
      return { subscribed: true, projectId: a.projectId, taskId: a.taskId };
    }
    if (name === 'list_task_messages' || name === 'wait_task_events') {
      const readMessages = async () => {
        const filter: any = { projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] };
        if (a.after) { const cursor = await TaskMessage.findOne({ ...filter, _id: a.after }).lean(); requireThat(cursor, 'Invalid message cursor', 400); filter.$and = [{ $or: [{ createdAt: { $gt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $gt: a.after } }] }]; }
        const items = await TaskMessage.find(filter).select('_id projectId taskId relatedTaskId executionId author type message references createdAt conversationId replyTo').sort({ createdAt: 1, _id: 1 }).limit(a.limit).lean();
        let feed;
        try { feed = name === 'wait_task_events' ? await readEvents({ projectId: a.projectId, taskIds: [a.taskId] }, a.eventAfter, a.limit, !a.eventAfter) : undefined; }
        catch (error) { throw new DomainError((error as Error).message, 400); }
        const events = name === 'wait_task_events' ? a.eventAfter ? feed!.items : await Event.find({ projectId: a.projectId, entityId: a.taskId }).sort({ at: -1 }).limit(a.limit).lean() : [];
        return { items, events, next: items.length === a.limit ? items.at(-1)!._id : null, messageCursor: items.at(-1)?._id ?? a.after ?? null, eventCursor: feed?.cursor };
      };
      let result = await readMessages();
      if (name === 'wait_task_events' && !result.items.length && !result.events.length && a.timeoutMs > 0) { const deadline = Date.now() + a.timeoutMs; while (Date.now() < deadline && !result.items.length && !result.events.length) { await this.events.wait({ projectId: a.projectId, taskIds: [a.taskId] }, Math.min(1000, deadline - Date.now())).promise; await this.access(actor, a.projectId); result = await readMessages(); } }
      return result;
    }    if (name === 'list_records' || name === 'list_pending') {
      const kind = name === 'list_pending' ? 'task' : a.kind;
      const trustedFilter = actor.projectToken ? { $or: [{ visibility: { $ne: 'private' } }, { accessTokenHash: hash(actor.projectToken) }] } : { visibility: { $ne: 'private' } };
      const projectAccessFilter = actor.scope === 'trusted_local'
        ? trustedFilter
        : actor.systemAdmin ? {} : { [`members.${memberKey(actor.userId)}`]: { $exists: true } };
      const filter: any = kind === 'project' ? { ...projectAccessFilter, ...(a.projectId ? { _id: a.projectId } : {}) } : { projectId: a.projectId };
      filter.archived = a.archived ?? false;
      if (kind === 'task') {
        for (const key of ['area', 'responsible', 'status']) if (a[key]) filter[key] = a[key];
        if (a.featureId) filter.featureId = a.featureId;
        if (a.search) filter.name = { $regex: `^${a.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' };
        const clauses: any[] = [];
        if (a.withoutFeature) clauses.push({ $or: [{ featureId: { $exists: false } }, { featureId: null }] });
        if (a.type) clauses.push({ $or: [{ type: a.type }, ...(a.type === 'feature' ? [{ type: { $exists: false } }] : [])] });
        if (clauses.length) filter.$and = clauses;
      }
      requireThat(!a.search || kind === 'task', 'Search is only supported for tasks', 400);
      if (name === 'list_pending') filter.status = 'pendente';
      const result = await page(models[kind], filter);
      if (kind === 'task' || kind === 'feature') {
        const ids = result.items.map((x: any) => x._id);
        const counts = await MarkdownDocument.aggregate([{ $match: { projectId: a.projectId, targetKind: kind, targetId: { $in: ids } } }, { $group: { _id: '$targetId', count: { $sum: 1 } } }]);
        const map = Object.fromEntries(counts.map((x: any) => [x._id, x.count])); result.items = result.items.map((x: any) => ({ ...x, type: kind === 'task' ? x.type ?? 'feature' : undefined, markdownCount: map[x._id] ?? 0 }));
      }
      if (kind === 'project') result.items = result.items.map(projectDto);
      return result;
    }
    if (name === 'resolve_project_context') {
      const accessFilter = actor.scope === 'trusted_local'
        ? actor.projectToken ? { $or: [{ visibility: { $ne: 'private' } }, { accessTokenHash: hash(actor.projectToken) }] } : { visibility: { $ne: 'private' } }
        : actor.systemAdmin ? {} : { [`members.${memberKey(actor.userId)}`]: { $exists: true } };
      const projects = await Project.find({ ...accessFilter, archived: false }).select('_id name repositories').lean();
      const workspaceRoot = normalizeWorkspaceRoot(a.workspaceRoot);
      const remoteUrl = a.remoteUrl ? normalizeGitRemote(a.remoteUrl) : undefined;
      const rootCommit = a.rootCommit?.toLowerCase();
      const matches = projects.flatMap((project: any) => (project.repositories ?? []).filter((repository: any) => {
        const pathMatches = normalizeWorkspaceRoot(repository.url) === workspaceRoot;
        const binding = repository.git;
        const remoteMatches = !!remoteUrl && normalizeGitRemote(binding?.canonicalRemoteUrl ?? repository.url) === remoteUrl
          && (!rootCommit || !binding?.rootCommit || binding.rootCommit.toLowerCase() === rootCommit);
        return pathMatches || remoteMatches;
      }).map((repository: any) => ({ projectId: project._id, projectName: project.name, repositoryId: repository.id, repositoryName: repository.name })));
      const byProject = new Map<string, typeof matches>();
      for (const match of matches) byProject.set(String(match.projectId), [...(byProject.get(String(match.projectId)) ?? []), match]);
      const projectsMatched = [...byProject.values()];
      if (matches.length === 1) {
        const first = matches[0];
        return { status: 'matched', projectId: first.projectId, projectName: first.projectName, repositories: [{ repositoryId: first.repositoryId, repositoryName: first.repositoryName }] };
      }
      return { status: projectsMatched.length ? 'ambiguous' : 'not_found', projectId: null, matches: projectsMatched.map(projectMatches => ({ projectId: projectMatches[0].projectId, projectName: projectMatches[0].projectName, repositories: projectMatches.map(({ repositoryId, repositoryName }) => ({ repositoryId, repositoryName })) })) };
    }
    if (name === 'list_markdowns') return this.markdowns(a.projectId, a.targetKind, a.targetId, a.after, a.limit);
    if (name === 'list_task_diffs') return page(TaskDiff, { projectId: a.projectId, taskId: a.taskId });
    if (name === 'get_task_diff') {
      const diff = await TaskDiff.findOne({ _id: a.id, projectId: a.projectId, taskId: a.taskId }).lean(); requireThat(diff, 'Task diff not found', 404); return diff;
    }
    if (name === 'list_markdown_revisions') {
      const doc = await MarkdownDocument.findOne({ _id: a.id, projectId: a.projectId }).lean(); requireThat(doc, 'Markdown not found', 404);
      const rows = await MarkdownRevision.find({ documentId: a.id, ...(a.after ? { revision: { $lt: a.after } } : {}) }).sort({ revision: -1 }).limit(a.limit + 1).lean(); const more = rows.length > a.limit; if (more) rows.pop();
      return { items: rows.map(({ content, ...revision }: any) => revision), next: more ? rows.at(-1)!.revision : null };
    }
    if (name === 'get_markdown') {
      const doc = await MarkdownDocument.findOne({ _id: a.id, projectId: a.projectId }).lean(); requireThat(doc, 'Markdown not found', 404);
      const revision = await MarkdownRevision.findOne({ documentId: a.id, revision: a.revision ?? doc.revision }).lean(); requireThat(revision, 'Markdown revision not found', 404);
      const lines = revision.content!.split('\n'); const start = a.line - 1; const selected: string[] = []; let size = 0;
      for (const line of lines.slice(start, start + a.limit)) { const next = Buffer.byteLength((selected.length ? '\n' : '') + line, 'utf8'); if (selected.length && size + next > 32 * 1024) break; selected.push(line); size += next; }
      const nextLine = start + selected.length < lines.length ? start + selected.length + 1 : null;
      return { document: this.markdownMeta(doc), revision: ({ ...revision, content: undefined }), line: a.line, content: selected.join('\n'), nextLine };
    }
    if (name === 'get_record') {
      requireThat(a.kind !== 'project' || a.id === a.projectId, 'Project mismatch', 404);
      const record = await models[a.kind].findOne({ _id: a.id, ...(a.kind === 'project' ? {} : { projectId: a.projectId }) }).lean();
      requireThat(record, 'Record not found', 404);
      if (a.kind === 'project') return projectDto(record);
      return record;
    }
    if (name === 'list_executions') return page(Execution, { projectId: a.projectId, taskId: a.taskId });
    if (name === 'get_history') {
      const filter = { projectId: a.projectId, ...(a.entityId ? { entityId: a.entityId } : {}) };
      const startedAt = Date.now();
      try {
        const result = await pageByDate(Event, filter, a.after, a.limit, 'at', false);
        logger.debug('mcp page query completed', { collection: Event.collection.collectionName, rows: result.items.length, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        if (error instanceof PageCursorError) throw new DomainError(error.message, 400);
        throw error;
      }
    }
    if (name === 'get_summary') {
      if (a.featureId) requireThat(await Feature.exists({ _id: a.featureId, projectId: a.projectId }), 'Feature not found', 404);
      const counts = Object.fromEntries(states.map(s => [s, 0]));
      const match = { projectId: a.projectId, ...(a.featureId ? { featureId: a.featureId } : {}) };
      const rows = await Task.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
      for (const row of rows) counts[row._id] = row.count;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const remaining = total - counts.concluida - counts.cancelada;
      const typeRows = await Task.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$type', 'feature'] }, count: { $sum: 1 } } }]);
      return { counts, typeCounts: Object.fromEntries(typeRows.map((row: any) => [row._id, row.count])), blocked: counts.bloqueada, remaining, completed: total > 0 && counts.concluida > 0 && remaining === 0 };
    }
    if (name === 'get_project_area_summary') {
      if (a.featureId) requireThat(await Feature.exists({ _id: a.featureId, projectId: a.projectId }), 'Feature not found', 404);
      const project = await Project.findById(a.projectId).lean();
      const tasks = await Task.find({ projectId: a.projectId, archived: false, ...(a.featureId ? { featureId: a.featureId } : {}) }).sort({ area: 1, status: 1, priority: 1, _id: 1 }).lean();
      const label: Record<string, string> = { backend: 'Backend', frontend: 'Frontend', outro: 'Outro' };
      const escape = (value: string) => value.replace(/[|\x0D\x0A]/g, ' ');
      const lines = [`# Resumo do projeto: ${escape(project!.name!)}`, '', `Gerado em ${new Date().toISOString()}.${a.featureId ? ` Filtrado pela feature ${a.featureId}.` : ''}`];
      for (const area of ['backend', 'frontend', 'outro']) {
        const rows = tasks.filter(t => t.area === area); lines.push('', `## ${label[area]}`, '');
        for (const group of [['Concluídas', rows.filter(t => t.status === 'concluida')], ['Pendentes', rows.filter(t => t.status === 'pendente')], ['Outros estados', rows.filter(t => !['concluida', 'pendente'].includes(t.status!))]] as const) {
          lines.push(`### ${group[0]} (${group[1].length})`);
          if (!group[1].length) lines.push('- Nenhuma.');
          else for (const task of group[1]) lines.push(`- [${task.status}] [${task.type ?? 'feature'}] ${escape(task.name!)}`);
          lines.push('');
        }
      }
      return { markdown: lines.join('\n').trimEnd() + '\n', generatedAt: new Date().toISOString(), taskCount: tasks.length };
    }
    const taskMessages = await TaskMessage.find({ projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] }).select('_id taskId relatedTaskId author type message references createdAt conversationId replyTo').sort({ createdAt: -1, _id: -1 }).limit(10).lean();
    const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId }).lean();
    requireThat(task, 'Task not found', 404);
    const projectRecord = await Project.findById(a.projectId).select('_id version name description instructions').lean();
    requireThat(projectRecord, 'Project not found', 404);
    const repositoryRecord = await Project.findOne({ _id: a.projectId, 'repositories.id': task.repositoryId }).select({ 'repositories.$': 1 }).lean();
    const repository = repositoryRecord?.repositories?.[0] ?? null;
    const project = projectRecord;
    const feature = task.featureId ? await Feature.findById(task.featureId).select('_id version name objective context acceptance').lean() : null;
    const dependencies = task.dependencies?.length ? await Task.find({ _id: { $in: task.dependencies }, projectId: a.projectId }).select('_id name status area type executionId').lean() : [];
    const executionIds = dependencies.flatMap(d => d.executionId ? [d.executionId] : []);
    const results = executionIds.length ? await Execution.find({ _id: { $in: executionIds } }).select('_id status result.summary result.evidence').lean() : [];
    const [taskMarkdowns, featureMarkdowns] = await Promise.all([this.markdowns(a.projectId, 'task', task._id!, undefined, 10), task.featureId ? this.markdowns(a.projectId, 'feature', task.featureId, undefined, 10) : Promise.resolve({ items: [], next: null })]);
    if (name === 'get_task_markdown_summary') {
      const escape = (value: string) => value.replace(/[\x0D\x0A]/g, ' ').replace(/#/g, '\\#');
      const escapeInline = (value: string) => value.replace(/[\x0D\x0A]+/g, ' ').slice(0, 500).replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&');
      const date = (value?: Date | null) => value ? new Date(value).toISOString() : 'Não informado';
      const conversations = await Conversation.find({ projectId: a.projectId, taskId: a.taskId, status: { $ne: 'deleted' } })
        .select('_id title status createdAt updatedAt lastMessageAt').sort({ lastMessageAt: -1, createdAt: -1, _id: -1 }).limit(10).lean();
      const recentConversationMessages = await Promise.all(conversations.map(conversation =>
        ConversationMessage.find({ projectId: a.projectId, conversationId: conversation._id })
          .select('_id author content createdAt').sort({ createdAt: -1, _id: -1 }).limit(3).lean()
      ));
      const lines = [`# ${escape(task.name!)}`, '', '## Identificação', '', `- **ID:** \`${task._id}\``, `- **Status:** \`${task.status}\``, `- **Área:** ${task.area}`, `- **Tipo:** ${task.type ?? 'feature'}`, `- **Prioridade:** ${task.priority}`, `- **Responsável:** ${task.responsible ?? 'Não atribuído'}`, `- **Criada em:** ${date(task.createdAt)}`, `- **Atualizada em:** ${date(task.updatedAt)}`, '', '## Projeto', '', `- **Nome:** ${escape(project!.name!)}`, `- **Descrição:** ${project!.description || '_Não informada._'}`, '', '## Feature', ''];
      if (feature) lines.push(`- **Nome:** ${escape(feature.name!)}`, `- **Objetivo:** ${feature.objective || '_Não informado._'}`, `- **Contexto:** ${feature.context || '_Não informado._'}`); else lines.push('_Tarefa independente, sem feature vinculada._');
      lines.push('', '## Repositório', '');
      if (repository) lines.push(`- **Nome:** ${escape(repository.name ?? 'Não informado')}`, `- **URL:** ${repository.url}`, `- **Instruções:** ${repository.instructions || '_Não informadas._'}`); else lines.push('_Repositório não encontrado no projeto._');
      lines.push('', '## Instruções', '', task.instructions || '_Não informado._', '');
      const acceptanceTotal = task.acceptance?.length ?? 0;
      const acceptanceCompleted = task.acceptance?.reduce((count, _item, index) => count + (task.acceptanceProgress?.[index] === true ? 1 : 0), 0) ?? 0;
      lines.push('', `## Critérios de aceite <!-- acceptance-progress:${acceptanceCompleted}:${acceptanceTotal} -->`, '');
      if (task.acceptance?.length) for (const [index, item] of task.acceptance.entries()) lines.push(`- [${task.acceptanceProgress?.[index] === true ? 'x' : ' '}] ${item}`); else lines.push('_Nenhum critério informado._');
      lines.push('', `## Dependências (${dependencies.length})`, '');
      if (dependencies.length) for (const dependency of dependencies) { const execution = results.find(item => item._id === dependency.executionId); lines.push(`- **${escape(dependency.name!)}** — \`${dependency.status}\`${execution ? `; execução: \`${execution.status}\`` : ''}`); } else lines.push('_Sem dependências._');
      const executions = await Execution.find({ taskId: task._id }).sort({ startedAt: -1 }).limit(25).lean();
      lines.push('', `## Execuções (${executions.length})`, '');
      if (executions.length) for (const execution of executions) { lines.push(`- **${execution.status}** — iniciada em ${date(execution.startedAt)}`); if (execution.result?.summary) lines.push(`  - Resultado: ${execution.result.summary}`); if (execution.result?.evidence?.length) lines.push(`  - Evidências: ${execution.result.evidence.join('; ')}`); } else lines.push('_Nenhuma execução registrada._');
      lines.push('', `## Mensagens (${taskMessages.length})`, '');
      if (taskMessages.length) for (const message of taskMessages) lines.push(`- **${message.type}** por ${message.author} em ${date(message.createdAt)}: ${message.message}`); else lines.push('_Nenhuma mensagem registrada._');
      lines.push('', `## Conversas vinculadas (${conversations.length})`, '');
      if (conversations.length) for (const [index, conversation] of conversations.entries()) {
        lines.push(`### ${escape(conversation.title || 'Nova conversa')}`, '', `- **ID:** \`${conversation._id}\``, `- **Última atividade:** ${date(conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt)}`);
        const messages = recentConversationMessages[index].slice().reverse();
        if (messages.length) {
          lines.push('- **Mensagens recentes:**');
          for (const message of messages) lines.push(`  - **${escapeInline(message.author ?? 'Desconhecido')}** (${date(message.createdAt)}): ${escapeInline(message.content ?? '')}`);
        } else lines.push('- _Nenhuma mensagem enviada._');
        lines.push('');
      } else lines.push('_Nenhuma conversa vinculada._');
      const documents = [...taskMarkdowns.items.map(document => ({ scope: 'tarefa', ...document })), ...featureMarkdowns.items.map(document => ({ scope: 'feature', ...document }))];
      lines.push('', `## Documentos (${documents.length})`, '');
      if (documents.length) for (const document of documents) lines.push(`- **${escape(document.name)}** (${document.scope}, revisão ${document.revision})${document.summary ? ` — ${document.summary}` : ''}`); else lines.push('_Nenhum documento vinculado._');
      return {
        markdown: lines.join('\n').trimEnd() + '\n', generatedAt: new Date().toISOString(), taskId: task._id,
        linkedConversations: conversations.map((conversation, index) => ({
          conversationId: conversation._id, title: conversation.title || 'Nova conversa',
          lastActivityAt: conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt,
          messageCount: recentConversationMessages[index].length
        }))
      };
    }
    throw new DomainError('Unknown query', 404);
  }
  async admin(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const a = adminSchema.parse(input);
    if (a.action === 'automation_policy' || a.action === 'automation_release' || a.action === 'automation_resolve') return this.automation.admin(actor, a);
    const projectAdminRequired = new Set<string>(['bind_repository_git', 'issue_project_member', 'member']).has(a.action);
    const result = await this.mutate(actor, 'admin', a, async s => {
      if (a.action === 'bind_repository_git') {
        const project = await Project.findOne({ _id: a.projectId, version: a.version, archived: false }).session(s);
        requireThat(project, 'Project version conflict or archived', 409);
        const repository: any = project.repositories.find(item => item.id === a.repositoryId);
        requireThat(repository, 'Unknown repository', 404);
        repository.git = { canonicalRemoteUrl: a.canonicalRemoteUrl, rootCommit: a.rootCommit.toLowerCase(), boundAt: new Date(), boundBy: actor.userId };
        project.version! += 1; await project.save({ session: s });
        await this.event(s, actor, 'bind_repository_git', a.projectId, a.projectId, { repositoryId: a.repositoryId, git: repository.git });
        return project;
      }
      if (a.action === 'issue_project_member') {
        const project = await Project.findOne({ _id: a.projectId, version: a.version, archived: false }).session(s);
        requireThat(project, 'Project version conflict or archived', 409);
        const key = memberKey(a.userId);
        const previousRole = project.members?.get(key);
        const role = previousRole === 'administrador' ? previousRole : 'colaborador';
        if (previousRole !== role) {
          project.members!.set(key, role);
          project.version! += 1;
          await project.save({ session: s });
        }
        const credentialId = randomUUID();
        await Credential.create([{ _id: credentialId, userId: a.userId, scope: 'human', hash: hash(a.token), systemAdmin: false }], { session: s });
        await this.event(s, actor, a.action, a.projectId, credentialId, { credentialId, userId: a.userId, role });
        return { credentialId, version: project.version };
      }
      if (a.action === 'issue' || a.action === 'revoke') {
        requireThat(actor.systemAdmin, 'System administrator required', 403);
        let entityId: string;
        if (a.action === 'issue') {
          requireThat(!a.systemAdmin || a.scope === 'human', 'System administrator must have human scope');
          entityId = randomUUID();
          await Credential.create([{ _id: entityId, userId: a.userId, scope: a.scope, hash: hash(a.token), systemAdmin: a.systemAdmin }], { session: s });
        } else {
          entityId = a.credentialId;
          requireThat(entityId !== actor.id, 'Cannot revoke own administrative credential');
          requireThat((await Credential.updateOne({ _id: entityId }, { revoked: true }, { session: s })).matchedCount, 'Credential not found', 404);
        }
        await this.event(s, actor, a.action, undefined, entityId, { credentialId: entityId }); return { credentialId: entityId };
      }
      if (a.action === 'member') {
        const p = await Project.findById(a.projectId).session(s);
        requireThat(p!.version === a.version, 'Version conflict');
        if (a.role) p!.members!.set(memberKey(a.userId), a.role); else p!.members!.delete(memberKey(a.userId));
        requireThat([...p!.members!.values()].includes('administrador'), 'Last project administrator required');
        p!.version! += 1;
        await p!.save({ session: s }); await this.event(s, actor, a.action, a.projectId, a.projectId, a); return p;
      }
      const t = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
      requireThat(t && t.version === a.version, 'Version conflict');
      const allowed = { approve: ['em_revisao'], changes: ['em_revisao'], unblock: ['bloqueada'], cancel: ['pendente', 'em_execucao', 'bloqueada', 'em_revisao'] };
      requireThat(allowed[a.decision].includes(t.status!), 'Invalid review transition');
      t.status = ({ approve: 'concluida', changes: 'pendente', unblock: 'pendente', cancel: 'cancelada' })[a.decision];
      if (t.executionId) await Execution.updateOne({ _id: t.executionId }, { status: a.decision, endedAt: new Date() }, { session: s });
      t.leaseUntil = undefined; t.version! += 1;
      if (['changes', 'unblock', 'cancel'].includes(a.decision)) await AutomationJob.updateMany({ taskId: t._id }, { $set: { authorizationValid: false }, $inc: { version: 1 } }, { session: s });
      await t.save({ session: s }); await this.event(s, actor, a.decision, a.projectId, a.taskId, a); return t;
    }, projectAdminRequired);
    return result;
  }
  async approveTasks(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const body = approveTasksSchema.parse(input);
    const operationId = randomUUID();
    return this.mutate(actor, 'admin', { action: 'approve_tasks', operationId, ...body }, async s => {
      const tasks = await Task.find({ _id: { $in: body.taskIds }, projectId: body.projectId, archived: false }).session(s);
      requireThat(tasks.length === body.taskIds.length, 'Task not found', 404);
      requireThat(tasks.every(task => task.status === 'em_revisao'), 'Only tasks in review can be approved');
      const byId = new Map(tasks.map(task => [task._id!, task]));
      for (const taskId of body.taskIds) {
        const task = byId.get(taskId)!;
        task.status = 'concluida'; task.leaseUntil = undefined; task.version! += 1;
        if (task.executionId) await Execution.updateOne({ _id: task.executionId }, { status: 'approve', endedAt: new Date() }, { session: s });
        await task.save({ session: s });
        await this.event(s, actor, 'approve', body.projectId, taskId, { action: 'approve', operationId, projectId: body.projectId, taskId, reason: body.reason, task: plain(task) });
      }
      return { operationId, tasks: body.taskIds.map(taskId => plain(byId.get(taskId)!)) };
    }, false);
  }
  async approveActionProposal(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const body = approveActionProposalSchema.parse(input);
    return this.mutate(actor, 'approve_action_proposal', body, async s => {
      const proposal = await ActionProposal.findOne({ _id: body.proposalId, projectId: body.projectId }).session(s);
      requireThat(proposal && proposal.version === body.version && proposal.status === 'pending', 'Proposal missing, already handled, or version conflict');
      const task = await Task.findOne({ _id: proposal.taskId, projectId: body.projectId, archived: false }).session(s);
      requireThat(task && task.version === proposal.expectedTaskVersion && task.status === 'pendente', 'Task version conflict or task is not pending');
      const conversation = await Conversation.findOne({ _id: proposal.conversationId, projectId: body.projectId, status: 'open' }).session(s);
      requireThat(conversation, 'Conversation not found or closed', 404);
      const policy = await AutomationPolicy.findById(body.projectId).session(s);
      const provider = proposal.provider ?? policy?.routes.find(route => route.repositoryId === task.repositoryId && route.area === task.area)?.provider;
      requireThat(policy?.enabled && provider, 'Enable automation and configure a provider route before approving execution', 409);
      requireThat(!await AutomationJob.exists({ taskId: task._id, status: { $in: ['reserved', 'running', 'waiting_human'] } }).session(s), 'Task has an active runner');

      if (proposal.taskPatch?.instructions !== undefined) task.instructions = proposal.taskPatch.instructions;
      if (proposal.taskPatch?.acceptance !== undefined) {
        task.acceptance = proposal.taskPatch.acceptance;
        task.acceptanceProgress = proposal.taskPatch.acceptance.map(() => false);
      }
      task.version! += 1;
      await task.save({ session: s });
      await AutomationJob.updateMany({ projectId: body.projectId, taskId: task._id, status: 'queued' }, { $set: { status: 'cancelled', error: 'Superseded by approved conversation proposal' }, $inc: { version: 1 } }, { session: s });
      const [job] = await AutomationJob.create([{
        _id: randomUUID(), projectId: body.projectId, taskId: task._id, repositoryId: task.repositoryId,
        provider, fingerprint: await this.automation.fingerprint(task, s), authorizedBy: actor.userId,
        status: 'queued', conversationId: conversation._id
      }], { session: s });
      proposal.status = 'approved'; proposal.approvedBy = actor.userId; proposal.approvedAt = new Date();
      proposal.approvedTaskVersion = task.version; proposal.jobId = job._id; proposal.version! += 1;
      await proposal.save({ session: s });
      conversation.taskId = task._id; conversation.version! += 1;
      await conversation.save({ session: s });
      await this.event(s, actor, 'approve_action_proposal', body.projectId, proposal._id!, {
        conversationId: conversation._id, proposalId: proposal._id, taskId: task._id, jobId: job._id,
        taskVersion: task.version, provider
      });
      return {
        proposal: { _id: proposal._id, status: proposal.status, version: proposal.version },
        task: { _id: task._id, version: task.version, status: task.status },
        job: { _id: job._id, status: job.status, provider: job.provider }
      };
    }, false, true);
  }
  async changeTaskStatus(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const body = changeTaskStatusSchema.parse(input);
    const operationId = randomUUID();
    return this.mutate(actor, 'admin', { action: 'change_task_status', operationId, ...body }, async s => {
      const task = await Task.findOne({ _id: body.taskId, projectId: body.projectId, archived: false }).session(s);
      requireThat(task, 'Task not found', 404);
      return this.applyTaskStatus(actor, task, body, s, 'manual_status_change', operationId);
    }, false);
  }
  private async applyTaskStatus(actor: Actor, task: any, body: any, s: ClientSession, eventAction: string, operationId: string) {
    const allowed: Record<string, string[]> = {
      pendente: ['em_revisao', 'concluida', 'cancelada'],
      bloqueada: ['pendente', 'em_revisao', 'concluida', 'cancelada'],
      em_revisao: ['pendente', 'concluida', 'cancelada'],
      concluida: ['pendente']
    };
    requireThat(allowed[task.status!]?.includes(body.status), 'Invalid administrative status transition');
    task.status = body.status; task.leaseUntil = undefined; task.version! += 1;
    if (task.executionId && ['concluida', 'cancelada'].includes(body.status)) await Execution.updateOne({ _id: task.executionId }, { status: body.status === 'concluida' ? 'approve' : 'cancel', endedAt: new Date() }, { session: s });
    await AutomationJob.updateMany({ taskId: task._id }, { $set: { authorizationValid: false }, $inc: { version: 1 } }, { session: s });
    await task.save({ session: s });
    await this.event(s, actor, eventAction, body.projectId, body.taskId, { action: eventAction === 'manual_status_change' ? 'change_task_status' : eventAction, operationId, ...body, task: plain(task) });
    return { operationId, task: plain(task) };
  }
  async setTaskChecked(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const body = setTaskCheckedSchema.parse(input);
    return this.mutate(actor, 'set_task_checked', body, async s => {
      requireThat(await Project.exists({ _id: body.projectId, archived: false }).session(s), 'Project archived or not found', 404);
      const task = await Task.findOne({ _id: body.taskId, projectId: body.projectId, archived: false }).session(s);
      requireThat(task && task.version === body.version, 'Task version conflict or not found');
      task.checked = body.checked; task.checkedBy = actor.userId; task.checkedAt = new Date(); task.version! += 1;
      await task.save({ session: s });
      await this.event(s, actor, 'set_task_checked', body.projectId, body.taskId, { operationId: body.operationId, checked: body.checked, task: plain(task) });
      return { operationId: body.operationId, task: plain(task) };
    }, false, false);
  }
  async setTaskAcceptanceCriterion(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const body = setTaskAcceptanceCriterionSchema.parse(input);
    return this.mutate(actor, 'set_task_acceptance_criterion', body, async s => {
      const task: any = await Task.findOne({ _id: body.taskId, projectId: body.projectId, archived: false }).session(s);
      requireThat(task && task.version === body.version, 'Task version conflict or not found');
      const acceptance = task.acceptance ?? [];
      requireThat(body.criterionIndex < acceptance.length, 'Acceptance criterion index out of range', 400);
      const progress = Array.from({ length: acceptance.length }, (_value, index) => task.acceptanceProgress?.[index] === true);
      progress[body.criterionIndex] = body.complete;
      task.acceptanceProgress = progress;
      task.version! += 1;
      await task.save({ session: s });
      await this.event(s, actor, 'set_acceptance_criterion', body.projectId, body.taskId, { ...body, manual: true, task: plain(task) });
      return { operationId: body.operationId, task: plain(task) };
    }, false, true);
  }
  async expire() {
    const expired = await Task.find({ status: 'em_execucao', leaseUntil: { $lte: new Date() } }).select('_id').limit(100).lean();
    for (const row of expired) await mongoose.connection.transaction(async s => {
      const t = await Task.findOneAndUpdate({ _id: row._id, status: 'em_execucao', leaseUntil: { $lte: new Date() } }, { $set: { status: 'bloqueada' }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { returnDocument: 'after', session: s });
      if (!t) return;
      await Execution.updateOne({ _id: t.executionId }, { $set: { status: 'expired', endedAt: new Date() }, $push: { impediments: 'Execution lease expired; explicit human recovery required' } }, { session: s });
      await this.event(s, { id: 'system', userId: 'system', scope: 'system', systemAdmin: false }, 'expired', t.projectId!, t._id!, { executionId: t.executionId });
    });
  }
}
