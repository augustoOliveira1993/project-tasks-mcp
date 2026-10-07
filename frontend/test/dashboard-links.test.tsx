import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const links = await vite.ssrLoadModule('/src/features/dashboard/dashboard-links.ts');
const filters = await vite.ssrLoadModule('/src/features/tasks/task-filters.ts');
const { TasksLink } = await vite.ssrLoadModule('/src/components/ui/Links.tsx');
after(async () => { await vite.close(); });

const projectId = '4892c316-ef90-4d5e-bf4a-005432656470';
const baseFilters = { search: '', status: 'todos', area: 'todos', type: 'todos', priority: '', responsible: '', featureId: '', createdAfter: '', createdBefore: '', updatedAfter: '', updatedBefore: '' };
const task = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, name: id, status: 'pendente', ...extra });

test('período vira filtro "criada desde" e "todo o período" não filtra', () => {
  assert.deepEqual(links.periodFilters('2026-09-08T03:00:00.000Z'), { createdAfter: '2026-09-08' });
  assert.deepEqual(links.periodFilters(undefined), {});
});

test('mês vira faixa de criação limitada ao início do período', () => {
  assert.deepEqual(links.monthFilters('2026-02'), { createdAfter: '2026-02-01', createdBefore: '2026-02-28' });
  assert.deepEqual(links.monthFilters('2026-09', '2026-09-08T03:00:00.000Z'), { createdAfter: '2026-09-08', createdBefore: '2026-09-30' });
  assert.deepEqual(links.monthFilters('2026-09', '2026-01-01T03:00:00.000Z'), { createdAfter: '2026-09-01', createdBefore: '2026-09-30' });
  assert.deepEqual(links.monthFilters('invalido', '2026-01-01T03:00:00.000Z'), { createdAfter: '2026-01-01' });
});

test('chaves vazias de responsável e área usam os valores especiais de filtro', () => {
  assert.equal(links.responsibleFilterValue(''), filters.noResponsibleFilter);
  assert.equal(links.responsibleFilterValue('ana@x.com'), 'ana@x.com');
  assert.equal(links.areaFilterValue(''), filters.noAreaFilter);
  assert.equal(links.areaFilterValue('backend'), 'backend');
});

test('a lista de tarefas entende "sem responsável" e "sem área"', () => {
  const tasks = [task('a', { responsible: 'ana@x.com', area: 'backend' }), task('b', { responsible: '  ' }), task('c', { responsible: null, area: 'frontend' }), task('d')];
  const ids = (state: Record<string, string>) => filters.filterTasks(tasks, { ...baseFilters, ...state }).map((item: { _id: string }) => item._id);
  assert.deepEqual(ids({ responsible: filters.noResponsibleFilter }), ['b', 'c', 'd']);
  assert.deepEqual(ids({ responsible: 'ana' }), ['a']);
  assert.deepEqual(ids({ area: filters.noAreaFilter }), ['b', 'd']);
  assert.deepEqual(ids({ area: 'backend' }), ['a']);
});

test('TasksLink gera um href real com projeto e filtros (e ignora filtros vazios)', () => {
  const html = renderToStaticMarkup(createElement(TasksLink, { projectId, filters: { status: 'em_execucao', createdAfter: '2026-09-08', area: '' } }, 'Em execução'));
  assert.match(html, /href="\/tasks\?status=em_execucao&amp;createdAfter=2026-09-08&amp;projectId=4892c316-ef90-4d5e-bf4a-005432656470"/);
  assert.match(html, />Em execução</);
  assert.doesNotMatch(html, /area=/);
});
