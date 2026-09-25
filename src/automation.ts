import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { AutomationJob, AutomationPolicy, Runner, Task, Feature, Project, Execution, TaskMessage, MarkdownDocument } from './db.js';
import { DomainError, type Actor, type Service } from './service.js';
import { id, provider, tools } from './schema.js';

const active = ['reserved', 'running', 'waiting_human'];
function ensure(condition: unknown, message: string, status = 409): asserts condition { if (!condition) throw new DomainError(message, status); }
const mutation = { operationId: id };
const jobTarget = { projectId: id, runnerId: id, jobId: id };
export const runnerSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), ...mutation, machineId: id, providers: z.array(provider).min(1).max(2), repositories: z.array(id).min(1).max(100), maxConcurrent: z.number().int().min(1).max(10).default(2) }).strict(),
  z.object({ action: z.literal('reserve'), ...mutation, projectId: id, runnerId: id }).strict(),
  z.object({ action: z.literal('heartbeat'), ...mutation, runnerId: id }).strict(),
  z.object({ action: z.literal('inspect'), ...jobTarget }).strict(),
  z.object({ action: z.literal('recover'), runnerId: id }).strict(),
  z.object({ action: z.literal('events'), projectId: id, cursor: z.string().max(2048).optional(), timeoutMs: z.number().int().min(0).max(30000).default(25000) }).strict(),
  z.object({ action: z.literal('checkpoint'), ...mutation, ...jobTarget, turnCompleted: z.boolean().optional(), providerSessionId: z.string().max(255).optional(), cwd: z.string().max(2048).optional(), lastCursor: z.string().max(2048).optional(), deliveredMessageIds: z.array(id).max(100).optional(), usage: z.object({ inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(), costUsd: z.number().nonnegative().nullable() }).strict().optional() }).strict(),
  z.object({ action: z.literal('turn'), ...mutation, ...jobTarget }).strict(),
  z.object({ action: z.literal('permission'), ...mutation, ...jobTarget, request: z.object({ id: z.string().max(255), title: z.string().max(500), detail: z.string().max(4000) }).strict() }).strict(),
  z.object({ action: z.literal('finish'), ...mutation, ...jobTarget, outcome: z.enum(['completed', 'blocked', 'failed']), error: z.string().max(4000).optional() }).strict(),
  z.object({ action: z.literal('task_call'), ...jobTarget, tool: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }).strict()
]);

export class Automation {
  constructor(private service: Service) {}
  async fingerprint(task: any, session?: ClientSession) {
    const project = await Project.findById(task.projectId).session(session ?? null).lean();
    const feature = task.featureId ? await Feature.findById(task.featureId).session(session ?? null).lean() : null;
    const docs = await MarkdownDocument.find({ projectId: task.projectId, $or: [{ targetId: task._id }, ...(task.featureId ? [{ targetId: task.featureId }] : [])] }).select('_id sha256 revision').sort({ _id: 1 }).session(session ?? null).lean();
    const content = [task.name, task.instructions, task.acceptance, task.priority, task.area, task.type, task.repositoryId, task.featureId, task.dependencies, project?.instructions, project?.repositories.find(r => r.id === task.repositoryId), feature?.version, docs];
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
  }
  async status(actor: Actor, a: any) {
    const project = await this.service.access(actor, a.projectId);
    const jobs = await AutomationJob.find({ projectId: a.projectId, ...(a.after ? { _id: { $gt: a.after } } : {}) }).sort({ _id: 1 }).limit(a.limit + 1).lean();
    const more = jobs.length > a.limit; if (more) jobs.pop();
    const runners = await Runner.find({ $or: [{ _id: { $in: jobs.map(j => j.runnerId).filter((id): id is string => typeof id === 'string') } }, { repositories: { $in: project.repositories.map(r => r.id!) } }] }).select('_id machineId providers maxConcurrent lastSeen').limit(100).lean();
    return { policy: await AutomationPolicy.findById(a.projectId).lean(), jobs, runners, next: more ? jobs.at(-1)!._id : null };
  }
  async admin(actor: Actor, a: any) {
    ensure(actor.scope === 'human', 'Human credential required', 403);
    return this.service.mutate(actor, 'admin', a, async s => {
      if (a.action === 'automation_policy') {
        const policy = await AutomationPolicy.findById(a.projectId).session(s) ?? new AutomationPolicy({ _id: a.projectId });
        ensure(policy.version === a.version, 'Policy version conflict');
        const project = await Project.findById(a.projectId).session(s);
        ensure(a.routes.every((r: any) => project!.repositories.some(repo => repo.id === r.repositoryId)), 'Unknown repository');
        ensure(new Set(a.routes.map((r: any) => `${r.repositoryId}:${r.area}`)).size === a.routes.length, 'Duplicate route');
        Object.assign(policy, { enabled: a.enabled, maxConcurrent: a.maxConcurrent, routes: a.routes, version: policy.version! + 1 });
        await policy.save({ session: s });
        await this.service.event(s, actor, a.action, a.projectId, a.projectId, { version: policy.version });
        return policy;
      }
      if (a.action === 'automation_resolve') {
        const job = await AutomationJob.findOne({ _id: a.jobId, projectId: a.projectId }).session(s);
        ensure(job && job.version === a.version && job.status === 'waiting_human' && job.request, 'Pending permission missing or version conflict');
        job.request = { ...job.request, decision: a.decision, reason: a.reason, decidedBy: actor.userId };
        job.status = 'running'; job.version!++;
        await job.save({ session: s });
        await this.service.event(s, actor, a.action, a.projectId, job._id!, { taskId: job.taskId });
        return job;
      }
      const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
      ensure(task && task.version === a.version && task.status === 'pendente', 'Task unavailable or version conflict');
      ensure(!await AutomationJob.exists({ taskId: task._id, status: { $in: active } }).session(s), 'Task has an active runner');
      const policy = await AutomationPolicy.findById(a.projectId).session(s);
      const selected = a.provider ?? policy?.routes.find(r => r.repositoryId === task.repositoryId && r.area === task.area)?.provider;
      ensure(selected, 'Configure a repository/area route or choose provider');
      await AutomationJob.updateMany({ taskId: task._id, status: 'queued' }, { $set: { status: 'cancelled', error: 'Superseded by human release' }, $inc: { version: 1 } }, { session: s });
      const [job] = await AutomationJob.create([{ _id: randomUUID(), projectId: a.projectId, taskId: task._id, repositoryId: task.repositoryId, provider: selected, fingerprint: await this.fingerprint(task, s), authorizedBy: actor.userId, status: 'queued' }], { session: s });
      await this.service.event(s, actor, a.action, a.projectId, job._id!, { taskId: task._id });
      return job;
    });
  }
  async validateReply(a: any, s: ClientSession) {
    if (!a.replyTo) return;
    const message = await TaskMessage.findOne({ _id: a.replyTo, projectId: a.projectId, $or: [{ taskId: a.taskId }, { relatedTaskId: a.taskId }] }).session(s);
    ensure(message && (!a.conversationId || message.conversationId === a.conversationId), 'Reply does not belong to task/conversation', 400);
  }
  async message(actor: Actor, a: any) {
    return this.service.mutate(actor, 'send_collaboration_message', a, async s => {
      const task = await Task.findOne({ _id: a.taskId, projectId: a.projectId, archived: false }).session(s);
      ensure(task && task.status !== 'cancelada', 'Task unavailable');
      const participated = await Execution.exists({ taskId: task._id, credentialId: actor.id }).session(s);
      const reserved = await AutomationJob.exists({ taskId: task._id, credentialId: actor.id, status: { $in: [...active, 'completed'] } }).session(s);
      ensure(participated || reserved, 'Only task participants may collaborate', 403);
      if (actor.jobId) { const job = await this.owned(actor, { projectId: a.projectId, jobId: actor.jobId, runnerId: actor.runnerId }, s); ensure(job.taskId === a.taskId, 'Task outside job', 403); }
      if (a.relatedTaskId) {
        const related = await Task.findOne({ _id: a.relatedTaskId, projectId: a.projectId, archived: false }).session(s);
        ensure(related && (task.featureId && task.featureId === related.featureId || task.dependencies.includes(related._id!) || related.dependencies.includes(task._id!)), 'Tasks are not related', 403);
      }
      await this.validateReply(a, s);
      const [message] = await TaskMessage.create([{ ...a, _id: randomUUID(), author: actor.userId, credentialId: actor.id, createdAt: new Date() }], { session: s });
      await this.onMessage(message, s);
      await this.service.event(s, actor, 'task_message', a.projectId, message._id!, { taskId: a.taskId, relatedTaskId: a.relatedTaskId, type: a.type });
      return message;
    });
  }
  async onMessage(message: any, s: ClientSession) {
    if (!message.conversationId) {
      const parent = message.replyTo ? await TaskMessage.findById(message.replyTo).session(s) : undefined;
      message.conversationId = parent?.conversationId ?? randomUUID(); await message.save({ session: s });
    }
    if (message.type !== 'pergunta' || !message.relatedTaskId || message.relatedTaskId === message.taskId) return;
    if (await AutomationJob.exists({ taskId: message.relatedTaskId, status: { $in: active } }).session(s)) return;
    const source = await AutomationJob.findOne({ projectId: message.projectId, taskId: message.relatedTaskId, mode: 'work', status: { $in: ['queued', 'completed'] } }).sort({ createdAt: -1 }).session(s);
    if (!source || !source.authorizationValid) return;
    const task = await Task.findById(source.taskId).session(s);
    if (!task || task.archived || task.status === 'cancelada' || source.fingerprint !== await this.fingerprint(task, s)) return;
    await AutomationJob.create([{ _id: randomUUID(), projectId: source.projectId, taskId: source.taskId, repositoryId: source.repositoryId, provider: source.provider, authorizedBy: source.authorizedBy, fingerprint: source.fingerprint, mode: 'consultation', status: 'queued', originJobId: source.cwd ? source._id : undefined, preferredRunnerId: source.cwd ? source.runnerId : undefined, cwd: source.cwd, triggerMessageId: message._id, conversationId: message.conversationId }], { session: s });
  }
  async guard(actor: Actor, name: string, a: any, s: ClientSession) {
    if (actor.jobId) {
      const postSubmissionApproval = name === 'set_task_status' && a.status === 'concluida';
      const job = await this.owned(actor, { ...a, jobId: actor.jobId, runnerId: actor.runnerId }, s, postSubmissionApproval);
      ensure((['claim_task', 'heartbeat_task', 'record_progress', 'block_task', 'submit_task', 'send_task_message'].includes(name) || postSubmissionApproval) && job.taskId === a.taskId, 'Operation outside authorized job', 403);
      ensure(job.mode === 'work', 'Consultation is read-only', 403);
      const policy = await AutomationPolicy.findById(a.projectId).session(s);
      const task = await Task.findById(a.taskId).session(s);
      ensure(policy?.enabled && job.authorizationValid && task && job.fingerprint === await this.fingerprint(task, s), 'Automation suspended or task scope changed');
      ensure(job.status !== 'waiting_human' || name === 'heartbeat_task', 'Human permission pending');
      if (postSubmissionApproval) ensure(job.status === 'completed' && task.status === 'em_revisao', 'Only a submitted task can be approved by its runner');
    } else if (a.taskId || a.targetId) {
      const task = await Task.findById(a.taskId ?? a.targetId).session(s);
      if (task?.executionId && task.status === 'em_execucao') {
        const execution = await Execution.findById(task.executionId).session(s);
        ensure(!execution?.managedJobId, 'Managed execution requires its runner', 403);
      }
    }
  }
  async afterTaskMutation(actor: Actor, task: any, name: string, s: ClientSession) {
    if (!actor.jobId) return;
    await AutomationJob.updateOne({ _id: actor.jobId, runnerId: actor.runnerId }, { $set: { executionId: task.executionId, ...(name === 'claim_task' ? { status: 'running' } : {}), ...(name === 'submit_task' ? { status: 'completed' } : {}), ...(name === 'block_task' ? { status: 'blocked' } : {}) }, $inc: { version: 1 } }, { session: s });
  }
  private async runnerOwner(actor: Actor, runnerId: string, s?: ClientSession) {
    ensure(actor.scope === 'agent', 'Runner requires bearer agent credential', 403);
    const runner = await Runner.findOne({ _id: runnerId, credentialId: actor.id }).session(s ?? null);
    ensure(runner, 'Runner belongs to another credential', 403);
    return runner;
  }
  private async owned(actor: Actor, a: any, s?: ClientSession, allowTerminal = false) {
    const runner = await this.runnerOwner(actor, a.runnerId, s);
    const job = await AutomationJob.findOne({ _id: a.jobId, projectId: a.projectId, runnerId: a.runnerId, credentialId: actor.id }).session(s ?? null);
    ensure(job, 'Job belongs to another runner', 403);
    ensure(runner.repositories.includes(job.repositoryId!) && runner.providers.includes(job.provider!), 'Runner capability was removed', 403);
    ensure(allowTerminal && ['completed', 'blocked', 'cancelled'].includes(job.status!) || job.reservationUntil && job.reservationUntil > new Date() && active.includes(job.status!), 'Reservation inactive or expired');
    return job;
  }
  async runner(actor: Actor, input: unknown): Promise<any> {
    ensure(actor.scope === 'agent', 'Runner requires bearer agent credential', 403);
    const a = runnerSchema.parse(input);
    if (a.action === 'events') return this.service.query(actor, a.cursor ? 'wait_project_events' : 'subscribe_project_events', { projectId: a.projectId, ...(a.cursor ? { cursor: a.cursor, timeoutMs: a.timeoutMs } : {}) });
    if (a.action === 'recover') {
      await this.runnerOwner(actor, a.runnerId);
      const jobs = await AutomationJob.find({ runnerId: a.runnerId, status: { $in: active } }).limit(10).lean();
      const accessible = [];
      for (const job of jobs) { try { await this.service.access(actor, job.projectId!); accessible.push(job); } catch {} }
      return accessible;
    }
    if (a.action === 'inspect' || a.action === 'task_call') {
      await this.service.access(actor, a.projectId);
      // Terminal ownership is sufficient to reach the operation cache. Fresh writes
      // still pass guard inside the transaction and cannot revive completed work.
      const job = await this.owned(actor, a, undefined, true);
      if (a.action === 'inspect') {
        const task = await Task.findById(job.taskId).lean();
        const policy = await AutomationPolicy.findById(a.projectId).lean();
        return { job, task, terminal: !active.includes(job.status!), suspended: !policy?.enabled || !job.authorizationValid || !task || task.archived || task.status === 'cancelada' || job.mode === 'work' && task.status === 'bloqueada' || job.fingerprint !== await this.fingerprint(task) };
      }
      const schema = tools[a.tool as keyof typeof tools]; ensure(schema, 'Unknown tool', 404);
      const args: any = schema.parse(a.arguments);
      ensure(args.projectId === a.projectId, 'Project outside job', 403);
      if (args.taskId) ensure(args.taskId === job.taskId, 'Task outside job', 403);
      const who = { ...actor, jobId: job._id!, runnerId: a.runnerId };
      if ('operationId' in args) return this.service.call(who, a.tool, args);
      return this.service.query(who, a.tool, args);
    }
    return this.service.mutate(actor, `runner:${a.action}`, a, async s => {
      if (a.action === 'register') {
        let runner = await Runner.findOne({ credentialId: actor.id, machineId: a.machineId }).session(s);
        if (!runner) runner = new Runner({ _id: randomUUID(), credentialId: actor.id, machineId: a.machineId });
        Object.assign(runner, { providers: a.providers, repositories: a.repositories, maxConcurrent: a.maxConcurrent, lastSeen: new Date() });
        await runner.save({ session: s }); return runner;
      }
      const runner = await this.runnerOwner(actor, a.runnerId, s);
      runner.lastSeen = new Date(); runner.fence!++; await runner.save({ session: s });
      if (a.action === 'heartbeat') {
        // Do not revive expired reservations, even if the old process reconnects.
        await AutomationJob.updateMany({ runnerId: runner._id, status: { $in: active }, reservationUntil: { $gt: new Date() } }, { $set: { reservationUntil: new Date(Date.now() + 90000) } }, { session: s });
        return { alive: true };
      }
      if (a.action === 'reserve') {
        const policy = await AutomationPolicy.findById(a.projectId).session(s);
        if (!policy?.enabled || await AutomationJob.countDocuments({ runnerId: runner._id, status: { $in: active } }).session(s) >= runner.maxConcurrent! || await AutomationJob.countDocuments({ projectId: a.projectId, status: { $in: active } }).session(s) >= policy.maxConcurrent!) return null;
        const jobs = AutomationJob.find({ projectId: a.projectId, status: 'queued', provider: { $in: runner.providers }, repositoryId: { $in: runner.repositories }, $or: [{ preferredRunnerId: { $exists: false } }, { preferredRunnerId: runner._id }] }).sort({ createdAt: 1, _id: 1 }).session(s).cursor({ batchSize: 100 });
        try { for await (const job of jobs) {
          const task = await Task.findById(job.taskId).session(s);
          if (!job.authorizationValid || !task || task.archived || task.status === 'cancelada' || job.mode === 'work' && task.status !== 'pendente' || job.fingerprint !== await this.fingerprint(task, s) || task.featureId && !await Feature.exists({ _id: task.featureId, archived: false }).session(s)) {
            job.status = 'cancelled'; job.error = 'Task changed; human release required'; job.version!++; await job.save({ session: s }); continue;
          }
          if (await AutomationJob.exists({ taskId: task._id, status: { $in: active } }).session(s)) continue;
          if (job.mode === 'consultation' && await TaskMessage.exists({ projectId: a.projectId, replyTo: job.triggerMessageId, type: 'resposta' }).session(s)) { job.status = 'cancelled'; job.error = 'Question already answered'; job.version!++; await job.save({ session: s }); continue; }
          if (job.mode === 'work' && await Task.countDocuments({ _id: { $in: task.dependencies }, status: 'concluida' }).session(s) !== task.dependencies.length) continue;
          Object.assign(job, { status: 'reserved', runnerId: runner._id, credentialId: actor.id, reservationUntil: new Date(Date.now() + 90000), startedAt: new Date(), attempts: job.attempts! + 1, version: job.version! + 1 });
          await job.save({ session: s });
          await this.service.event(s, actor, 'automation_reserved', a.projectId, job._id!, { taskId: job.taskId });
          return job;
        } } finally { await jobs.close(); }
        return null;
      }
      const job = await this.owned(actor, a, s, a.action === 'checkpoint');
      if (a.action === 'checkpoint') {
        if (job.cwd && a.cwd) ensure(job.cwd === a.cwd, 'Cannot resume on another checkout');
        if (job.providerSessionId && a.providerSessionId) ensure(job.providerSessionId === a.providerSessionId, 'Cannot replace provider session');
        for (const key of ['cwd', 'providerSessionId', 'lastCursor'] as const) if (a[key] !== undefined) (job as any)[key] = a[key];
        if (a.usage) {
          ensure(a.turnCompleted && job.turnInFlight, 'Usage requires completion of an outstanding turn');
          const usage: Record<string, number | null> = {};
          for (const key of ['inputTokens', 'outputTokens', 'costUsd'] as const) usage[key] = a.usage[key] === null || job.usage?.[key] === null ? null : (job.usage?.[key] ?? 0) + a.usage[key]!;
          job.usage = usage;
        }
        if (a.deliveredMessageIds) job.deliveredMessageIds = [...new Set([...job.deliveredMessageIds, ...a.deliveredMessageIds])].slice(-1000);
        if (a.turnCompleted) job.turnInFlight = false;
      } else if (a.action === 'turn') {
        const policy = await AutomationPolicy.findById(a.projectId).session(s);
        const task = await Task.findById(job.taskId).session(s);
        ensure(policy?.enabled && job.authorizationValid && task && !task.archived && job.fingerprint === await this.fingerprint(task, s), 'Automation suspended or task scope changed');
        if (job.mode === 'work') ensure(job.executionId && task.status === 'em_execucao' && task.executionId === job.executionId && task.leaseUntil! > new Date(), 'Claim task before starting a provider turn');
        ensure(job.status !== 'waiting_human', 'Human permission pending');
        ensure(job.turns! < 10 && Date.now() - job.startedAt!.getTime() < 30 * 60000, 'Automatic chain budget exceeded');
        if (job.conversationId) {
          const chain = await AutomationJob.find({ projectId: job.projectId, conversationId: job.conversationId }).select('turns startedAt').session(s);
          ensure(chain.reduce((sum, j) => sum + j.turns!, 0) < 10 && !chain.some(j => j.startedAt && j.startedAt.getTime() < Date.now() - 30 * 60000), 'Conversation budget exceeded');
        }
        ensure(!job.turnInFlight, 'Previous turn outcome is uncertain; human recovery required');
        job.turns!++; job.status = 'running'; job.turnInFlight = true;
      } else if (a.action === 'permission') { job.status = 'waiting_human'; job.request = { ...a.request, decision: null }; }
      else if (a.action === 'finish') {
        const task = await Task.findById(job.taskId).session(s);
        ensure(a.outcome !== 'completed' || task?.status === 'em_revisao' || task?.status === 'concluida' || job.mode === 'consultation', 'Submit task before completing work');
        job.status = a.outcome; job.error = a.error;
        if (task?.status === 'em_execucao' && task.executionId === job.executionId) {
          task.status = 'bloqueada'; task.leaseUntil = undefined; task.version!++; await task.save({ session: s });
          await Execution.updateOne({ _id: job.executionId }, { $set: { status: 'bloqueada', endedAt: new Date() }, $push: { impediments: a.error ?? 'Runner stopped' } }, { session: s });
        }
      }
      job.version!++; await job.save({ session: s });
      if (a.action === 'permission' || a.action === 'finish') await this.service.event(s, actor, `automation_${a.action}`, job.projectId!, job._id!, { taskId: job.taskId });
      return job;
    });
  }
  async expire() {
    const jobs = await AutomationJob.find({ status: { $in: active }, $or: [{ reservationUntil: { $lte: new Date() } }, { startedAt: { $lte: new Date(Date.now() - 30 * 60000) } }] }).select('_id').limit(100).lean();
    for (const row of jobs) {
      const session = await AutomationJob.startSession();
      try { await session.withTransaction(async () => {
        const job = await AutomationJob.findOne({ _id: row._id, status: { $in: active } }).session(session);
        if (!job || job.reservationUntil! > new Date() && job.startedAt! > new Date(Date.now() - 30 * 60000)) return;
        job.status = 'blocked'; job.error = 'Runner reservation/budget expired; human recovery required'; job.version!++; await job.save({ session });
        const task = job.executionId ? await Task.findOne({ _id: job.taskId, executionId: job.executionId, status: 'em_execucao' }).session(session) : null;
        if (task) { task.status = 'bloqueada'; task.leaseUntil = undefined; task.version!++; await task.save({ session }); await Execution.updateOne({ _id: job.executionId }, { $set: { status: 'expired', endedAt: new Date() }, $push: { impediments: job.error } }, { session }); }
        await this.service.event(session, { id: 'system', userId: 'system', scope: 'system', systemAdmin: false }, 'automation_expired', job.projectId!, job._id!, { taskId: job.taskId });
      }); } finally { await session.endSession(); }
    }
  }
}
