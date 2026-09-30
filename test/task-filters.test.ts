import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '../frontend/src/api.ts';
import { filterTasks, getTaskFilterOptions, type TaskFilters } from '../frontend/src/features/tasks/task-filters.ts';

const tasks: Task[] = [
  { _id: 'a', version: 1, name: 'Importar produção', description: 'Lote inicial', status: 'pendente', area: 'backend', type: 'fix', priority: 1, responsible: 'ana@example.com', featureId: 'f1', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-02T10:00:00Z' },
  { _id: 'b', version: 1, name: 'Importar tarefas', description: 'Painel', status: 'em_revisao', area: 'frontend', type: 'feature', priority: 2, responsible: 'bia@example.com', featureId: 'f2', createdAt: '2026-09-05T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z' },
  { _id: 'c', version: 1, name: 'Ajustar importação', description: 'API', status: 'pendente', area: 'frontend', type: 'fix', priority: 2, responsible: 'bia@example.com', featureId: 'f1', createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z' },
  { _id: 'd', version: 1, name: 'Revisar relatórios', description: 'Admin', status: 'concluida', area: 'backend', type: 'chore', priority: 3, responsible: 'caio@example.com', featureId: 'f3', createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-09-13T10:00:00Z' }
];

function filters(overrides: Partial<TaskFilters> = {}): TaskFilters {
  return {
    search: '', status: 'todos', area: 'todos', type: 'todos', priority: '', responsible: '', featureId: '',
    createdAfter: '', createdBefore: '', updatedAfter: '', updatedBefore: '', ...overrides
  };
}

test('combines text, facets, responsibility, feature, and creation/update ranges', () => {
  const result = filterTasks(tasks, filters({
    search: 'import', status: 'pendente', area: 'frontend', type: 'fix', priority: '2',
    responsible: 'BIA@EXAMPLE.COM', featureId: 'F1', createdAfter: '2026-09-10', createdBefore: '2026-09-10',
    updatedAfter: '2026-09-11', updatedBefore: '2026-09-11'
  }));
  assert.deepEqual(result.map(task => task._id), ['c']);
});

test('returns only extant facet values after applying every other filter', () => {
  const options = getTaskFilterOptions(tasks, filters({ area: 'frontend', priority: '2', createdAfter: '2026-09-05' }));
  assert.deepEqual(options.area.map(option => option.value), ['frontend']);
  assert.deepEqual(options.status.map(option => option.value), ['pendente', 'em_revisao']);
  assert.deepEqual(options.type.map(option => option.value), ['feature', 'fix']);
  assert.deepEqual(options.priority.map(option => option.value), ['2']);
  assert.deepEqual(options.type.map(option => option.count), [1, 1]);
});
