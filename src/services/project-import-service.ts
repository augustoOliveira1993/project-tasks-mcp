import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { ConversationMessage, DeliveryEvent, Event, MarkdownDocument, MarkdownRevision, Project, TaskDependency } from '../db.js';
import { areasForProject } from '../area-catalog.js';
import { projectExportCollections, redactExport } from './project-export-service.js';

export class ProjectImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const check: (value: unknown, message: string, status?: number) => asserts value = (value, message, status) => {
  if (!value) throw new ProjectImportError(message, status);
};
const row = z.record(z.string(), z.unknown());
const envelope = z.object({
  format: z.literal('project-tasks-export'), schemaVersion: z.literal(1), exportedAt: z.iso.datetime(),
  source: z.object({ projectId: z.uuid() }).strict(), counts: z.record(z.string(), z.number().int().nonnegative()),
  data: z.record(z.string(), z.unknown()), migrationInstructions: z.string(), exclusions: z.array(z.string())
}).strict();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export async function validateProjectImport(input: unknown) {
  const bundle = envelope.parse(input);
  const data = redactExport(bundle.data) as Record<string, any>;
  // Bundles created before conversation workflows were introduced do not carry this collection.
  if (data.conversationTypes === undefined && bundle.counts.conversationTypes === undefined) {
    data.conversationTypes = [];
    bundle.counts.conversationTypes = 0;
  }
  const project = row.parse(data.project) as any;
  check(project._id === bundle.source.projectId, 'O ID do projeto não corresponde à origem do pacote.');
  check(typeof project.name === 'string' && project.name.trim(), 'Projeto sem nome.');
  check(project.visibility === 'public' || project.visibility === 'private', 'Visibilidade do projeto inválida.');
  if (project.areas == null || (Array.isArray(project.areas) && project.areas.length === 0)) project.areas = areasForProject(project);
  check(Array.isArray(project.repositories), 'Repositórios ausentes.');
  const projectFields = new Set(Object.keys(Project.schema.paths).map(path => path.split('.')[0]));
  check(Object.keys(project).every(key => projectFields.has(key)), 'Campo não suportado no projeto.');
  await new Project(project).validate().catch(() => { throw new ProjectImportError('Dados do projeto inválidos.'); });
  check(Array.isArray(project.areas) && project.areas.length && project.areas.every((area: unknown) => typeof area === 'string' && area.trim()), 'Áreas do projeto inválidas.');
  data.project = project;
  const names = ['project', ...projectExportCollections.map(([name]) => name)];
  check(Object.keys(data).every(name => names.includes(name)), 'O pacote contém uma coleção não suportada.');
  check(bundle.counts.project === 1 && bundle.counts.repositories === project.repositories.length, 'Contagem do projeto/repositórios incorreta.');
  check(Array.isArray(data.tasks) && bundle.counts.tasks === data.tasks.length, 'Tarefas ou contagem inválidas.');
  const taskRows = data.tasks.map((task: unknown) => row.parse(task) as any);
  const acceptanceProgressRepairs: Array<{ taskId: string; criterionCount: number; savedProgressCount: number }> = [];
  for (const task of taskRows) {
    check(Array.isArray(task.acceptance) && task.acceptance.every((item: unknown) => typeof item === 'string'), 'Critérios inválidos.');
    const savedProgress = Array.isArray(task.acceptanceProgress) ? task.acceptanceProgress : [];
    const acceptanceProgress = task.acceptance.map((_criterion: string, index: number) => savedProgress[index] === true);
    if (!Array.isArray(task.acceptanceProgress) || savedProgress.length !== acceptanceProgress.length || savedProgress.some((item: unknown) => typeof item !== 'boolean')) {
      acceptanceProgressRepairs.push({ taskId: task._id, criterionCount: acceptanceProgress.length, savedProgressCount: savedProgress.length });
    }
    task.acceptanceProgress = acceptanceProgress;
  }
  data.tasks = taskRows;
  const ids = new Map<string, Set<string>>();
  ids.set('repositories', new Set());
  for (const repository of project.repositories) {
    z.object({ id: z.uuid(), name: z.string().min(1), url: z.string(), instructions: z.string().optional() }).passthrough().parse(repository);
    check(!ids.get('repositories')!.has(repository.id), 'ID de repositório duplicado.');
    ids.get('repositories')!.add(repository.id);
  }
  for (const [name, model] of projectExportCollections) {
    check(Array.isArray(data[name]), `Coleção ausente: ${name}.`);
    check(bundle.counts[name] === data[name].length, `Contagem incorreta: ${name}.`);
    const known = new Set(Object.keys(model.schema.paths).map(path => path.split('.')[0]));
    const collectionIds = new Set<string>();
    for (const record of data[name]) {
      row.parse(record);
      check(typeof record._id === 'string' && record._id.length > 0, `ID ausente em ${name}.`);
      check(!collectionIds.has(record._id), `ID duplicado em ${name}.`);
      check(record.projectId === project._id, `Registro de outro projeto em ${name}.`);
      check(Object.keys(record).every(key => known.has(key)), `Campo não suportado em ${name}.`);
      collectionIds.add(record._id);
      await new model(record).validate().catch(() => { throw new ProjectImportError(`Registro inválido em ${name}.`); });
    }
    ids.set(name, collectionIds);
  }
  const ref = (value: unknown, collection: string, label: string, required = false) => {
    if (value == null && !required) return;
    check(typeof value === 'string' && ids.get(collection)?.has(value), `Vínculo inválido: ${label}.`);
  };
  const taskById = new Map<string, any>(data.tasks.map((task: any) => [task._id, task]));
  for (const task of data.tasks) {
    ref(task.repositoryId, 'repositories', 'task.repositoryId', true);
    ref(task.featureId, 'features', 'task.featureId');
    ref(task.executionId, 'executions', 'task.executionId');
    check(['pendente', 'em_execucao', 'bloqueada', 'em_revisao', 'concluida', 'cancelada'].includes(task.status), 'Status de tarefa inválido.');
    check(project.areas.includes(task.area), 'Área de tarefa não cadastrada.');
    check(Array.isArray(task.dependencies) && new Set(task.dependencies).size === task.dependencies.length, 'Dependências inválidas ou duplicadas.');
    for (const dependency of task.dependencies) ref(dependency, 'tasks', 'task.dependencies', true);
  }
  // Kahn's algorithm avoids recursive traversal on large or hostile graphs.
  const remaining = new Map<string, number>(), children = new Map<string, string[]>();
  for (const task of data.tasks) {
    remaining.set(task._id, task.dependencies.length);
    for (const dependency of task.dependencies) {
      if (!children.has(dependency)) children.set(dependency, []);
      children.get(dependency)!.push(task._id);
    }
  }
  const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < ready.length; index++) for (const child of children.get(ready[index]) ?? []) {
    remaining.set(child, remaining.get(child)! - 1);
    if (remaining.get(child) === 0) ready.push(child);
  }
  check(ready.length === data.tasks.length, 'Ciclo de dependências no pacote.');
  for (const edge of data.taskDependencies) {
    ref(edge.taskId, 'tasks', 'dependency.taskId', true); ref(edge.dependencyId, 'tasks', 'dependency.dependencyId', true);
    check(taskById.get(edge.taskId).dependencies.includes(edge.dependencyId), 'Índice de dependências inconsistente.');
  }
  for (const name of ['executions', 'taskMessages', 'taskDiffs', 'automationJobs']) for (const record of data[name]) ref(record.taskId, 'tasks', `${name}.taskId`, true);
  for (const execution of data.executions) ref(execution.managedJobId, 'automationJobs', 'execution.managedJobId');
  for (const conversation of data.conversations) ref(conversation.taskId, 'tasks', 'conversation.taskId');
  // Conversation links are resolved during partial import so orphaned messages can be skipped.
  for (const message of data.taskMessages) {
    ref(message.relatedTaskId, 'tasks', 'message.relatedTaskId'); ref(message.executionId, 'executions', 'message.executionId');
    ref(message.replyTo, 'taskMessages', 'message.replyTo');
  }
  for (const proposal of data.actionProposals) {
    ref(proposal.taskId, 'tasks', 'proposal.taskId', true);
    ref(proposal.jobId, 'automationJobs', 'proposal.jobId');
  }
  for (const job of data.automationJobs) {
    ref(job.repositoryId, 'repositories', 'job.repositoryId'); ref(job.executionId, 'executions', 'job.executionId');
    ref(job.originJobId, 'automationJobs', 'job.originJobId');
    ref(job.triggerMessageId, 'taskMessages', 'job.triggerMessageId');
  }
  for (const diff of data.taskDiffs) ref(diff.repositoryId, 'repositories', 'diff.repositoryId');
  for (const doc of data.markdownDocuments) {
    check(['task', 'feature'].includes(doc.targetKind), 'Destino de documento inválido.');
    ref(doc.targetId, doc.targetKind === 'task' ? 'tasks' : 'features', 'document.targetId', true);
    check(data.markdownRevisions.some((revision: any) => revision.documentId === doc._id && revision.revision === doc.revision), 'Revisão atual do documento ausente.');
  }
  for (const revision of data.markdownRevisions) {
    ref(revision.documentId, 'markdownDocuments', 'revision.documentId', true);
    check(typeof revision.content === 'string' && Number.isInteger(revision.revision) && revision.revision > 0, 'Revisão de documento inválida.');
  }
  return { bundle, data, acceptanceProgressRepairs, digest: hash(JSON.stringify(canonical(data))) };
}

export async function importProject(input: unknown, ownerKey: string, owner: string, session: ClientSession, origin = 'Importação do projeto') {
  const { bundle, data, acceptanceProgressRepairs, digest } = await validateProjectImport(input);
  const projectId = bundle.source.projectId;
  const existing = await Project.findById(projectId).session(session).lean();
  const existingCounts = Object.fromEntries(projectExportCollections.map(([name]) => [name, 0]));
  if (existing?.importReceipt?.digest === digest) return {
    projectId, name: existing.name, reused: true, importedCounts: existingCounts,
    alreadyImported: true, skippedCounts: {}, skipped: [], warnings: ['Este pacote já foi processado; nenhum registro foi duplicado.']
  };

  const skippedCounts: Record<string, number> = {};
  const importedCounts: Record<string, number> = {};
  const skipped: Array<{ collection: string; id: string; reason: string }> = [];
  const skippedIds = new Map<string, string>();
  const skip = (collection: string, id: string, reason: string) => {
    const key = `${collection}:${id}`;
    if (skippedIds.has(key)) return;
    skippedIds.set(key, reason);
    skippedCounts[collection] = (skippedCounts[collection] ?? 0) + 1;
    if (skipped.length < 100) skipped.push({ collection, id, reason });
  };
  const target = existing ?? data.project;
  const normalizeUrl = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\/$/, '').toLocaleLowerCase('en-US') : '';
  const sameRepository = (left: any, right: any) => normalizeUrl(left?.git?.canonicalRemoteUrl ?? left?.url) === normalizeUrl(right?.git?.canonicalRemoteUrl ?? right?.url);
  const existingProjects = await Project.find({ 'repositories.id': { $in: data.project.repositories.map((repository: any) => repository.id) } })
    .select('_id repositories').session(session).lean();
  const repositoriesToAdd: any[] = [];
  const available = new Map<string, Set<string>>([['repositories', new Set<string>()]]);
  const repositoryConflicts = new Set<string>();
  const mergedAreas = [...(target.areas ?? [])];
  const areaNames = new Set(mergedAreas.map((area: string) => area.toLocaleLowerCase('pt-BR')));
  for (const area of data.project.areas) if (!areaNames.has(area.toLocaleLowerCase('pt-BR'))) { mergedAreas.push(area); areaNames.add(area.toLocaleLowerCase('pt-BR')); }
  for (const repository of data.project.repositories) {
    const inTarget = (existing?.repositories ?? []).find((item: any) => item.id === repository.id);
    const anywhere = existingProjects.flatMap(item => (item.repositories ?? []).filter((repo: any) => repo.id === repository.id));
    if (inTarget) {
      if (sameRepository(inTarget, repository)) available.get('repositories')!.add(repository.id);
      else { repositoryConflicts.add(repository.id); skip('repositories', repository.id, 'O ID já existe com uma URL de repositório diferente; vínculo preservado.'); }
      skip('repositories', repository.id, 'O repositório já existe no projeto; configuração preservada.');
    } else if (anywhere.some(item => !sameRepository(item, repository))) {
      repositoryConflicts.add(repository.id);
      skip('repositories', repository.id, 'O ID já pertence a outro repositório; vínculo pulado.');
    } else {
      repositoriesToAdd.push(repository);
      available.get('repositories')!.add(repository.id);
    }
  }
  for (const repository of existing?.repositories ?? []) if (typeof repository.id === 'string' && !repositoryConflicts.has(repository.id)) available.get('repositories')!.add(repository.id);
  const candidates = new Map<string, any[]>(projectExportCollections.map(([name]) => [name, [...data[name]]]));
  const idConflicts = new Map<string, Set<string>>();
  const existingTaskDependencies = new Map<string, Set<string>>();
  for (const [name, model] of projectExportCollections) {
    const sourceIds = data[name].map((record: any) => record._id);
    const rows = sourceIds.length ? await model.find({ _id: { $in: sourceIds } }).select(name === 'tasks' ? '_id projectId dependencies' : '_id projectId').session(session).lean() : [];
    const availableIds = new Set<string>();
    const conflicts = new Set<string>();
    for (const row of rows) {
      conflicts.add(row._id);
      if (row.projectId === projectId) {
        availableIds.add(row._id);
        if (name === 'tasks') existingTaskDependencies.set(row._id, new Set(row.dependencies ?? []));
      }
      skip(name, row._id, row.projectId === projectId ? 'O ID já existe no projeto; registro preservado.' : 'O ID já pertence a outro projeto; registro pulado.');
    }
    for (const sourceId of sourceIds) if (!conflicts.has(sourceId)) availableIds.add(sourceId);
    available.set(name, availableIds);
    idConflicts.set(name, conflicts);
    candidates.set(name, data[name].filter((record: any) => !conflicts.has(record._id)));
  }

  for (const taskMessage of data.conversationMessages) { taskMessage.senderId = 'import'; taskMessage.operationId ??= taskMessage._id; }
  const uniqueConflicts = new Map<string, Set<string>>();
  const markUniqueConflict = (name: string, ids: string[], reason: string) => {
    if (!uniqueConflicts.has(name)) uniqueConflicts.set(name, new Set());
    for (const id of ids) {
      uniqueConflicts.get(name)!.add(id);
      if (!idConflicts.get(name)?.has(id)) available.get(name)?.delete(id);
      skip(name, id, reason);
    }
  };
  const [existingEdges, existingDocs, existingRevisions, existingMessages, existingDeliveries] = await Promise.all([
    TaskDependency.find({ projectId, taskId: { $in: data.taskDependencies.map((item: any) => item.taskId) } }).select('taskId dependencyId').session(session).lean(),
    MarkdownDocument.find({ projectId }).select('_id targetKind targetId name').session(session).lean(),
    MarkdownRevision.find({ documentId: { $in: data.markdownDocuments.map((item: any) => item._id) } }).select('documentId revision').session(session).lean(),
    ConversationMessage.find({ conversationId: { $in: data.conversationMessages.map((item: any) => item.conversationId) }, senderId: 'import', operationId: { $in: data.conversationMessages.map((item: any) => item.operationId) } }).select('conversationId operationId').session(session).lean(),
    DeliveryEvent.find({ projectId, sequence: { $in: data.deliveryEvents.map((item: any) => item.sequence) } }).select('sequence').session(session).lean()
  ]);
  const edgeKeys = new Set(existingEdges.map(item => `${item.taskId}:${item.dependencyId}`));
  for (const edge of data.taskDependencies) { const key = `${edge.taskId}:${edge.dependencyId}`; if (edgeKeys.has(key)) markUniqueConflict('taskDependencies', [edge._id], 'A dependência já existe; registro preservado.'); else edgeKeys.add(key); }
  for (const edge of data.taskDependencies) if (idConflicts.get('tasks')?.has(edge.taskId) && !existingTaskDependencies.get(edge.taskId)?.has(edge.dependencyId)) {
    markUniqueConflict('taskDependencies', [edge._id], 'A tarefa existente não contém esta dependência; estado preservado.');
  }
  const docKeys = new Set(existingDocs.map(item => `${item.targetKind}:${item.targetId}:${item.name}`));
  for (const doc of data.markdownDocuments) { const key = `${doc.targetKind}:${doc.targetId}:${doc.name}`; if (docKeys.has(key)) markUniqueConflict('markdownDocuments', [doc._id], 'Já existe um documento com este destino e nome; documento preservado.'); else docKeys.add(key); }
  const revisionKeys = new Set(existingRevisions.map(item => `${item.documentId}:${item.revision}`));
  for (const revision of data.markdownRevisions) { const key = `${revision.documentId}:${revision.revision}`; if (revisionKeys.has(key)) markUniqueConflict('markdownRevisions', [revision._id], 'A revisão já existe; registro preservado.'); else revisionKeys.add(key); }
  const messageKeys = new Set(existingMessages.map(item => `${item.conversationId}:${item.operationId}`));
  for (const message of data.conversationMessages) { const key = `${message.conversationId}:${message.operationId}`; if (messageKeys.has(key)) markUniqueConflict('conversationMessages', [message._id], 'A mensagem com esta operação já existe; registro preservado.'); else messageKeys.add(key); }
  const deliveryKeys = new Set(existingDeliveries.map(item => String(item.sequence)));
  for (const event of data.deliveryEvents) { const key = String(event.sequence); if (deliveryKeys.has(key)) markUniqueConflict('deliveryEvents', [event._id], 'A sequência do evento já existe; evento preservado.'); else deliveryKeys.add(key); }
  for (const [name, rows] of candidates) {
    const unique = uniqueConflicts.get(name);
    if (unique?.size) candidates.set(name, rows.filter(record => !unique.has(record._id)));
  }

  const referenceErrors = new Map<string, string>();
  const referencesAvailable = (name: string, record: any) => {
    const has = (collection: string, id: unknown) => id == null || available.get(collection)?.has(String(id)) === true;
    const requiresConversation = ['conversationMessages', 'actionProposals'].includes(name);
    if (['conversationMessages', 'actionProposals', 'taskMessages', 'automationJobs'].includes(name) &&
      (requiresConversation || record.conversationId != null) &&
      (typeof record.conversationId !== 'string' || !available.get('conversations')?.has(record.conversationId))) {
      referenceErrors.set(`${name}:${record._id}`, `Vínculo inválido: conversationId (${record.conversationId ?? 'ausente'}). A conversa não está disponível para este registro.`);
      return false;
    }
    const base: Record<string, Array<[string, unknown]>> = {
      tasks: [['repositories', record.repositoryId], ['features', record.featureId], ['executions', record.executionId], ...(record.dependencies ?? []).map((id: string) => ['tasks', id] as [string, unknown])],
      taskDependencies: [['tasks', record.taskId], ['tasks', record.dependencyId]],
      executions: [['tasks', record.taskId], ['automationJobs', record.managedJobId]],
      taskMessages: [['tasks', record.taskId], ['tasks', record.relatedTaskId], ['executions', record.executionId], ['conversations', record.conversationId], ['taskMessages', record.replyTo]],
      conversations: [['tasks', record.taskId]],
      conversationMessages: [['conversations', record.conversationId]],
      actionProposals: [['tasks', record.taskId], ['conversations', record.conversationId], ['automationJobs', record.jobId]],
      deliveryEvents: (record.taskIds ?? []).map((id: string) => ['tasks', id] as [string, unknown]),
      taskDiffs: [['tasks', record.taskId], ['repositories', record.repositoryId]],
      automationJobs: [['tasks', record.taskId], ['repositories', record.repositoryId], ['executions', record.executionId], ['automationJobs', record.originJobId], ['conversations', record.conversationId], ['taskMessages', record.triggerMessageId]],
      markdownDocuments: [[record.targetKind === 'task' ? 'tasks' : 'features', record.targetId]],
      markdownRevisions: [['markdownDocuments', record.documentId]]
    };
    if (!(base[name] ?? []).every(([collection, id]) => has(collection, id))) return false;
    if (name === 'tasks' && !areaNames.has(record.area.toLocaleLowerCase('pt-BR'))) return false;
    if (name === 'markdownDocuments') return available.get('markdownRevisions')?.has(String(data.markdownRevisions.find((revision: any) => revision.documentId === record._id && revision.revision === record.revision)?._id)) === true;
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, rows] of candidates) {
      const keep: any[] = [];
      for (const record of rows) {
        if (referencesAvailable(name, record)) keep.push(record);
        else { skip(name, record._id, referenceErrors.get(`${name}:${record._id}`) ?? 'Um registro vinculado foi ignorado ou não existe no projeto de destino.'); available.get(name)?.delete(record._id); changed = true; }
      }
      candidates.set(name, keep);
    }
  }
  const adjustments: Array<{ collection: string; id: string; status: string }> = [];
  for (const name of ['tasks', 'executions']) for (const record of candidates.get(name) ?? []) if (record.status === 'em_execucao') {
    adjustments.push({ collection: name, id: record._id, status: record.status }); record.status = 'bloqueada';
    if (name === 'executions') record.endedAt = bundle.exportedAt;
  }
  for (const job of candidates.get('automationJobs') ?? []) {
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      adjustments.push({ collection: 'automationJobs', id: job._id, status: job.status }); job.status = 'cancelled';
    }
    job.authorizationValid = false; job.turnInFlight = false;
    delete job.runnerId; delete job.preferredRunnerId; delete job.cwd;
  }
  for (const proposal of candidates.get('actionProposals') ?? []) if (proposal.status === 'pending') {
    adjustments.push({ collection: 'actionProposals', id: proposal._id, status: proposal.status }); proposal.status = 'rejected';
  }
  for (const revision of candidates.get('markdownRevisions') ?? []) {
    revision.size = Buffer.byteLength(revision.content, 'utf8'); revision.sha256 = hash(revision.content);
  }
  for (const doc of candidates.get('markdownDocuments') ?? []) {
    const revision = data.markdownRevisions.find((item: any) => item.documentId === doc._id && item.revision === doc.revision);
    doc.size = revision.size; doc.sha256 = revision.sha256;
  }
  for (const diff of candidates.get('taskDiffs') ?? []) if (typeof diff.patch === 'string') diff.patchSha256 = hash(diff.patch);
  const incomingProject = existing ? null : { ...data.project, repositories: repositoriesToAdd, areas: [...new Set(data.project.areas)] };
  const repoIds = new Set((target.repositories ?? []).map((repository: any) => repository.id));
  const mergedRepositories = [...(target.repositories ?? []), ...repositoriesToAdd.filter(repository => !repoIds.has(repository.id))];
  const addedRepositoryCount = existing ? repositoriesToAdd.filter(repository => !repoIds.has(repository.id)).length : repositoriesToAdd.length;
  const projectMetadataChanged = mergedAreas.length > (target.areas ?? []).length || mergedRepositories.length > (target.repositories ?? []).length;
  if (existing) skip('project', projectId, 'O projeto já existe; campos existentes foram preservados.');
  if (!existing && incomingProject) {
    const maxSequence = data.deliveryEvents.reduce((max: number, event: any) => Math.max(max, Number(event.sequence) || 0), 0);
    incomingProject.eventSequence = Math.max(Number(incomingProject.eventSequence) || 0, maxSequence);
    incomingProject.members = { [ownerKey]: 'administrador' };
    incomingProject.importReceipt = { digest, importedAt: new Date(), importedBy: owner };
    await Project.insertMany([incomingProject], { session, timestamps: false });
    importedCounts.project = 1;
  } else if (existing) {
    await Project.updateOne({ _id: projectId }, { $set: { repositories: mergedRepositories, areas: mergedAreas,
      importReceipt: { digest, importedAt: new Date(), importedBy: owner } },
      $max: { eventSequence: Math.max(Number(data.project.eventSequence) || 0,
        (candidates.get('deliveryEvents') ?? []).reduce((max: number, event: any) => Math.max(max, Number(event.sequence) || 0), 0)) },
      $inc: { version: 1 } }, { session });
  }
  importedCounts.project = existing ? Number(projectMetadataChanged) : 1;
  importedCounts.repositories = addedRepositoryCount;
  for (const [name, model] of projectExportCollections) {
    const records = candidates.get(name) ?? [];
    if (records.length) await model.insertMany(records, { session, timestamps: false });
    importedCounts[name] = records.length;
  }
  const insertedRecords = Object.values(importedCounts).reduce((sum, count) => sum + count, 0);
  if (insertedRecords > 0) await Event.create([{ _id: randomUUID(), projectId, entityId: projectId, action: 'import_project', author: owner, origin, at: new Date(),
    summary: 'Projeto importado parcialmente quando necessário; itens existentes foram preservados.', data: { adjustments, acceptanceProgressRepairs, skippedCounts, skipped, digest, sourceProjectId: projectId } }], { session });
  return { projectId, name: target.name, reused: Boolean(existing), alreadyImported: false, importedCounts, skippedCounts, skipped,
    skippedDetailsTruncated: Object.values(skippedCounts).reduce((sum, count) => sum + count, 0) > skipped.length,
    warnings: [
      ...(insertedRecords ? ['Acessos devem ser configurados novamente. Execuções ativas foram bloqueadas; automações e propostas pendentes não serão retomadas.'] : []),
      ...(acceptanceProgressRepairs.length ? [`O progresso dos critérios foi ajustado em ${acceptanceProgressRepairs.length} tarefa(s); os critérios correspondentes marcados como concluídos foram preservados.`] : []),
      ...(existing ? ['Os dados do projeto e registros que já existiam foram preservados.'] : []),
      ...(data.project.archived ? ['O projeto está arquivado e permanece arquivado após a importação.'] : [])] };
}
