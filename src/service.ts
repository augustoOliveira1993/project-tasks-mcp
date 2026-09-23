import mongoose, { type ClientSession, type Model } from 'mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Project, Feature, Task, Execution, Event, TaskMessage, DeliveryEvent, DeliveryRead, TaskDiff, AutomationJob, MarkdownDocument, MarkdownRevision, Operation, Credential, Bootstrap } from './db.js';
import { EventHub, readEvents } from './events.js';
import { Automation } from './automation.js';
import { tools, adminSchema, approveTasksSchema, changeTaskStatusSchema, projectData, featureData, taskData, states, userId as userIdSchema } from './schema.js';

export class DomainError extends Error { constructor(message: string, public status = 409) { super(message); } }
export type Actor = { id: string; userId: string; scope: string; systemAdmin: boolean; projectToken?: string; sessionId?: string; jobId?: string; runnerId?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const memberKey = (userId: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(userId) ? userId : 'email_' + hash(userId.toLowerCase()).slice(0, 32);
function requireThat(value: unknown, message: string, status = 409): asserts value { if (!value) throw new DomainError(message, status); }
const models: Record<string, Model<any>> = { project: Project, feature: Feature, task: Task };
export async function authenticate(token: string, scope: string): Promise<Actor> {
  const c = await Credential.findOne({ hash: hash(token), revoked: false, scope }).lean();
  requireThat(c, 'Invalid credential or scope', 401);
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
  async event(s: ClientSession, actor: Actor, action: string, projectId: string | undefined, entityId: string, data: any) {
    const eventId = randomUUID(); const at = new Date();
    const kind = ({ create_task: 'task.created', create_feature: 'feature.created', create_project: 'project.created', task_message: 'task.message.created', save_markdown: 'body.updated', update_markdown: 'body.updated', record_task_diff: 'task.diff.published', submit_task: 'task.submitted', claim_task: 'task.claimed', record_progress: 'task.progressed', block_task: 'task.blocked', approve: 'task.approved' } as Record<string, string>)[action] ?? `project.${action}`;
    const summary = ({ 'task.created': 'Tarefa criada', 'feature.created': 'Feature criada', 'project.created': 'Projeto criado', 'task.message.created': 'Mensagem adicionada à tarefa', 'body.updated': 'Documento Markdown atualizado', 'task.diff.published': 'Diff de código publicado', 'task.submitted': 'Tarefa enviada para revisão', 'task.claimed': 'Tarefa assumida', 'task.progressed': 'Progresso registrado', 'task.blocked': 'Tarefa bloqueada', 'task.approved': 'Tarefa aprovada' } as Record<string, string>)[kind] ?? action;
    const actorData = { userId: actor.userId, credentialId: actor.id, ...(data?.agent ? { agent: data.agent } : {}) };
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
  async mutate(actor: Actor, name: string, a: any, run: (s: ClientSession) => Promise<any>) {
    const key = `${actor.id}:${a.operationId}`;
    const fingerprint = hash(JSON.stringify({ name, a }));
    return mongoose.connection.transaction(async s => {
      // Serialize revocation with mutations; project fence below prevents graph write skew.
      if (actor.scope !== 'trusted_local') {
        const active = await Credential.updateOne({ _id: actor.id, revoked: false, scope: actor.scope }, { $inc: { fence: 1 } }, { session: s });
        requireThat(active.matchedCount, 'Credential revoked', 401);
      }
      if (a.projectId) await this.access(actor, a.projectId, false, name === 'admin', s);
      const old = await Operation.findById(key).session(s);
      if (old) { requireThat(old.fingerprint === fingerprint, 'Operation ID reused with different arguments'); return old.result; }
      if (a.projectId) await this.access(actor, a.projectId, true, name === 'admin', s);
      if (a.projectId) await Project.updateOne({ _id: a.projectId }, { $inc: { fence: 1 } }, { session: s });
      const result = plain(await run(s));
      await Operation.create([{ _id: key, fingerprint, result }], { session: s });
      return result;
    });
  }
  private async graph(projectId: string, taskId: string, data: any, s: ClientSession) {
    const p = await Project.findById(projectId).session(s);
    requireThat(p?.repositories.some(r => r.id === data.repositoryId), 'Unknown repository');
    if (data.featureId) requireThat(await Feature.exists({ _id: data.featureId, projectId, archived: false }).session(s), 'Unknown or archived feature');
    const nodes = await Task.find({ projectId }).session(s).lean();
    const graph = new Map(nodes.map(t => [t._id!, t.dependencies]));
    for (const dep of data.dependencies) requireThat(nodes.some(t => t._id === dep && !t.archived && t.status !== 'cancelada'), 'Invalid dependency or different project');
    graph.set(taskId, data.dependencies);
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string) => {
      requireThat(!visiting.has(id), 'Dependency cycle');
      if (visited.has(id)) return;
      visiting.add(id); for (const dep of graph.get(id) ?? []) visit(dep);
      visiting.delete(id); visited.add(id);
    };
    visit(taskId);
  }
  async call(actor: Actor, name: string, input: unknown): Promise<any> {
    requireThat(['agent', 'trusted_local'].includes(actor.scope), 'Agent scope required', 403);
    const schema = tools[name as keyof typeof tools];
    requireThat(schema, 'Unknown tool', 404);
    const a: any = schema.parse(input);
    if (!('operationId' in a)) return this.read(actor, name, a);
    if (name === 'send_collaboration_message') return this.automation.message(actor, a);
    const result = await this.mutate(actor, name, a, async s => {
      await this.automation.guard(actor, name, a, s);
      if (name.startsWith('create_')) {
        const kind = name.slice(7); const entityId = randomUUID();
        if (kind === 'task') await this.graph(a.projectId, entityId, a.data, s);
        if (kind === 'project') requireThat(new Set(a.data.repositories.map((r: any) => r.id)).size === a.data.repositories.length, 'Duplicate repository');
        const { accessToken, ...data } = a.data;
        const [created] = await models[kind].create([{ _id: entityId, ...data, ...(kind === 'project' ? { accessTokenHash: accessToken ? hash(accessToken) : undefined, members: { [memberKey(actor.userId)]: 'administrador' } } : { projectId: a.projectId }) }], { session: s });
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
        const diff = new TaskDiff({ _id: randomUUID(), projectId: a.projectId, taskId: a.taskId, repositoryId: a.repositoryId, baseCommit: a.baseCommit, commit: a.commit, branch: a.branch, files: a.files, patch: a.patch, patchSha256, truncated: a.truncated, author: actor.userId, credentialId: actor.id, agent: a.agent });
        await diff.save({ session: s });
        await this.event(s, actor, 'record_task_diff', a.projectId, diff._id, { taskId: a.taskId, repositoryId: a.repositoryId, branch: a.branch, commit: a.commit, agent: a.agent });
        return diff;
      }
      if (name === 'mark_project_read') {
        const head = (await Project.findById(a.projectId).select('eventSequence').session(s).lean())?.eventSequence ?? 0;
        requireThat(a.cursor <= head, 'Read cursor is ahead of project', 400);
        await DeliveryRead.findOneAndUpdate({ projectId: a.projectId, userId: actor.userId }, { $max: { lastSequence: a.cursor } }, { upsert: true, returnDocument: 'after', session: s });
        return { projectId: a.projectId, cursor: a.cursor };
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
      const t = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
      requireThat(t && t.version === a.version, 'Task missing or version conflict');
      if (t.featureId) requireThat(await Feature.exists({ _id: t.featureId, archived: false }).session(s), 'Feature archived');
      const now = new Date();
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
        requireThat(t.status === 'pendente', 'Task unavailable');
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
    else requireThat(name === 'list_records' && a.kind === 'project', 'Project required', 400);
    const page = async (model: Model<any>, filter: any) => {
      const items = await model.find(a.after ? { $and: [filter, { _id: { $gt: a.after } }] } : filter).sort({ _id: 1 }).limit(a.limit + 1).lean();
      const more = items.length > a.limit; if (more) items.pop();
      return { items, next: more ? items.at(-1)!._id : null };
    };
    if (name === 'get_automation_status') return this.automation.status(actor, a);
    if (name === 'get_project_novelties') {
      const read = await DeliveryRead.findOne({ projectId: a.projectId, userId: actor.userId }).lean();
      const after = a.after ?? read?.lastSequence ?? 0;
      const rows = await DeliveryEvent.find({ projectId: a.projectId, sequence: { $gt: after }, credentialId: { $ne: actor.id } }).sort({ sequence: 1 }).limit(a.limit + 1).lean();
      const more = rows.length > a.limit; if (more) rows.pop();
      const cursor = rows.at(-1)?.sequence ?? after;
      return { count: rows.length, cursor, hasMore: more, items: rows.map(item => ({ sequence: item.sequence, taskId: item.taskIds?.[0] ?? null, kind: item.kind ?? `project.${item.action}`, summary: item.summary ?? item.action, author: item.author, at: item.at })) };
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
        const items = await TaskMessage.find(filter).sort({ createdAt: 1, _id: 1 }).limit(a.limit).lean();
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
      const filter: any = kind === 'project' ? { ...(actor.scope === 'trusted_local' ? trustedFilter : { [`members.${memberKey(actor.userId)}`]: { $exists: true } }), ...(a.projectId ? { _id: a.projectId } : {}) } : { projectId: a.projectId };
      filter.archived = a.archived ?? false;
      if (kind === 'task') {
        for (const key of ['area', 'responsible', 'status']) if (a[key]) filter[key] = a[key];
        if (a.featureId) filter.featureId = a.featureId;
        const clauses: any[] = [];
        if (a.withoutFeature) clauses.push({ $or: [{ featureId: { $exists: false } }, { featureId: null }] });
        if (a.type) clauses.push({ $or: [{ type: a.type }, ...(a.type === 'feature' ? [{ type: { $exists: false } }] : [])] });
        if (clauses.length) filter.$and = clauses;
      }
      if (name === 'list_pending') filter.status = 'pendente';
      const result = await page(models[kind], filter);
      if (kind === 'task' || kind === 'feature') {
        const ids = result.items.map((x: any) => x._id);
        const counts = await MarkdownDocument.aggregate([{ $match: { projectId: a.projectId, targetKind: kind, targetId: { $in: ids } } }, { $group: { _id: '$targetId', count: { $sum: 1 } } }]);
        const map = Object.fromEntries(counts.map((x: any) => [x._id, x.count])); result.items = result.items.map((x: any) => ({ ...x, type: kind === 'task' ? x.type ?? 'feature' : undefined, markdownCount: map[x._id] ?? 0 }));
      }
      return result;
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
      requireThat(record, 'Record not found', 404); return record;
    }
    if (name === 'list_executions') return page(Execution, { projectId: a.projectId, taskId: a.taskId });
    if (name === 'get_history') {
      const filter = { projectId: a.projectId, ...(a.entityId ? { entityId: a.entityId } : {}) };
      const cursor = a.after ? await Event.findOne({ ...filter, _id: a.after }).lean() : undefined;
      requireThat(!a.after || cursor, 'Invalid history cursor', 400);
      const items = await Event.find({ ...filter, ...(cursor ? { $or: [{ at: { $gt: cursor.at } }, { at: cursor.at, _id: { $gt: cursor._id } }] } : {}) }).sort({ at: 1, _id: 1 }).limit(a.limit + 1).lean();
      const more = items.length > a.limit; if (more) items.pop();
      return { items, next: more ? items.at(-1)!._id : null };
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
    const taskMessages = await TaskMessage.find({ projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] }).sort({ createdAt: -1, _id: -1 }).limit(25).lean();
    const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId }).lean();
    requireThat(task, 'Task not found', 404);
    const project = await Project.findById(a.projectId).lean();
    const feature = task.featureId ? await Feature.findById(task.featureId).lean() : null;
    const dependencies = await Task.find({ _id: { $in: task.dependencies }, projectId: a.projectId }).lean();
    const executionIds = dependencies.flatMap(d => d.executionId ? [d.executionId] : []);
    const results = await Execution.find({ _id: { $in: executionIds } }).lean();
    const [taskMarkdowns, featureMarkdowns] = await Promise.all([this.markdowns(a.projectId, 'task', task._id!, undefined, 25), task.featureId ? this.markdowns(a.projectId, 'feature', task.featureId, undefined, 25) : Promise.resolve({ items: [], next: null })]);
    if (name === 'get_task_markdown_summary') {
      const escape = (value: string) => value.replace(/[\x0D\x0A]/g, ' ').replace(/#/g, '\\#');
      const date = (value?: Date) => value ? new Date(value).toISOString() : 'Não informado';
      const repository = project!.repositories.find(item => item.id === task.repositoryId);
      const lines = [`# ${escape(task.name!)}`, '', '## Identificação', '', `- **ID:** \`${task._id}\``, `- **Status:** \`${task.status}\``, `- **Área:** ${task.area}`, `- **Tipo:** ${task.type ?? 'feature'}`, `- **Prioridade:** ${task.priority}`, `- **Responsável:** ${task.responsible ?? 'Não atribuído'}`, `- **Criada em:** ${date(task.createdAt)}`, `- **Atualizada em:** ${date(task.updatedAt)}`, '', '## Projeto', '', `- **Nome:** ${escape(project!.name!)}`, `- **Descrição:** ${project!.description || '_Não informada._'}`, '', '## Feature', ''];
      if (feature) lines.push(`- **Nome:** ${escape(feature.name!)}`, `- **Objetivo:** ${feature.objective || '_Não informado._'}`, `- **Contexto:** ${feature.context || '_Não informado._'}`); else lines.push('_Tarefa independente, sem feature vinculada._');
      lines.push('', '## Repositório', '');
      if (repository) lines.push(`- **Nome:** ${escape(repository.name)}`, `- **URL:** ${repository.url}`, `- **Instruções:** ${repository.instructions || '_Não informadas._'}`); else lines.push('_Repositório não encontrado no projeto._');
      lines.push('', '## Instruções', '', task.instructions || '_Não informado._', '', '## Critérios de aceite', '');
      if (task.acceptance?.length) for (const item of task.acceptance) lines.push(`- ${item}`); else lines.push('_Nenhum critério informado._');
      lines.push('', `## Dependências (${dependencies.length})`, '');
      if (dependencies.length) for (const dependency of dependencies) lines.push(`- **${escape(dependency.name!)}** — \`${dependency.status}\`${dependency.execution ? `; execução: \`${dependency.execution.status}\`` : ''}`); else lines.push('_Sem dependências._');
      const executions = await Execution.find({ taskId: task._id }).sort({ startedAt: -1 }).limit(25).lean();
      lines.push('', `## Execuções (${executions.length})`, '');
      if (executions.length) for (const execution of executions) { lines.push(`- **${execution.status}** — iniciada em ${date(execution.startedAt)}`); if (execution.result?.summary) lines.push(`  - Resultado: ${execution.result.summary}`); if (execution.result?.evidence?.length) lines.push(`  - Evidências: ${execution.result.evidence.join('; ')}`); } else lines.push('_Nenhuma execução registrada._');
      lines.push('', `## Mensagens (${taskMessages.length})`, '');
      if (taskMessages.length) for (const message of taskMessages) lines.push(`- **${message.type}** por ${message.author} em ${date(message.createdAt)}: ${message.message}`); else lines.push('_Nenhuma mensagem registrada._');
      const documents = [...taskMarkdowns.items.map(document => ({ scope: 'tarefa', ...document })), ...featureMarkdowns.items.map(document => ({ scope: 'feature', ...document }))];
      lines.push('', `## Documentos (${documents.length})`, '');
      if (documents.length) for (const document of documents) lines.push(`- **${escape(document.name)}** (${document.scope}, revisão ${document.revision})${document.summary ? ` — ${document.summary}` : ''}`); else lines.push('_Nenhum documento vinculado._');
      return { markdown: lines.join('\n').trimEnd() + '\n', generatedAt: new Date().toISOString(), taskId: task._id };
    }
    return { task: { ...task, type: task.type ?? 'feature' }, project, feature, repository: project!.repositories.find(r => r.id === task.repositoryId), markdowns: { task: taskMarkdowns, feature: featureMarkdowns }, messages: taskMessages, dependencies: dependencies.map(d => ({ ...d, type: d.type ?? 'feature', execution: results.find(e => e._id === d.executionId) })), executions: await Execution.find({ taskId: task._id }).sort({ startedAt: -1 }).limit(25).lean() };
  }
  async admin(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const a = adminSchema.parse(input);
    if (a.action === 'automation_policy' || a.action === 'automation_release' || a.action === 'automation_resolve') return this.automation.admin(actor, a);
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
    });
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
    });
  }
  async changeTaskStatus(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const body = changeTaskStatusSchema.parse(input);
    const operationId = randomUUID();
    return this.mutate(actor, 'admin', { action: 'change_task_status', operationId, ...body }, async s => {
      const task = await Task.findOne({ _id: body.taskId, projectId: body.projectId, archived: false }).session(s);
      requireThat(task, 'Task not found', 404);
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
      await this.event(s, actor, 'manual_status_change', body.projectId, body.taskId, { action: 'change_task_status', operationId, ...body, task: plain(task) });
      return { operationId, task: plain(task) };
    });
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
