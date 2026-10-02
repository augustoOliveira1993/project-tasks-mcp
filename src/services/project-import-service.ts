import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { Event, Project } from '../db.js';
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
  const project = row.parse(data.project) as any;
  check(project._id === bundle.source.projectId, 'O ID do projeto não corresponde à origem do pacote.');
  check(typeof project.name === 'string' && project.name.trim(), 'Projeto sem nome.');
  check(project.visibility === 'public' || project.visibility === 'private', 'Visibilidade do projeto inválida.');
  check(Array.isArray(project.repositories), 'Repositórios ausentes.');
  const projectFields = new Set(Object.keys(Project.schema.paths).map(path => path.split('.')[0]));
  check(Object.keys(project).every(key => projectFields.has(key)), 'Campo não suportado no projeto.');
  await new Project(project).validate().catch(() => { throw new ProjectImportError('Dados do projeto inválidos.'); });
  check(Array.isArray(project.areas) && project.areas.length && project.areas.every((area: unknown) => typeof area === 'string' && area.trim()), 'Áreas do projeto inválidas.');
  const names = ['project', ...projectExportCollections.map(([name]) => name)];
  check(Object.keys(data).every(name => names.includes(name)), 'O pacote contém uma coleção não suportada.');
  check(bundle.counts.project === 1 && bundle.counts.repositories === project.repositories.length, 'Contagem do projeto/repositórios incorreta.');
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
    check(Array.isArray(task.acceptance) && task.acceptance.every((item: unknown) => typeof item === 'string'), 'Critérios inválidos.');
    check(Array.isArray(task.acceptanceProgress) && task.acceptanceProgress.length <= task.acceptance.length && task.acceptanceProgress.every((item: unknown) => typeof item === 'boolean'), 'Progresso dos critérios inválido.');
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
  for (const message of data.conversationMessages) ref(message.conversationId, 'conversations', 'message.conversationId', true);
  for (const message of data.taskMessages) {
    ref(message.relatedTaskId, 'tasks', 'message.relatedTaskId'); ref(message.executionId, 'executions', 'message.executionId');
    ref(message.conversationId, 'conversations', 'message.conversationId'); ref(message.replyTo, 'taskMessages', 'message.replyTo');
  }
  for (const proposal of data.actionProposals) {
    ref(proposal.taskId, 'tasks', 'proposal.taskId', true); ref(proposal.conversationId, 'conversations', 'proposal.conversationId', true);
    ref(proposal.jobId, 'automationJobs', 'proposal.jobId');
  }
  for (const job of data.automationJobs) {
    ref(job.repositoryId, 'repositories', 'job.repositoryId'); ref(job.executionId, 'executions', 'job.executionId');
    ref(job.originJobId, 'automationJobs', 'job.originJobId'); ref(job.conversationId, 'conversations', 'job.conversationId');
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
  return { bundle, data, digest: hash(JSON.stringify(canonical(data))) };
}

export async function importProject(input: unknown, ownerKey: string, owner: string, session: ClientSession) {
  const { bundle, data, digest } = await validateProjectImport(input);
  const projectId = bundle.source.projectId;
  const existing = await Project.findById(projectId).session(session).lean();
  if (existing) {
    check(existing.importReceipt?.digest === digest, 'Já existe um projeto com este ID. A importação não sobrescreve dados existentes.', 409);
    return { projectId, name: existing.name, reused: true, counts: bundle.counts, warnings: [] };
  }
  for (const [name, model] of projectExportCollections) {
    check(!await model.exists({ _id: { $in: data[name].map((record: any) => record._id) } }).session(session), `Conflito de IDs em ${name}; nenhum dado foi importado.`, 409);
  }
  check(!await Project.exists({ 'repositories.id': { $in: data.project.repositories.map((repository: any) => repository.id) } }).session(session), 'Repositório já cadastrado em outro projeto.', 409);
  const adjustments: Array<{ collection: string; id: string; status: string }> = [];
  for (const name of ['tasks', 'executions']) for (const record of data[name]) if (record.status === 'em_execucao') {
    adjustments.push({ collection: name, id: record._id, status: record.status }); record.status = 'bloqueada';
    if (name === 'executions') record.endedAt = bundle.exportedAt;
  }
  for (const job of data.automationJobs) {
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      adjustments.push({ collection: 'automationJobs', id: job._id, status: job.status }); job.status = 'cancelled';
    }
    job.authorizationValid = false; job.turnInFlight = false;
    delete job.runnerId; delete job.preferredRunnerId; delete job.cwd;
  }
  for (const proposal of data.actionProposals) if (proposal.status === 'pending') {
    adjustments.push({ collection: 'actionProposals', id: proposal._id, status: proposal.status }); proposal.status = 'rejected';
  }
  for (const message of data.conversationMessages) { message.senderId = 'import'; message.operationId ??= message._id; }
  for (const revision of data.markdownRevisions) {
    revision.size = Buffer.byteLength(revision.content, 'utf8'); revision.sha256 = hash(revision.content);
  }
  for (const doc of data.markdownDocuments) {
    const revision = data.markdownRevisions.find((item: any) => item.documentId === doc._id && item.revision === doc.revision);
    doc.size = revision.size; doc.sha256 = revision.sha256;
  }
  for (const diff of data.taskDiffs) if (typeof diff.patch === 'string') diff.patchSha256 = hash(diff.patch);
  const maxSequence = data.deliveryEvents.reduce((max: number, event: any) => Math.max(max, Number(event.sequence) || 0), 0);
  data.project.eventSequence = Math.max(Number(data.project.eventSequence) || 0, maxSequence);
  data.project.members = { [ownerKey]: 'administrador' };
  data.project.importReceipt = { digest, importedAt: new Date(), importedBy: owner };
  await Project.insertMany([data.project], { session, timestamps: false });
  for (const [name, model] of projectExportCollections) if (data[name].length) await model.insertMany(data[name], { session, timestamps: false });
  await Event.create([{ _id: randomUUID(), projectId, entityId: projectId, action: 'import_project', author: owner, at: new Date(),
    summary: 'Projeto importado; acessos recriados e estados ativos desativados.', data: { adjustments, digest, sourceProjectId: projectId } }], { session });
  return { projectId, name: data.project.name, reused: false, counts: bundle.counts,
    warnings: ['Acessos devem ser configurados novamente. Execuções ativas foram bloqueadas; automações e propostas pendentes não serão retomadas.',
      ...(data.project.archived ? ['O projeto está arquivado e permanece arquivado após a importação.'] : [])] };
}
