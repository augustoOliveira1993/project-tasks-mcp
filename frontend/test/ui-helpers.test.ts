import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const labels = await vite.ssrLoadModule('/src/lib/labels.ts');
const activity = await vite.ssrLoadModule('/src/lib/activity.ts');
const views = await vite.ssrLoadModule('/src/features/tasks/task-views.ts');
const sort = await vite.ssrLoadModule('/src/features/tasks/task-sort.ts');
const params = await vite.ssrLoadModule('/src/features/tasks/task-query-params.ts');
const links = await vite.ssrLoadModule('/src/components/ui/Links.tsx');
after(async () => { await vite.close(); });

const ids = (items: Array<{ _id: string }>) => items.map(item => item._id);

test('rótulos pt-BR, prioridade e plural', () => {
  assert.equal(labels.typeLabel('fix'), 'Correção');
  assert.equal(labels.areaLabel('backend'), 'Backend');
  assert.equal(labels.priorityInfo(1).text, 'P1 · Alta');
  assert.equal(labels.priorityInfo(undefined).text, 'Sem prioridade');
  assert.equal(labels.plural(1, 'pergunta', 'perguntas'), '1 pergunta');
  assert.equal(labels.plural(3, 'pergunta', 'perguntas'), '3 perguntas');
  assert.equal(labels.personName('maria.silva@empresa.com'), 'Maria');
  assert.equal(labels.personInitials('maria.silva@empresa.com'), 'MS');
});

test('tempo relativo e duração separam "há quanto tempo" de "quanto durou"', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  assert.equal(labels.relativeTime('2026-10-06T11:59:50Z', now), 'agora');
  assert.equal(labels.relativeTime('2026-10-06T11:30:00Z', now), 'há 30 min');
  assert.equal(labels.relativeTime('2026-10-06T07:00:00Z', now), 'há 5 h');
  assert.equal(labels.relativeTime('2026-10-04T12:00:00Z', now), 'há 2 d');
  assert.equal(labels.formatDuration(7 * 86400e3 + 21 * 3600e3), '7 d 21 h');
});

test('prévia em texto simples remove marcações de Markdown', () => {
  assert.equal(labels.plainText('Front `avb_one_front` e **back**\n\n- item um'), 'Front avb_one_front e back item um');
  assert.ok(labels.plainText('a'.repeat(300)).length <= 120);
});

test('atividade: rótulos em pt-BR e ruído técnico separado', () => {
  assert.equal(activity.eventKindLabel('task.acceptance.progressed'), 'Critério de aceite atualizado');
  assert.equal(activity.eventKindLabel('project.heartbeat_task'), 'Heartbeat da execução');
  assert.equal(activity.eventKindLabel('project.grant_credential_project'), 'Acesso ao projeto concedido');
  assert.equal(activity.eventSummary({ kind: 'project.heartbeat_task', summary: 'heartbeat_task' }), 'Heartbeat da execução');
  assert.equal(activity.eventSummary({ kind: 'mcp.tool.called', toolName: 'list_records', summary: 'Chamada MCP: list_records' }), 'Listou registros');
  assert.equal(activity.isTechnicalEvent({ kind: 'mcp.tool.called', toolName: 'list_records' }), true);
  assert.equal(activity.isTechnicalEvent({ kind: 'project.heartbeat_task' }), true);
  assert.equal(activity.isTechnicalEvent({ kind: 'mcp.tool.called', toolName: 'claim_task' }), false);
  assert.equal(activity.isTechnicalEvent({ kind: 'task.submitted' }), false);
  assert.equal(activity.originLabel('codex-mcp-client'), 'Codex');
  assert.equal(activity.originLabel('claude-code'), 'Claude Code');
  assert.equal(activity.originLabel('painel administrativo'), 'Painel administrativo');
});

test('ordenação da fila e parâmetros de URL com flag e sort', () => {
  const tasks = [
    { _id: 'a', name: 'B', status: 'concluida', priority: 1, updatedAt: '2026-01-01' },
    { _id: 'b', name: 'A', status: 'em_revisao', priority: 3, updatedAt: '2026-02-01' },
    { _id: 'c', name: 'C', status: 'pendente', priority: 2, updatedAt: '2026-03-01' }
  ];
  assert.deepEqual(ids(sort.sortTasks(tasks, 'priority')), ['a', 'c', 'b']);
  assert.deepEqual(ids(sort.sortTasks(tasks, 'updated')), ['c', 'b', 'a']);
  assert.deepEqual(ids(sort.sortTasks(tasks, 'name')), ['b', 'a', 'c']);
  assert.deepEqual(ids(sort.sortTasks(tasks, 'status')), ['b', 'c', 'a']);
  const state = params.readTaskQueryState('?flag=questions&sort=updated&status=em_revisao');
  assert.equal(state.flag, 'questions');
  assert.equal(state.sort, 'updated');
  assert.equal(params.readTaskQueryState('?flag=x&sort=y').flag, '');
  assert.equal(params.readTaskQueryState('').sort, 'priority');
});

test('visões: padrão, ativação e instantâneo', () => {
  const base = params.readTaskQueryState('');
  assert.equal(views.matchesView(base, views.builtInViews[0]), true);
  const review = { ...base, status: 'em_revisao', sort: 'updated' };
  assert.equal(views.matchesView(review, views.builtInViews[1]), true);
  assert.equal(views.matchesView(review, views.builtInViews[0]), false);
  assert.equal(views.matchesView({ ...base, responsible: 'a@b.com' }, views.mineView('a@b.com')), true);
  const saved = views.snapshotView(' Minha visão ', { ...base, area: 'backend' });
  assert.equal(saved.label, 'Minha visão');
  assert.equal(views.viewPatch(saved).area, 'backend');
  assert.equal(views.viewPatch(saved).status, 'todos');
});

test('links de encadeamento apontam para tarefa, conversa e feature do projeto', () => {
  assert.equal(links.taskHref('p1', 't1'), '/tasks?taskId=t1&projectId=p1');
  assert.equal(links.conversationHref('p1', 'c1'), '/conversations?conversationId=c1&projectId=p1');
  assert.equal(links.featureHref('p1', 'f1'), '/tasks?featureId=f1&projectId=p1');
  assert.equal(links.filterHref('p1', 'area', 'backend'), '/tasks?area=backend&projectId=p1');
  assert.equal(links.filterHref('p1', 'type', 'fix'), '/tasks?type=fix&projectId=p1');
});
