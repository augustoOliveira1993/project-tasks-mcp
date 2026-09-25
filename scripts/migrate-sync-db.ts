import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { Event, Feature, MarkdownDocument, MarkdownRevision, Operation, Project, Task, TaskMessage } from '../src/db.js';

type Row = Record<string, any>;
type SourceProject = Row & { repositories: Row[]; members: Row[] };
type SourceTask = Row & { dependencies: number[]; events: Row[] };

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const sourcePath = argValue('--source');
const mongoUri = argValue('--mongo-uri') ?? process.env.MONGODB_URI;
const applying = args.includes('--apply');
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node --env-file-if-exists=.env --import tsx scripts/migrate-sync-db.ts --source <sync.db> [--mongo-uri <uri>] [--repository-default <slug>=<repo>]... [--apply]');
  console.log('Preview is the default. With MONGODB_URI set, it matches repositories by remote URL or by matching repository name and root commit; --apply reuses matches and creates only missing Projects.');
  process.exit(0);
}
if (!sourcePath) throw new Error('Informe --source <sync.db>.');
if (applying && !mongoUri) throw new Error('Informe --mongo-uri ou MONGODB_URI para aplicar a migração.');

const repositoryDefaults = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--repository-default') continue;
  const value = args[++i];
  const separator = value?.indexOf('=') ?? -1;
  if (separator < 1 || separator === value!.length - 1) throw new Error('Use --repository-default <slug>=<nome-do-repositorio>.');
  repositoryDefaults.set(value!.slice(0, separator), value!.slice(separator + 1));
}

const uuid = (key: string) => {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
const memberKey = (email: string) => 'email_' + createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
const date = (value: string | null | undefined) => value ? new Date(value) : undefined;
const readRows = (db: DatabaseSync, sql: string) => db.prepare(sql).all() as Row[];
const readOne = (db: DatabaseSync, sql: string, ...values: unknown[]) => db.prepare(sql).get(...values) as Row | undefined;

const sourceFile = resolve(sourcePath);
const db = new DatabaseSync(sourceFile, { readOnly: true });
const projects: SourceProject[] = readRows(db, 'SELECT * FROM projects ORDER BY id').map(project => ({
  ...project,
  repositories: [],
  members: []
}));
for (const project of projects) {
  project.repositories = db.prepare('SELECT * FROM project_repos WHERE project_id = ? ORDER BY name, root_sha').all(project.id) as Row[];
  project.members = db.prepare(`SELECT m.role, p.id person_id, p.email, p.alias, p.name
    FROM memberships m JOIN people p ON p.id = m.person_id WHERE m.project_id = ? ORDER BY p.id`).all(project.id) as Row[];
}
const people = new Map(readRows(db, 'SELECT id, email, alias, name FROM people').map(person => [person.id, person]));
const notMigrated = {
  taskReads: Number(readOne(db, 'SELECT COUNT(*) count FROM task_reads')?.count ?? 0),
  membershipRequests: Number(readOne(db, 'SELECT COUNT(*) count FROM membership_requests')?.count ?? 0),
  sourceTokenHashes: Number(readOne(db, 'SELECT COUNT(*) count FROM people WHERE token_hash IS NOT NULL')?.count ?? 0)
};
const tasks: SourceTask[] = readRows(db, 'SELECT * FROM tasks ORDER BY project_id, id').map(task => ({
  ...task,
  dependencies: (db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_id').all(task.id) as Row[]).map(row => row.depends_on_id),
  events: db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY seq').all(task.id) as Row[]
}));
const allEvents = readRows(db, 'SELECT * FROM events ORDER BY seq');
const operations = readRows(db, 'SELECT * FROM operations ORDER BY id');
const sourceFingerprint = createHash('sha256');
for await (const chunk of createReadStream(sourceFile)) sourceFingerprint.update(chunk);
const fingerprint = sourceFingerprint.digest('hex');
db.close();
if (allEvents.some(event => event.task_id == null)) throw new Error('Há eventos sem tarefa; o destino exige definir se pertencem ao projeto Git ou à feature.');

const projectById = new Map(projects.map(project => [project.id, project]));
const taskIds = new Map(tasks.map(task => [task.id, uuid(`${fingerprint}:task:${task.id}`)]));
const normalizeRemote = (remote: unknown) => String(remote ?? '').trim().toLowerCase().replace(/\/+$/, '');
const gitRepositoryKey = (repository: Row) => normalizeRemote(repository.remote);
const matchesTargetRepository = (target: Row, source: Row) =>
  normalizeRemote(target.git?.canonicalRemoteUrl) === gitRepositoryKey(source) || normalizeRemote(target.url) === gitRepositoryKey(source) ||
  (String(target.name ?? '').toLowerCase() === String(source.name ?? '').toLowerCase() &&
    !!target.git?.rootCommit && String(target.git.rootCommit).toLowerCase() === String(source.root_sha ?? '').toLowerCase());
const gitRepositories = new Map<string, Row>();
const sourceProjectsByRepository = new Map<string, SourceProject[]>();
for (const project of projects) for (const repository of project.repositories) {
  const key = gitRepositoryKey(repository);
  const existing = gitRepositories.get(key);
  if (existing && String(existing.root_sha).toLowerCase() !== String(repository.root_sha).toLowerCase()) {
    throw new Error(`O repositório ${repository.remote} tem root_sha divergente entre projetos da origem.`);
  }
  if (!existing) gitRepositories.set(key, repository);
  const associated = sourceProjectsByRepository.get(key) ?? [];
  if (!associated.some(item => item.id === project.id)) associated.push(project);
  sourceProjectsByRepository.set(key, associated);
}
const projectGroups: Array<{ key: string; name: string; sourceProjects: SourceProject[]; repositories: Row[] }> = [];
const groupedSourceProjectIds = new Set<number>();
while (groupedSourceProjectIds.size < projects.length) {
  const first = projects.find(project => !groupedSourceProjectIds.has(project.id))!;
  const groupProjects = new Map<number, SourceProject>();
  const groupRepositoryKeys = new Set<string>();
  const queue = [first];
  while (queue.length) {
    const project = queue.pop()!;
    if (groupProjects.has(project.id)) continue;
    groupProjects.set(project.id, project);
    groupedSourceProjectIds.add(project.id);
    for (const repository of project.repositories) {
      const key = gitRepositoryKey(repository);
      groupRepositoryKeys.add(key);
      for (const neighbor of sourceProjectsByRepository.get(key) ?? []) if (!groupProjects.has(neighbor.id)) queue.push(neighbor);
    }
  }
  const sourceProjects = [...groupProjects.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const repositories = [...groupRepositoryKeys].map(key => gitRepositories.get(key)!);
  const commonPrefix = repositories.map(repository => String(repository.name).split('_')[0].toLowerCase()).every(prefix => prefix === String(repositories[0].name).split('_')[0].toLowerCase())
    ? String(repositories[0].name).split('_')[0].toUpperCase() : undefined;
  const name = commonPrefix && sourceProjects.length > 1 ? commonPrefix : sourceProjects[0].slug === 'avb-one' ? 'AVBOne' : sourceProjects[0].name;
  projectGroups.push({ key: sourceProjects.map(project => project.id).join(':'), name, sourceProjects, repositories });
}
const groupBySourceProjectId = new Map(projectGroups.flatMap(group => group.sourceProjects.map(project => [project.id, group] as const)));
const groupByRepositoryKey = new Map(projectGroups.flatMap(group => group.repositories.map(repository => [gitRepositoryKey(repository), group] as const)));
const databaseLookupPerformed = !!mongoUri;
let existingTargetProjects: Row[] = [];
if (mongoUri) {
  await mongoose.connect(mongoUri);
  try { existingTargetProjects = await Project.find({}, { _id: 1, name: 1, archived: 1, members: 1, repositories: 1 }).lean() as Row[]; }
  finally { await mongoose.disconnect(); }
}
const existingProjectByGroup = new Map<string, Row>();
const existingRepositoryBySourceRemote = new Map<string, Row>();
for (const group of projectGroups) {
  const matches = new Map<string, Row>();
  const repositoriesByTargetProject = new Map<string, Set<string>>();
  for (const sourceRepository of group.repositories) {
    const key = gitRepositoryKey(sourceRepository);
    for (const target of existingTargetProjects) for (const repository of target.repositories ?? []) {
      if (matchesTargetRepository(repository, sourceRepository)) {
        matches.set(String(target._id), target);
        const matchedRepositories = repositoriesByTargetProject.get(String(target._id)) ?? new Set<string>();
        matchedRepositories.add(key);
        repositoriesByTargetProject.set(String(target._id), matchedRepositories);
      }
    }
  }
  const completeMatches = [...matches].filter(([id]) => repositoriesByTargetProject.get(id)?.size === group.repositories.length);
  if (completeMatches.length > 1) throw new Error(`Mais de um Project no destino contém todos os repositórios do grupo ${group.name}; correspondência ambígua.`);
  if (completeMatches.length === 1) existingProjectByGroup.set(group.key, completeMatches[0][1]);
  else if (matches.size > 1) throw new Error(`Os repositórios do grupo ${group.name} aparecem em Projects diferentes no destino; correspondência ambígua.`);
  else if (matches.size === 1) existingProjectByGroup.set(group.key, [...matches.values()][0]);
  const target = existingProjectByGroup.get(group.key);
  if (target) for (const sourceRepository of group.repositories) {
    const key = gitRepositoryKey(sourceRepository);
    const matches = (target.repositories ?? []).filter((repository: Row) => matchesTargetRepository(repository, sourceRepository));
    if (matches.length > 1) throw new Error(`O remote ${sourceRepository.remote} aparece repetido no Project ${target.name}.`);
    if (matches.length === 1) {
      if (!matches[0].id) throw new Error(`O repositório ${sourceRepository.remote} existe no destino sem id.`);
      existingRepositoryBySourceRemote.set(key, matches[0]);
    } else existingRepositoryBySourceRemote.delete(key);
  }
}
const projectIds = new Map(projectGroups.map(group => [group.key,
  existingProjectByGroup.get(group.key)?._id ?? uuid(`${fingerprint}:git-project-group:${group.key}`)]));
const repositoryIds = new Map([...gitRepositories.keys()].map(key => [key,
  existingRepositoryBySourceRemote.get(key)?.id ?? uuid(`${fingerprint}:git-repository:${key}`)]));

const chooseRepository = (task: SourceTask, project: SourceProject) => {
  const tags: string[] = JSON.parse(task.tags || '[]').map((tag: string) => tag.toLowerCase());
  const repositories = project.repositories as Row[];
  const byName = repositories.filter(repo => tags.some(tag => tag === String(repo.name).toLowerCase() || tag.includes(String(repo.name).toLowerCase())));
  const direction = tags.includes('backend') ? 'back' : tags.includes('frontend') ? 'front' : undefined;
  const byArea = direction ? repositories.filter(repo => String(repo.name).toLowerCase().endsWith(direction)) : [];
  const candidates = byName.length ? byName : byArea;
  if (candidates.length === 1) return candidates[0];
  const defaultName = repositoryDefaults.get(String(project.slug));
  const configured = defaultName && repositories.find(repo => repo.name === defaultName);
  if (candidates.length > 1) {
    if (configured) return configured;
    throw new Error(`Tarefa ${project.slug}/${task.code}: tags apontam para mais de um repositório; configure --repository-default.`);
  }
  if (repositories.length === 1) return repositories[0];
  if (configured) return configured;
  throw new Error(`Tarefa ${project.slug}/${task.code} não identifica repositório; informe --repository-default ${project.slug}=<nome>.`);
};

const taskGitRepositories = new Map(tasks.map(task => [task.id, chooseRepository(task, projectById.get(task.project_id)!)]));
const taskTargetProjectIds = new Map(tasks.map(task => [task.id, projectIds.get(groupBySourceProjectId.get(task.project_id)!.key)!]));
for (const [slug, repositoryName] of repositoryDefaults) {
  const project = projects.find(item => item.slug === slug);
  if (!project?.repositories.some(repository => repository.name === repositoryName)) throw new Error(`Repositório padrão inválido: ${slug}=${repositoryName}.`);
}
for (const task of tasks) for (const dependencyId of task.dependencies) {
  if (taskTargetProjectIds.get(task.id) !== taskTargetProjectIds.get(dependencyId)) {
    const dependency = tasks.find(item => item.id === dependencyId);
    throw new Error(`Dependência ${task.code} -> ${dependency?.code ?? dependencyId} cruza Projects agrupados por repositório.`);
  }
}
const featureIdFor = (sourceProjectId: number) => uuid(`${fingerprint}:feature:${sourceProjectId}`);

const statusMap: Record<string, string> = {
  ideia: 'pendente', parcial: 'em_execucao', feito: 'concluida', bloqueado: 'bloqueada', aguardando_decisao: 'em_revisao'
};
const sourceTitle = (task: SourceTask) => `${task.code}: ${task.title}`;
const summaryText = (event: Row, task?: SourceTask) => {
  if (event.kind === 'task.created') return `Tarefa criada: ${task ? sourceTitle(task) : `#${event.task_id}`}`;
  if (event.kind === 'task.field_changed') return `Campo ${event.campo} alterado`;
  if (event.kind === 'body.updated') return 'Descrição atualizada';
  return event.type ? `Mensagem (${event.type})` : 'Evento legado';
};

for (const [key, repository] of gitRepositories) {
  try { new URL(repository.remote); } catch { throw new Error(`Repositório ${repository.name} não tem URL válida.`); }
  if (!/^[0-9a-f]{40}$/i.test(repository.root_sha)) throw new Error(`Repositório ${repository.name} não tem root_sha SHA-1 válido.`);
}

const sourceMemberRolesForGroup = (group: typeof projectGroups[number]) => {
  const membershipRoles = new Map<string, { role: string; name: string; alias: string; email: string }>();
  for (const sourceProject of group.sourceProjects) for (const member of sourceProject.members) {
    const previous = membershipRoles.get(member.email.toLowerCase());
    membershipRoles.set(member.email.toLowerCase(), { ...member, role: previous?.role === 'owner' || member.role === 'owner' ? 'owner' : 'member' });
  }
  return [...membershipRoles.values()];
};

const repositoryDoc = (repository: Row) => ({ id: repositoryIds.get(gitRepositoryKey(repository))!, name: repository.name, url: repository.remote,
  instructions: 'Repositório importado do sync.db; instruções originais não disponíveis.',
  git: { canonicalRemoteUrl: repository.remote, rootCommit: String(repository.root_sha).toLowerCase(), boundAt: date(repository.created_at), boundBy: 'sync.db import' } });
const sourceMembersByGroup = new Map(projectGroups.map(group => [group.key, sourceMemberRolesForGroup(group)]));
const projectDocs = projectGroups.filter(group => !existingProjectByGroup.has(group.key)).map(group => {
  const membershipRoles = sourceMembersByGroup.get(group.key)!;
  const members = Object.fromEntries(membershipRoles.map(member => [memberKey(member.email), member.role === 'owner' ? 'administrador' : 'colaborador']));
  const memberDirectory = membershipRoles.map(member => `${member.name} (${member.alias}) <${member.email}> — ${member.role}`).join('\n');
  const description = [`Grupo Git: ${group.repositories.map(repository => repository.name).join(', ')}`,
    ...group.sourceProjects.map(project => project.slug === 'avb-one' ? project.description : undefined),
    memberDirectory ? `Participantes herdados das Features de origem:\n${memberDirectory}` : ''].filter(Boolean).join('\n\n');
  const sourceDates = group.sourceProjects.flatMap(project => [date(project.created_at), date(project.updated_at)]).filter(Boolean) as Date[];
  return { _id: projectIds.get(group.key)!, version: 0, archived: false, eventSequence: 0, fence: 0, name: group.name,
    description, instructions: 'Project importado do sync.db a partir dos repositórios Git associados.', visibility: 'public', members,
    repositories: group.repositories.map(repositoryDoc),
    createdAt: sourceDates.sort((a, b) => a.getTime() - b.getTime())[0] ?? date(group.repositories[0].created_at),
    updatedAt: sourceDates.sort((a, b) => b.getTime() - a.getTime())[0] ?? date(group.repositories[0].created_at), _migrationSource: `sync.db:${fingerprint}` };
});
const existingProjectUpdates = projectGroups.flatMap(group => {
  const match = existingProjectByGroup.get(group.key);
  if (!match) return [];
  const existingMembers = match.members instanceof Map ? Object.fromEntries(match.members) : (match.members ?? {});
  const additions: Record<string, string> = {};
  for (const member of sourceMembersByGroup.get(group.key)!) {
    const targetKey = memberKey(member.email);
    if (!Object.hasOwn(existingMembers, targetKey)) additions[`members.${targetKey}`] = member.role === 'owner' ? 'administrador' : 'colaborador';
  }
  const repositories = group.repositories.filter(sourceRepository =>
    !(match.repositories ?? []).some((targetRepository: Row) => matchesTargetRepository(targetRepository, sourceRepository))).map(repositoryDoc);
  return Object.keys(additions).length || repositories.length ? [{ projectId: match._id, additions, repositories }] : [];
});

const featureDocs = projects.filter(project => project.slug !== 'avb-one').map(project => ({
  _id: featureIdFor(project.id), projectId: projectIds.get(groupBySourceProjectId.get(project.id)!.key)!,
  version: 0, archived: project.status === 'arquivado', name: project.name,
  objective: project.description || project.name,
  context: [`Slug SQLite: ${project.slug}`, `Status SQLite: ${project.status}`, `Visibilidade SQLite: ${project.visibility}`,
    `Repositórios associados: ${project.repositories.map(repository => `${repository.name} (${repository.remote})`).join(', ')}`,
    project.members.length ? `Participantes:\n${project.members.map(member => `${member.name} (${member.alias}) <${member.email}> — ${member.role}`).join('\n')}` : ''].filter(Boolean).join('\n\n'),
  acceptance: [], createdAt: date(project.created_at), updatedAt: date(project.updated_at), _migrationSource: `sync.db:${fingerprint}`
}));

const taskDocs = tasks.map(task => {
  const project = projectById.get(task.project_id)!;
  const repository = chooseRepository(task, project);
  const repositoryKey = gitRepositoryKey(repository);
  const tags: string[] = JSON.parse(task.tags || '[]');
  const instructions = [`Código de origem: ${task.code}`, tags.length ? `Tags de origem: ${tags.join(', ')}` : ''].filter(Boolean).join('\n');
  const area = tags.includes('backend') ? 'backend' : tags.includes('frontend') ? 'frontend' : 'outro';
  const type = tags.includes('bug') ? 'fix' : tags.includes('testes') || tags.includes('teste') ? 'test' : tags.includes('documentacao') ? 'docs' : 'feature';
  const owner = task.owner_id == null ? undefined : people.get(task.owner_id);
  const body = task.events.filter(event => event.kind === 'body.updated').at(-1)?.texto;
  return { _id: taskIds.get(task.id)!, version: 0, archived: false, projectId: projectIds.get(groupBySourceProjectId.get(project.id)!.key)!,
    ...(project.slug === 'avb-one' ? {} : { featureId: featureIdFor(project.id) }), name: sourceTitle(task), instructions,
    acceptance: [], priority: 3, area, type, repositoryId: repositoryIds.get(repositoryKey)!,
    dependencies: task.dependencies.map(id => taskIds.get(id)!), status: statusMap[task.status] ?? 'pendente',
    responsible: owner?.email, legacyBody: body,
    createdAt: date(task.created_at), updatedAt: date(task.updated_at), _migrationSource: `sync.db:${fingerprint}` };
});

const bodyEvents = allEvents.filter(event => event.kind === 'body.updated' && event.texto != null && taskIds.has(event.task_id));
const bodiesByTask = new Map<number, Row[]>();
for (const event of bodyEvents) bodiesByTask.set(event.task_id, [...(bodiesByTask.get(event.task_id) ?? []), event]);
const markdownDocuments: Row[] = [];
const markdownRevisions: Row[] = [];
for (const [taskId, events] of bodiesByTask) {
  const sourceTask = tasks.find(task => task.id === taskId)!;
  const targetTaskId = taskIds.get(taskId)!;
  const projectId = taskTargetProjectIds.get(sourceTask.id)!;
  const documentId = uuid(`${fingerprint}:markdown:${taskId}:descricao-legada`);
  const documentName = 'Descrição legada';
  const latestContent = String(events.at(-1)!.texto);
  markdownDocuments.push({ _id: documentId, version: 0, archived: false, projectId, targetKind: 'task', targetId: targetTaskId, name: documentName,
    summary: 'Descrição e versões importadas do sync.db', revision: events.length, author: people.get(events.at(-1)!.author_id)?.email ?? 'sync.db import',
    size: Buffer.byteLength(latestContent), sha256: createHash('sha256').update(latestContent).digest('hex'), createdAt: date(events[0].created_at), updatedAt: date(events.at(-1)!.created_at), _migrationSource: `sync.db:${fingerprint}` });
  events.forEach((event, index) => {
    const content = String(event.texto);
    const author = people.get(event.author_id);
    markdownRevisions.push({ _id: uuid(`${fingerprint}:markdown-revision:${event.seq}`), projectId, documentId, revision: index + 1,
      summary: `Versão importada ${event.version ?? index + 1}`, content, author: author?.email ?? 'sync.db import', size: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'), createdAt: date(event.created_at), _migrationSource: `sync.db:${fingerprint}` });
  });
}
for (const task of taskDocs) delete task.legacyBody;

const taskBySourceId = new Map(tasks.map(task => [task.id, task]));
const eventDocs = allEvents.map(event => {
  const task = event.task_id == null ? undefined : taskBySourceId.get(event.task_id);
  const targetProjectId = task ? taskTargetProjectIds.get(task.id)! : undefined;
  const person = people.get(event.author_id);
  const action = `legacy_${String(event.kind).replaceAll('.', '_')}`;
  return { _id: uuid(`${fingerprint}:event:${event.seq}`), projectId: targetProjectId!, entityId: task ? taskIds.get(task.id)! : targetProjectId!,
    action, kind: event.kind, summary: summaryText(event, task), author: person?.email ?? 'sync.db import',
    actor: { id: person?.email ?? 'sync.db import', userId: person?.email ?? 'sync.db import', displayName: person?.name, alias: person?.alias, scope: 'legacy_import', systemAdmin: false },
    at: date(event.created_at), git: { agent: event.agent, branch: event.branch, commit: event.commit_sha, baseCommit: event.base_sha, files: event.arquivos ? JSON.parse(event.arquivos) : [] },
    data: { source: 'sync.db', sourceEventId: event.seq, featureSlug: projectById.get(event.project_id)?.slug, taskCode: task?.code,
      type: event.type, text: event.texto, field: event.campo, previousValue: event.valor_de, nextValue: event.valor_para, version: event.version },
    _migrationSource: `sync.db:${fingerprint}` };
});

const messageTypeMap: Record<string, string> = { pergunta: 'pergunta', resposta: 'resposta', bloqueio: 'bloqueio', decisao: 'contrato', mudanca: 'progresso' };
const messageDocs = allEvents.filter(event => event.kind === 'message.created' && event.task_id != null && taskIds.has(event.task_id)).map(event => {
  const task = taskBySourceId.get(event.task_id)!;
  const person = people.get(event.author_id);
  const originalType = event.type ?? 'outro';
  const prefix = Object.hasOwn(messageTypeMap, originalType) ? '' : `[${originalType}] `;
  return { _id: uuid(`${fingerprint}:message:${event.seq}`), projectId: taskTargetProjectIds.get(task.id)!, taskId: taskIds.get(task.id)!,
    author: person?.email ?? 'sync.db import', type: messageTypeMap[originalType] ?? 'progresso', message: `${prefix}${event.texto ?? ''}`,
    references: event.arquivos ? JSON.parse(event.arquivos) : [], createdAt: date(event.created_at), _migrationSource: `sync.db:${fingerprint}` };
});
const operationDocs = operations.map(operation => {
  let originalResult: unknown = operation.result;
  try { originalResult = JSON.parse(operation.result); } catch { /* Preserve legacy text as-is. */ }
  return { _id: `sync.db:${fingerprint}:operation:${operation.id}`, fingerprint: `sync.db:${fingerprint}`,
    result: { sourceStatus: operation.status, originalResult, sourceCreatedAt: operation.created_at } };
});

const counts = { existingProjectsReused: existingProjectByGroup.size, projectsToCreate: projectDocs.length, features: featureDocs.length, tasks: taskDocs.length,
  dependencies: taskDocs.reduce((sum, task) => sum + task.dependencies.length, 0), sourcePeople: people.size,
  sourceMemberships: projects.reduce((sum, project) => sum + project.members.length, 0),
  newProjectMemberships: projectDocs.reduce((sum, project) => sum + Object.keys(project.members).length, 0), existingProjectMembershipsToAdd: existingProjectUpdates.reduce((sum, update) => sum + Object.keys(update.additions).length, 0),
  events: eventDocs.length, messages: messageDocs.length, operations: operationDocs.length,
  markdownDocuments: markdownDocuments.length, markdownRevisions: markdownRevisions.length };
const tasksBySourceProjectAndRepository = Object.fromEntries(projects.map(project => [project.slug,
  Object.fromEntries(project.repositories.map(repository => [repository.name,
    taskDocs.filter(task => task.projectId === projectIds.get(groupBySourceProjectId.get(project.id)!.key) &&
      (project.slug === 'avb-one' ? task.featureId == null : task.featureId === featureIdFor(project.id)) &&
      task.repositoryId === repositoryIds.get(gitRepositoryKey(repository))).length]))]));
const membershipScopeExpansion = projectGroups.flatMap(group => {
  const union = new Set(group.sourceProjects.flatMap(project => project.members.map(member => member.email.toLowerCase())));
  return group.sourceProjects.flatMap(project => {
    const sourceMembers = new Set(project.members.map(member => member.email.toLowerCase()));
    const additionalMembers = [...union].filter(email => !sourceMembers.has(email)).length;
    return additionalMembers ? [{ project: group.name, sourceFeature: project.slug, additionalMembers }] : [];
  });
});
const existingProjectMatches = [...existingProjectByGroup].map(([groupKey, match]) => ({ targetProject: projectGroups.find(group => group.key === groupKey)!.name,
  projectId: match._id, projectName: match.name, archived: !!match.archived }));
console.log(JSON.stringify({ mode: applying ? 'apply' : 'preview', source: sourceFile, fingerprint, counts,
  databaseLookupPerformed, projectGroups: projectGroups.map(group => ({ name: group.name, repositories: group.repositories.map(repository => repository.name),
    features: group.sourceProjects.filter(project => project.slug !== 'avb-one').map(project => project.slug), sourceProjectsAsProject: group.sourceProjects.filter(project => project.slug === 'avb-one').map(project => project.slug) })),
  existingProjectMatches, notMigrated, repositoryDefaults: Object.fromEntries(repositoryDefaults), tasksBySourceProjectAndRepository, membershipScopeExpansion,
  visibilityMapping: 'SQLite team projects map to public Projects; memberships merge at Project scope.' }, null, 2));

if (!applying) {
  console.log('\nPrévia apenas: nenhuma gravação feita. Use --apply para importar.');
  process.exit(0);
}

await mongoose.connect(mongoUri!);
const session = await mongoose.startSession();
const upsertOps = (documents: Row[]) => documents.map(document => ({ updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } }));
try {
  await session.withTransaction(async () => {
    for (const [model, documents] of [
      [Project, projectDocs], [Feature, featureDocs], [Task, taskDocs], [Event, eventDocs], [TaskMessage, messageDocs], [Operation, operationDocs],
      [MarkdownDocument, markdownDocuments], [MarkdownRevision, markdownRevisions]
    ] as const) {
      if (documents.length) await model.collection.bulkWrite(upsertOps(documents), { session, ordered: true });
    }
    for (const update of existingProjectUpdates) {
      const mutation: Row = {};
      if (Object.keys(update.additions).length) mutation.$set = update.additions;
      if (update.repositories.length) mutation.$push = { repositories: { $each: update.repositories } };
      await Project.collection.updateOne({ _id: update.projectId }, mutation, { session });
    }
  });
} finally {
  await session.endSession();
  await mongoose.disconnect();
}
console.log('Migração concluída. Os documentos usam IDs determinísticos e reexecução é segura para esta cópia de origem.');
