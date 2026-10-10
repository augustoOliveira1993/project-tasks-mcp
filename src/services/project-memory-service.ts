import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { Execution, Feature, MarkdownDocument, MarkdownRevision, ProjectMemory, ProjectMemoryProposal, ProjectMemoryRevision, Task, TaskDiff } from '../models.js';
import { pageByCreatedAt, PageCursorError } from '../pagination.js';
import { DomainError, type Actor, type Service } from '../service.js';
import { searchProjectMemories } from './project-memory-retrieval-service.js';
import { areasForProject } from '../area-catalog.js';

type SourceInput = { kind: 'task' | 'feature' | 'execution' | 'document' | 'diff'; id: string; revision?: number };

function ensure(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(message, status);
}

function memoryDto(memory: any, includeContent = false) {
  return {
    _id: memory._id, projectId: memory.projectId, version: memory.version ?? 0,
    title: memory.title, category: memory.category, status: memory.status ?? 'active',
    archived: memory.archived ?? false, revision: memory.revision ?? 0,
    sources: memory.sources ?? [], author: memory.author ?? null,
    createdAt: memory.createdAt, updatedAt: memory.updatedAt,
    ...(includeContent ? { content: memory.content } : {})
  };
}

function proposalDto(proposal: any, includeContent = false) {
  return {
    _id: proposal._id, projectId: proposal.projectId, version: proposal.version ?? 0,
    taskId: proposal.taskId, executionId: proposal.executionId,
    title: proposal.title, category: proposal.category, status: proposal.status,
    sources: proposal.sources ?? [], targetMemoryId: proposal.targetMemoryId ?? null,
    expectedMemoryVersion: proposal.expectedMemoryVersion ?? null, memoryId: proposal.memoryId ?? null,
    approvedRevision: proposal.approvedRevision ?? null, createdBy: proposal.createdBy,
    reviewedBy: proposal.reviewedBy ?? null, reviewedAt: proposal.reviewedAt ?? null,
    rejectionReason: proposal.rejectionReason ?? null,
    createdAt: proposal.createdAt, updatedAt: proposal.updatedAt,
    ...(includeContent ? { content: proposal.content } : {})
  };
}

function containsPotentialSecret(value: string) {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]+=*|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret|private[_-]?key|authorization)(\s*["']?\s*[:=]\s*["']?)[^\s"',;}\]]+/i.test(value);
}

function safeReason(value: string) {
  return value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [DADO SENSÍVEL OCULTO]')
    .replace(/\b(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[DADO SENSÍVEL OCULTO]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret|private[_-]?key|authorization)(\s*["']?\s*[:=]\s*["']?)[^\s"',;}\]]+/gi, '$1$2[DADO SENSÍVEL OCULTO]');
}

export class ProjectMemoryService {
  constructor(private service: Service) {}

  private async verifiedSources(projectId: string, sources: SourceInput[], session: ClientSession) {
    const result = [];
    for (const source of sources) {
      let title = '';
      let revision: number | undefined;
      let area: string | undefined;
      let featureId: string | undefined;
      if (source.kind === 'task') {
        const item = await Task.findOne({ _id: source.id, projectId }).select('_id name version area featureId').session(session).lean();
        ensure(item, `Memory source task not found: ${source.id}`, 404);
        revision = item.version ?? 0;
        title = item.name ?? `Task ${source.id}`;
        area = item.area ?? undefined;
        featureId = item.featureId ?? undefined;
      } else if (source.kind === 'feature') {
        const item = await Feature.findOne({ _id: source.id, projectId }).select('_id name version').session(session).lean();
        ensure(item, `Memory source feature not found: ${source.id}`, 404);
        revision = item.version ?? 0;
        title = item.name ?? `Feature ${source.id}`;
      } else if (source.kind === 'execution') {
        const item = await Execution.findOne({ _id: source.id, projectId }).select('_id taskId status startedAt').session(session).lean();
        ensure(item, `Memory source execution not found: ${source.id}`, 404);
        const task = item.taskId ? await Task.findOne({ _id: item.taskId, projectId }).select('name').session(session).lean() : null;
        title = `Execução ${item.status ?? 'sem status'}${task?.name ? ` · ${task.name}` : ''}`;
      } else if (source.kind === 'diff') {
        const item = await TaskDiff.findOne({ _id: source.id, projectId }).select('_id taskId commit branch files').session(session).lean();
        ensure(item, `Memory source diff not found: ${source.id}`, 404);
        title = `Diff ${item.commit?.slice(0, 12) ?? source.id.slice(0, 12)}${item.branch ? ` · ${item.branch}` : ''}`;
      } else {
        const item = await MarkdownDocument.findOne({ _id: source.id, projectId }).select('_id name revision').session(session).lean();
        ensure(item, `Memory source document not found: ${source.id}`, 404);
        revision = source.revision ?? item.revision ?? 0;
        ensure(Number.isInteger(revision) && revision > 0 && await MarkdownRevision.exists({ projectId, documentId: source.id, revision }).session(session), 'Memory source document revision not found', 404);
        title = item.name ?? `Document ${source.id}`;
      }
      if (source.kind !== 'document' && source.revision !== undefined) ensure(source.revision === revision, `Memory source revision is stale: ${source.id}`, 409);
      result.push({ kind: source.kind, id: source.id, title, ...(revision !== undefined ? { revision } : {}), ...(area ? { area } : {}), ...(featureId ? { featureId } : {}) });
    }
    return result;
  }

  async list(_actor: Actor, a: any) {
    const filter: Record<string, unknown> = {
      projectId: a.projectId, archived: false,
      status: a.status ?? 'active',
      ...(a.category ? { category: a.category } : {}),
      ...(a.search ? { $text: { $search: a.search } } : {})
    };
    try {
      const result = await pageByCreatedAt<any>(ProjectMemory, filter, a.after, a.limit);
      return { items: result.items.map(item => memoryDto(item)), next: result.next };
    } catch (error) {
      if (error instanceof PageCursorError) throw new DomainError(error.message, 400);
      throw error;
    }
  }

  async get(_actor: Actor, a: any) {
    const memory = await ProjectMemory.findOne({ _id: a.memoryId, projectId: a.projectId }).lean();
    ensure(memory, 'Project memory not found', 404);
    if (a.revision === undefined || a.revision === memory.revision) return memoryDto(memory, true);
    const snapshot = await ProjectMemoryRevision.findOne({ projectId: a.projectId, memoryId: a.memoryId, revision: a.revision }).lean();
    ensure(snapshot, 'Project memory revision not found', 404);
    return memoryDto({ ...snapshot, version: memory.version, createdAt: memory.createdAt, updatedAt: snapshot.createdAt }, true);
  }

  async search(_actor: Actor, a: any) {
    const project = await this.service.access(_actor, a.projectId);
    if (a.taskId) ensure(await Task.exists({ _id: a.taskId, projectId: a.projectId }), 'Task not found', 404);
    if (a.featureId) ensure(await Feature.exists({ _id: a.featureId, projectId: a.projectId }), 'Feature not found', 404);
    if (a.area) ensure(areasForProject(project).includes(a.area), 'Unknown project area', 400);
    return searchProjectMemories({
      projectId: a.projectId, query: a.query, taskId: a.taskId, featureId: a.featureId, area: a.area,
      limit: a.limit, snippetChars: 480
    });
  }

  async create(actor: Actor, a: any) {
    return this.service.mutate(actor, 'create_project_memory', a, async (session: ClientSession) => {
      await this.service.automation.guard(actor, 'create_project_memory', a, session);
      const sources = await this.verifiedSources(a.projectId, a.data.sources, session);
      const memory = new ProjectMemory({
        _id: randomUUID(), projectId: a.projectId, title: a.data.title, category: a.data.category,
        content: a.data.content, status: 'active', sources, revision: 1, author: actor.userId
      });
      await memory.save({ session });
      await this.saveRevision(memory, session);
      const result = memoryDto(memory, true);
      await this.service.event(session, actor, 'create_project_memory', a.projectId, memory._id!, this.eventData(result));
      return result;
    }, false);
  }

  async update(actor: Actor, a: any) {
    return this.service.mutate(actor, 'update_project_memory', a, async (session: ClientSession) => {
      await this.service.automation.guard(actor, 'update_project_memory', a, session);
      const memory = await ProjectMemory.findOne({ _id: a.memoryId, projectId: a.projectId, archived: false }).session(session);
      ensure(memory, 'Project memory not found or archived', 404);
      ensure(memory.version === a.version, 'Project memory version conflict');
      const sources = await this.verifiedSources(a.projectId, a.data.sources, session);
      const status = a.data.status ?? memory.status ?? 'active';
      const changed = memory.title !== a.data.title || memory.category !== a.data.category || memory.content !== a.data.content
        || memory.status !== status || JSON.stringify(memory.sources ?? []) !== JSON.stringify(sources);
      if (!changed) return memoryDto(memory, true);
      memory.title = a.data.title; memory.category = a.data.category; memory.content = a.data.content;
      memory.status = status; memory.set('sources', sources); memory.author = actor.userId;
      memory.revision = (memory.revision ?? 0) + 1; memory.version = (memory.version ?? 0) + 1;
      await memory.save({ session });
      await this.saveRevision(memory, session);
      const result = memoryDto(memory, true);
      await this.service.event(session, actor, 'update_project_memory', a.projectId, memory._id!, this.eventData(result));
      return result;
    }, false);
  }

  async archive(actor: Actor, a: any) {
    return this.service.mutate(actor, 'archive_project_memory', a, async (session: ClientSession) => {
      await this.service.automation.guard(actor, 'archive_project_memory', a, session);
      const memory = await ProjectMemory.findOne({ _id: a.memoryId, projectId: a.projectId, archived: false }).session(session);
      ensure(memory, 'Project memory not found or archived', 404);
      ensure(memory.version === a.version, 'Project memory version conflict');
      memory.archived = true; memory.version = (memory.version ?? 0) + 1;
      memory.revision = (memory.revision ?? 0) + 1; memory.author = actor.userId;
      await memory.save({ session });
      await this.saveRevision(memory, session);
      const result = memoryDto(memory);
      await this.service.event(session, actor, 'archive_project_memory', a.projectId, memory._id!, this.eventData(result));
      return result;
    }, false);
  }

  async listProposals(_actor: Actor, a: any) {
    const filter = { projectId: a.projectId, ...(a.status ? { status: a.status } : {}), ...(a.taskId ? { taskId: a.taskId } : {}) };
    try {
      const result = await pageByCreatedAt<any>(ProjectMemoryProposal, filter, a.after, a.limit);
      return { items: result.items.map(item => proposalDto(item)), next: result.next };
    } catch (error) {
      if (error instanceof PageCursorError) throw new DomainError(error.message, 400);
      throw error;
    }
  }

  async getProposal(_actor: Actor, a: any) {
    const proposal = await ProjectMemoryProposal.findOne({ _id: a.proposalId, projectId: a.projectId }).lean();
    ensure(proposal, 'Project memory proposal not found', 404);
    return proposalDto(proposal, true);
  }

  async createProposal(actor: Actor, a: any) {
    ensure(!actor.jobId, 'Runner jobs cannot publish memory proposals outside their task scope', 403);
    return this.service.mutate(actor, 'create_project_memory_proposal', a, async (session: ClientSession) => {
      const { task, execution } = await this.completedSource(a.projectId, a.taskId, a.executionId, session);
      this.validateProposalContent(a.data.title, a.data.content);
      if (a.targetMemoryId) await this.explicitTarget(a.projectId, a.data.category, a.targetMemoryId, a.expectedMemoryVersion, session);
      const extraSources: SourceInput[] = a.data.sources;
      const diffIds = extraSources.filter(source => source.kind === 'diff').map(source => source.id);
      ensure(!diffIds.length || await TaskDiff.countDocuments({ _id: { $in: diffIds }, projectId: a.projectId, taskId: a.taskId }).session(session) === new Set(diffIds).size,
        'Proposal diff source must belong to its completed task', 403);
      const sources = await this.verifiedSources(a.projectId, [
        { kind: 'task', id: a.taskId, revision: task.version ?? 0 },
        { kind: 'execution', id: a.executionId },
        ...extraSources
      ], session);
      const proposal = new ProjectMemoryProposal({
        _id: randomUUID(), projectId: a.projectId, taskId: a.taskId, executionId: a.executionId,
        title: a.data.title, category: a.data.category, content: a.data.content, sources,
        status: 'pending', targetMemoryId: a.targetMemoryId, expectedMemoryVersion: a.expectedMemoryVersion,
        createdBy: actor.userId, version: 0
      });
      await proposal.save({ session });
      const result = proposalDto(proposal, true);
      await this.service.event(session, actor, 'create_project_memory_proposal', a.projectId, proposal._id!, this.proposalEventData(result));
      return result;
    });
  }

  async retargetProposal(actor: Actor, a: any) {
    this.requireHumanReviewer(actor);
    return this.service.mutate(actor, 'retarget_project_memory_proposal', a, async (session: ClientSession) => {
      const proposal: any = await ProjectMemoryProposal.findOne({ _id: a.proposalId, projectId: a.projectId, status: 'pending' }).session(session);
      ensure(proposal && proposal.version === a.version, 'Proposal is no longer pending or version conflict');
      await this.explicitTarget(a.projectId, proposal.category, a.targetMemoryId, a.expectedMemoryVersion, session);
      proposal.targetMemoryId = a.targetMemoryId; proposal.expectedMemoryVersion = a.expectedMemoryVersion;
      proposal.version = (proposal.version ?? 0) + 1;
      await proposal.save({ session });
      const result = proposalDto(proposal);
      await this.service.event(session, actor, 'retarget_project_memory_proposal', a.projectId, proposal._id!, this.proposalEventData(result));
      return result;
    });
  }

  async approveProposal(actor: Actor, a: any) {
    this.requireHumanReviewer(actor);
    return this.service.mutate(actor, 'approve_project_memory_proposal', a, async (session: ClientSession) => {
      const proposal: any = await ProjectMemoryProposal.findOne({ _id: a.proposalId, projectId: a.projectId, status: 'pending' }).session(session);
      ensure(proposal && proposal.version === a.version, 'Proposal is no longer pending or version conflict');
      const { task } = await this.completedSource(a.projectId, proposal.taskId, proposal.executionId, session);
      this.validateProposalContent(proposal.title, proposal.content);
      const sources = await this.verifiedSources(a.projectId, proposal.sources ?? [], session);
      let memory: any;
      if (proposal.targetMemoryId) {
        memory = await this.explicitTarget(a.projectId, proposal.category, proposal.targetMemoryId, proposal.expectedMemoryVersion, session);
        const changed = memory.title !== proposal.title || memory.category !== proposal.category || memory.content !== proposal.content
          || JSON.stringify(memory.sources ?? []) !== JSON.stringify(sources);
        if (changed) {
          memory.title = proposal.title; memory.category = proposal.category; memory.content = proposal.content;
          memory.status = 'active'; memory.set('sources', sources); memory.author = actor.userId;
          memory.revision = (memory.revision ?? 0) + 1; memory.version = (memory.version ?? 0) + 1;
          await memory.save({ session });
          await this.saveRevision(memory, session);
        }
      } else {
        const duplicate: any = await ProjectMemory.findOne({ projectId: a.projectId, category: proposal.category, title: proposal.title, status: 'active', archived: false })
          .collation({ locale: 'en', strength: 1 }).select('_id version title').session(session).lean();
        ensure(!duplicate, `Potential active-memory conflict: ${duplicate?._id ?? ''} version ${duplicate?.version ?? ''}; reread it and explicitly retarget this proposal before approval`, 409);
        memory = new ProjectMemory({
          _id: randomUUID(), projectId: a.projectId, title: proposal.title, category: proposal.category,
          content: proposal.content, status: 'active', sources, revision: 1, author: actor.userId
        });
        await memory.save({ session });
        await this.saveRevision(memory, session);
      }
      proposal.status = 'approved'; proposal.memoryId = memory._id; proposal.approvedRevision = memory.revision;
      proposal.reviewedBy = actor.userId; proposal.reviewedAt = new Date(); proposal.version = (proposal.version ?? 0) + 1;
      await proposal.save({ session });
      const result = { proposal: proposalDto(proposal), memory: memoryDto(memory, true) };
      await this.service.event(session, actor, 'approve_project_memory_proposal', a.projectId, proposal._id!, {
        ...this.proposalEventData(result.proposal), memoryId: memory._id, memoryRevision: memory.revision
      });
      return result;
    });
  }

  async rejectProposal(actor: Actor, a: any) {
    this.requireHumanReviewer(actor);
    return this.service.mutate(actor, 'reject_project_memory_proposal', a, async (session: ClientSession) => {
      const proposal: any = await ProjectMemoryProposal.findOne({ _id: a.proposalId, projectId: a.projectId, status: 'pending' }).session(session);
      ensure(proposal && proposal.version === a.version, 'Proposal is no longer pending or version conflict');
      proposal.status = 'rejected'; proposal.rejectionReason = safeReason(a.reason); proposal.reviewedBy = actor.userId;
      proposal.reviewedAt = new Date(); proposal.version = (proposal.version ?? 0) + 1;
      await proposal.save({ session });
      const result = proposalDto(proposal);
      await this.service.event(session, actor, 'reject_project_memory_proposal', a.projectId, proposal._id!, this.proposalEventData(result));
      return result;
    });
  }

  private async completedSource(projectId: string, taskId: string, executionId: string, session: ClientSession) {
    const task: any = await Task.findOne({ _id: taskId, projectId, archived: false }).select('_id name version status area featureId').session(session).lean();
    ensure(task?.status === 'concluida', 'Memory proposals require a completed task', 409);
    const execution: any = await Execution.findOne({ _id: executionId, projectId, taskId, status: 'approve' }).select('_id taskId status endedAt').session(session).lean();
    ensure(execution?.endedAt, 'Memory proposals require an approved task execution', 409);
    return { task, execution };
  }

  private async explicitTarget(projectId: string, category: string, memoryId: string, expectedVersion: number, session: ClientSession) {
    const memory: any = await ProjectMemory.findOne({ _id: memoryId, projectId, archived: false, status: 'active' }).session(session);
    ensure(memory && memory.category === category, 'Target memory is missing, inactive, or has a different category', 409);
    ensure(memory.version === expectedVersion, `Target memory version conflict: current=${memory.version}; reread the memory and retarget the proposal`, 409);
    return memory;
  }

  private validateProposalContent(title: string, content: string) {
    ensure(!containsPotentialSecret(`${title}\n${content}`), 'Proposal appears to contain a secret; remove it before saving', 400);
  }

  private requireHumanReviewer(actor: Actor) {
    ensure(actor.scope === 'human' || actor.scope === 'trusted_local', 'Human reviewer required', 403);
  }

  private proposalEventData(proposal: any) {
    return {
      proposalId: proposal._id, taskId: proposal.taskId, executionId: proposal.executionId,
      status: proposal.status, title: proposal.title, category: proposal.category,
      sources: (proposal.sources ?? []).map((source: any) => ({ kind: source.kind, id: source.id, revision: source.revision })),
      targetMemoryId: proposal.targetMemoryId, expectedMemoryVersion: proposal.expectedMemoryVersion,
      memoryId: proposal.memoryId, approvedRevision: proposal.approvedRevision,
      reviewedBy: proposal.reviewedBy, rejectionReason: proposal.rejectionReason
    };
  }

  private async saveRevision(memory: any, session: ClientSession) {
    await ProjectMemoryRevision.create([{
      _id: randomUUID(), projectId: memory.projectId, memoryId: memory._id, revision: memory.revision,
      title: memory.title, category: memory.category, content: memory.content, status: memory.status,
      archived: memory.archived ?? false, sources: memory.sources ?? [], author: memory.author, createdAt: new Date()
    }], { session });
  }

  private eventData(memory: ReturnType<typeof memoryDto>) {
    return { memoryId: memory._id, title: memory.title, category: memory.category, status: memory.status, archived: memory.archived, revision: memory.revision, version: memory.version, sources: memory.sources };
  }
}
