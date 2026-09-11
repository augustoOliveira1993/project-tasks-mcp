import mongoose, { type ClientSession, type Model } from 'mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Project, Feature, Task, Execution, Event, TaskMessage, Operation, Credential, Bootstrap } from './db.js';
import { tools, adminSchema, projectData, featureData, taskData, states, userId as userIdSchema } from './schema.js';

export class DomainError extends Error { constructor(message: string, public status = 409) { super(message); } }
export type Actor = { id: string; userId: string; scope: string; systemAdmin: boolean; sessionId?: string };
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
export function trustedLocal(email: string): Actor {
  const normalized = email.trim().toLowerCase();
  requireThat(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized), 'X-Project-Tasks-Email must be a valid email', 401);
  return { id: 'trusted:' + memberKey(normalized), userId: normalized, scope: 'trusted_local', systemAdmin: false };
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
export class Service {
  private readonly listeners = new Set<(event: { projectId: string; taskId?: string; action: string }) => void>();
  constructor(public leaseMs = 30 * 60 * 1000) { requireThat(Number.isFinite(leaseMs) && leaseMs > 0, 'Invalid lease'); }
  onTaskEvent(listener: (event: { projectId: string; taskId?: string; action: string }) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emitTaskEvent(event: { projectId: string; taskId?: string; action: string }) { for (const listener of this.listeners) { try { listener(event); } catch {} } }
  private async access(actor: Actor, projectId: string, write = false, admin = false, session?: ClientSession) {
    const p = await Project.findById(projectId).session(session ?? null);
    const role = p?.members.get(memberKey(actor.userId));
    requireThat(p && role && (!write || role !== 'leitor') && (!admin || role === 'administrador'), 'Project access denied', 403);
    if (write) requireThat(!p.archived, 'Project archived');
    return p;
  }
  private async event(s: ClientSession, actor: Actor, action: string, projectId: string | undefined, entityId: string, data: unknown) {
    await Event.create([{ _id: randomUUID(), projectId, entityId, action, author: actor.userId, credentialId: actor.id, at: new Date(), data }], { session: s });
  }
  private async mutate(actor: Actor, name: string, a: any, run: (s: ClientSession) => Promise<any>) {
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
    requireThat(await Feature.exists({ _id: data.featureId, projectId, archived: false }).session(s), 'Unknown or archived feature');
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
    const result = await this.mutate(actor, name, a, async s => {
      if (name.startsWith('create_')) {
        const kind = name.slice(7); const entityId = randomUUID();
        if (kind === 'task') await this.graph(a.projectId, entityId, a.data, s);
        if (kind === 'project') requireThat(new Set(a.data.repositories.map((r: any) => r.id)).size === a.data.repositories.length, 'Duplicate repository');
        const [created] = await models[kind].create([{ _id: entityId, ...a.data, ...(kind === 'project' ? { members: { [memberKey(actor.userId)]: 'administrador' } } : { projectId: a.projectId }) }], { session: s });
        await this.event(s, actor, name, a.projectId ?? entityId, entityId, created);
        return created;
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
          if (a.kind === 'task') await this.graph(a.projectId, a.id, { ...plain(doc), ...data }, s);
          if (a.kind === 'project' && 'repositories' in data && data.repositories) {
            const ids = data.repositories.map((r: any) => r.id);
            requireThat(new Set(ids).size === ids.length, 'Duplicate repository');
            requireThat(!await Task.exists({ projectId: a.projectId, repositoryId: { $nin: ids } }).session(s), 'Repository is referenced');
          }
          Object.assign(doc, data);
        }
        doc.version += 1; await doc.save({ session: s });
        await this.event(s, actor, name, a.projectId, a.id, doc); return doc;
      }
      const t = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
      requireThat(t && t.version === a.version, 'Task missing or version conflict');
      requireThat(await Feature.exists({ _id: t.featureId, archived: false }).session(s), 'Feature archived');
      const now = new Date();
      if (name === 'send_task_message') {
        requireThat(t.status === 'em_execucao' && t.executionId === a.executionId && t.leaseUntil! > now, 'Execution inactive or expired');
        const execution = await Execution.findOne({ _id: a.executionId, taskId: t._id, credentialId: actor.id }).session(s);
        requireThat(execution, 'Execution belongs to another credential', 403);
        if (a.relatedTaskId) {
          const related = await Task.findOne({ _id: a.relatedTaskId, projectId: a.projectId, archived: false }).session(s);
          requireThat(related && (related.featureId === t.featureId || related.dependencies.includes(t._id!) || t.dependencies.includes(related._id!)), 'Tasks are not related', 403);
        }
        const [message] = await TaskMessage.create([{ _id: randomUUID(), projectId: a.projectId, taskId: t._id, relatedTaskId: a.relatedTaskId, executionId: a.executionId, operationId: a.operationId, author: actor.userId, type: a.type, message: a.message, references: a.references, createdAt: now }], { session: s });
        await this.event(s, actor, 'task_message', a.projectId, message._id!, { taskId: t._id, relatedTaskId: a.relatedTaskId, type: a.type });
        return message;
      }
      if (name === 'claim_task') {
        requireThat(t.status === 'pendente', 'Task unavailable');
        const complete = await Task.countDocuments({ _id: { $in: t.dependencies }, projectId: a.projectId, status: 'concluida' }).session(s);
        requireThat(complete === new Set(t.dependencies).size, 'Dependencies not approved');
        t.executionId = randomUUID(); t.status = 'em_execucao'; t.responsible = actor.userId; t.leaseUntil = new Date(now.getTime() + this.leaseMs);
        await Execution.create([{ _id: t.executionId, projectId: a.projectId, taskId: t._id, credentialId: actor.id, userId: actor.userId, agent: a.agent, startedAt: now, lastActivity: now, status: 'em_execucao' }], { session: s });
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
      await this.event(s, actor, name, a.projectId, a.taskId, { ...a, task: plain(t) }); return t;
    });
    if (a.projectId && a.taskId) this.emitTaskEvent({ projectId: a.projectId, taskId: a.taskId, action: name });
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
    if (name === 'subscribe_task_events') {
      await this.access(actor, a.projectId);
      requireThat(await Task.exists({ _id: a.taskId, projectId: a.projectId, archived: false }), 'Task not found', 404);
      return { subscribed: true, projectId: a.projectId, taskId: a.taskId };
    }
    if (name === 'list_task_messages' || name === 'wait_task_events') {
      const readMessages = async () => {
        const filter: any = { projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] };
        if (a.after) { const cursor = await TaskMessage.findById(a.after).lean(); requireThat(cursor, 'Invalid message cursor', 400); filter.$and = [{ $or: [{ createdAt: { $gt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $gt: a.after } }] }]; }
        const items = await TaskMessage.find(filter).sort({ createdAt: 1, _id: 1 }).limit(a.limit).lean();
        const events = name === 'wait_task_events' ? await Event.find({ projectId: a.projectId, entityId: a.taskId }).sort({ at: -1 }).limit(a.limit).lean() : [];
        return { items, events, next: items.length === a.limit ? items.at(-1)!._id : null };
      };
      let result = await readMessages();
      if (name === 'wait_task_events' && !result.items.length && !result.events.length && a.timeoutMs > 0) { const deadline = Date.now() + a.timeoutMs; while (Date.now() < deadline && !result.items.length && !result.events.length) { await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now()))); result = await readMessages(); } }
      return result;
    }    if (name === 'list_records' || name === 'list_pending') {
      const kind = name === 'list_pending' ? 'task' : a.kind;
      const filter: any = kind === 'project' ? { [`members.${memberKey(actor.userId)}`]: { $exists: true }, ...(a.projectId ? { _id: a.projectId } : {}) } : { projectId: a.projectId };
      filter.archived = a.archived ?? false;
      if (kind === 'task') for (const key of ['featureId', 'area', 'responsible', 'status']) if (a[key]) filter[key] = a[key];
      if (name === 'list_pending') filter.status = 'pendente';
      return page(models[kind], filter);
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
      const rows = await Task.aggregate([{ $match: { projectId: a.projectId, ...(a.featureId ? { featureId: a.featureId } : {}) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
      for (const row of rows) counts[row._id] = row.count;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const remaining = total - counts.concluida - counts.cancelada;
      return { counts, blocked: counts.bloqueada, remaining, completed: total > 0 && counts.concluida > 0 && remaining === 0 };
    }
    const taskMessages = await TaskMessage.find({ projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] }).sort({ createdAt: -1, _id: -1 }).limit(25).lean();
    const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId }).lean();
    requireThat(task, 'Task not found', 404);
    const project = await Project.findById(a.projectId).lean();
    const feature = await Feature.findById(task.featureId).lean();
    const dependencies = await Task.find({ _id: { $in: task.dependencies }, projectId: a.projectId }).lean();
    const results = await Execution.find({ _id: { $in: dependencies.map(d => d.executionId) } }).lean();
    return { task, project, feature, repository: project!.repositories.find(r => r.id === task.repositoryId), messages: taskMessages, dependencies: dependencies.map(d => ({ ...d, execution: results.find(e => e._id === d.executionId) })), executions: await Execution.find({ taskId: task._id }).sort({ startedAt: -1 }).limit(25).lean() };
  }
  async admin(actor: Actor, input: unknown) {
    requireThat(actor.scope === 'human', 'Human credential required', 403);
    const a = adminSchema.parse(input);
    const result = await this.mutate(actor, 'admin', a, async s => {
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
        if (a.role) p!.members.set(memberKey(a.userId), a.role); else p!.members.delete(memberKey(a.userId));
        requireThat([...p!.members.values()].includes('administrador'), 'Last project administrator required');
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
      await t.save({ session: s }); await this.event(s, actor, a.decision, a.projectId, a.taskId, a); return t;
    });
    if ((a as any).action === 'review' && (a as any).projectId && (a as any).taskId) this.emitTaskEvent({ projectId: (a as any).projectId, taskId: (a as any).taskId, action: `review:${(a as any).decision}` });
    return result;
  }
  async expire() {
    const expired = await Task.find({ status: 'em_execucao', leaseUntil: { $lte: new Date() } }).select('_id').limit(100).lean();
    for (const row of expired) await mongoose.connection.transaction(async s => {
      const t = await Task.findOneAndUpdate({ _id: row._id, status: 'em_execucao', leaseUntil: { $lte: new Date() } }, { $set: { status: 'bloqueada' }, $unset: { leaseUntil: 1 }, $inc: { version: 1 } }, { returnDocument: 'after', session: s });
      if (!t) return;
      await Execution.updateOne({ _id: t.executionId }, { $set: { status: 'expired', endedAt: new Date() }, $push: { impediments: 'Execution lease expired; explicit human recovery required' } }, { session: s });
      await this.event(s, { id: 'system', userId: 'system', scope: 'system', systemAdmin: false }, 'expired', t.projectId!, t._id!, { executionId: t.executionId });
      this.emitTaskEvent({ projectId: t.projectId!, taskId: t._id!, action: 'expired' });
    });
  }
}
