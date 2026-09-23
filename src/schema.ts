import { z } from 'zod';
export const id = z.string().uuid();
export const userId = z.string().min(1).max(320).refine(value => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'Invalid user ID or email').refine(value => !['prototype', 'constructor'].includes(value));
const text = z.string().min(1).max(20000);
const markdown = z.string().max(100 * 1024).refine(value => Buffer.byteLength(value, 'utf8') <= 100 * 1024, 'Markdown exceeds 100 KiB');
const markdownSummary = z.string().max(500);
export const states = ['pendente', 'em_execucao', 'bloqueada', 'em_revisao', 'concluida', 'cancelada'] as const;
export const kind = z.enum(['project', 'feature', 'task']);
export const taskType = z.enum(['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert']);
const gitBinding = z.object({ canonicalRemoteUrl: z.string().min(1).max(2048), rootCommit: z.string().regex(/^[0-9a-f]{40}$/i), boundAt: z.string().datetime().optional(), boundBy: text.optional() }).strict();
export const repository = z.object({ id, name: text, url: z.string().url(), instructions: z.string().max(20000), git: gitBinding.optional() }).strict();
export const projectData = z.object({ name: text, description: text, instructions: text, repositories: z.array(repository).min(1).max(100), visibility: z.enum(['public', 'private']).default('public'), accessToken: z.string().min(16).max(512).optional() }).strict().refine(data => data.visibility !== 'private' || !!data.accessToken, 'Private project requires an access token');
export const featureData = z.object({ name: text, objective: text, context: text, acceptance: z.array(text).min(1).max(100) }).strict();
export const taskData = z.object({
  name: text, instructions: text, acceptance: z.array(text).min(1).max(100), priority: z.number().int().min(0).max(5),
  area: z.enum(['backend', 'frontend', 'outro']), repositoryId: id, featureId: id.nullish(), type: taskType.default('feature'), dependencies: z.array(id).max(100), responsible: text.optional()
}).strict();
const op = { operationId: id };
const target = { projectId: id, taskId: id, executionId: id, version: z.number().int().nonnegative(), ...op };
const messageType = z.enum(['pergunta', 'resposta', 'bloqueio', 'contrato', 'progresso']);
const messageThread = { conversationId: id.optional(), replyTo: id.optional(), correlationId: id.optional() };
const eventFilter = { projectId: id, taskIds: z.array(id).max(100).default([]), actions: z.array(z.string().min(1).max(100)).max(50).default([]) };
const cursor = z.string().min(1).max(2048);
export const provider = z.enum(['codex', 'claude']);
export const tools = {
  get_session_context: z.object({}).strict(),
  create_project: z.object({ ...op, data: projectData }).strict(),
  create_feature: z.object({ ...op, projectId: id, data: featureData }).strict(),
  create_task: z.object({ ...op, projectId: id, data: taskData }).strict(),
  edit_record: z.object({ ...op, projectId: id, kind, id, version: z.number().int().nonnegative(), data: z.record(z.string(), z.unknown()) }).strict(),
  archive_record: z.object({ ...op, projectId: id, kind, id, version: z.number().int().nonnegative() }).strict(),
  list_records: z.object({ projectId: id.optional(), kind, featureId: id.optional(), withoutFeature: z.boolean().default(false), type: taskType.optional(), area: z.enum(['backend', 'frontend', 'outro']).optional(), responsible: text.optional(), status: z.enum(states).optional(), archived: z.boolean().default(false), after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  list_pending: z.object({ projectId: id, featureId: id.optional(), withoutFeature: z.boolean().default(false), type: taskType.optional(), area: z.enum(['backend', 'frontend', 'outro']).optional(), responsible: text.optional(), after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  get_record: z.object({ projectId: id, kind, id }).strict(),
  list_executions: z.object({ projectId: id, taskId: id, after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  get_task_context: z.object({ projectId: id, taskId: id }).strict(),
  get_task_markdown_summary: z.object({ projectId: id, taskId: id }).strict(),
  get_history: z.object({ projectId: id, entityId: id.optional(), after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  get_summary: z.object({ projectId: id, featureId: id.optional() }).strict(),
  get_project_area_summary: z.object({ projectId: id, featureId: id.optional() }).strict(),
  get_project_novelties: z.object({ projectId: id, after: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  mark_project_read: z.object({ ...op, projectId: id, cursor: z.number().int().nonnegative() }).strict(),
  save_markdown: z.object({ ...op, projectId: id, targetKind: z.enum(['feature', 'task']), targetId: id, id: id.optional(), version: z.number().int().nonnegative().optional(), name: z.string().min(1).max(255).regex(/\.md$/i, 'Name must end in .md'), summary: markdownSummary, content: markdown }).strict(),
  list_markdowns: z.object({ projectId: id, targetKind: z.enum(['feature', 'task']), targetId: id, after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  get_markdown: z.object({ projectId: id, id, revision: z.number().int().positive().optional(), line: z.number().int().positive().default(1), limit: z.number().int().min(1).max(200).default(200) }).strict(),
  list_markdown_revisions: z.object({ projectId: id, id, after: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  list_task_diffs: z.object({ projectId: id, taskId: id, after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  get_task_diff: z.object({ projectId: id, taskId: id, id }).strict(),
  send_task_message: z.object({ ...target, ...messageThread, relatedTaskId: id.optional(), type: messageType, message: text, references: z.array(text).max(100).default([]) }).strict(),
  send_collaboration_message: z.object({ ...op, projectId: id, taskId: id, relatedTaskId: id.optional(), ...messageThread, type: messageType, message: text, references: z.array(text).max(100).default([]) }).strict(),
  get_automation_status: z.object({ projectId: id, after: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  subscribe_project_events: z.object({ ...eventFilter, cursor: cursor.optional() }).strict(),
  unsubscribe_project_events: z.object(eventFilter).strict(),
  wait_project_events: z.object({ ...eventFilter, cursor: cursor.optional(), timeoutMs: z.number().int().min(0).max(30000).default(25000), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  list_task_messages: z.object({ projectId: id, taskId: id, after: id.optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  wait_task_events: z.object({ projectId: id, taskId: id, after: id.optional(), eventAfter: cursor.optional(), timeoutMs: z.number().int().min(0).max(30000).default(25000), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  subscribe_task_events: z.object({ projectId: id, taskId: id }).strict(),
  claim_task: z.object({ ...op, projectId: id, taskId: id, version: z.number().int().nonnegative(), agent: text }).strict(),
  heartbeat_task: z.object(target).strict(),
  record_progress: z.object({ ...target, message: text }).strict(),
  block_task: z.object({ ...target, reason: text }).strict(),
  submit_task: z.object({ ...target, result: z.object({ summary: text, changedFiles: z.array(text).max(1000), checksRun: z.array(text).max(100), checksOmitted: z.array(text).max(100), evidence: z.array(text).max(100), branch: text.optional(), commit: text.optional(), pr: z.string().url().optional(), diffIds: z.array(id).max(100).optional() }).strict() }).strict(),
  update_markdown: z.object({ ...op, projectId: id, documentId: id, baseRevision: z.number().int().positive(), summary: markdownSummary, content: markdown }).strict(),
  record_task_diff: z.object({ ...op, projectId: id, taskId: id, repositoryId: id, baseCommit: z.string().regex(/^[0-9a-f]{40}$/i), commit: z.string().regex(/^[0-9a-f]{40}$/i), branch: z.string().min(1).max(1024), files: z.array(z.string().min(1).max(4096)).max(10000), patch: z.string().max(100 * 1024).optional(), patchSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(), truncated: z.boolean().default(false), agent: z.string().min(1).max(100).optional() }).strict()
};
export const adminSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('automation_policy'), ...op, projectId: id, version: z.number().int().nonnegative(), enabled: z.boolean(), maxConcurrent: z.number().int().min(1).max(50).default(10), routes: z.array(z.object({ repositoryId: id, area: z.enum(['backend', 'frontend', 'outro']), provider }).strict()).max(100) }).strict(),
  z.object({ action: z.literal('automation_release'), ...op, projectId: id, taskId: id, version: z.number().int().nonnegative(), provider: provider.optional() }).strict(),
  z.object({ action: z.literal('automation_resolve'), ...op, projectId: id, jobId: id, version: z.number().int().nonnegative(), decision: z.enum(['allow', 'deny']), reason: text }).strict(),
  z.object({ action: z.literal('review'), ...op, projectId: id, taskId: id, version: z.number().int().nonnegative(), decision: z.enum(['approve', 'changes', 'unblock', 'cancel']), reason: text }).strict(),
  z.object({ action: z.literal('member'), ...op, projectId: id, version: z.number().int().nonnegative(), userId, role: z.enum(['administrador', 'colaborador', 'leitor']).nullable() }).strict(),
  z.object({ action: z.literal('bind_repository_git'), ...op, projectId: id, version: z.number().int().nonnegative(), repositoryId: id, canonicalRemoteUrl: z.string().min(1).max(2048), rootCommit: z.string().regex(/^[0-9a-f]{40}$/i) }).strict(),
  z.object({ action: z.literal('issue'), ...op, userId, scope: z.enum(['agent', 'human']), systemAdmin: z.boolean().default(false), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('revoke'), ...op, credentialId: id }).strict()
]);
export const approveTasksSchema = z.object({
  projectId: id,
  taskIds: z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Task IDs must be unique'),
  reason: text.default('Aprovado manualmente em lote')
}).strict();
export const changeTaskStatusSchema = z.object({
  projectId: id,
  taskId: id,
  status: z.enum(['pendente', 'em_revisao', 'concluida', 'cancelada']),
  reason: text
}).strict();
