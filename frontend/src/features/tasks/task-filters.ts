import type { Task } from '../../api';
import { statusLabels } from './status';
import type { TaskQueryState } from './task-query-params';

export type TaskFilters = Pick<
  TaskQueryState,
  'search' | 'status' | 'area' | 'type' | 'priority' | 'responsible' | 'featureId' |
  'createdAfter' | 'createdBefore' | 'updatedAfter' | 'updatedBefore'
>;

export type TaskFacetOption = { value: string; count: number };
export type TaskFilterOptions = {
  status: TaskFacetOption[];
  area: TaskFacetOption[];
  type: TaskFacetOption[];
  priority: TaskFacetOption[];
};

type FilterKey = keyof TaskFilters;

export function filterTasks(tasks: Task[], filters: TaskFilters, excluded?: FilterKey): Task[] {
  const search = filters.search.toLocaleLowerCase('pt-BR');
  return tasks.filter(task => {
    const haystack = [task.name, task._id, task.responsible, task.featureId, task.description]
      .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    return (excluded === 'search' || !filters.search || haystack.includes(search))
      && (excluded === 'status' || filters.status === 'todos' || task.status === filters.status)
      && (excluded === 'area' || filters.area === 'todos' || task.area === filters.area)
      && (excluded === 'type' || filters.type === 'todos' || task.type === filters.type)
      && (excluded === 'priority' || !filters.priority || String(task.priority ?? '') === filters.priority)
      && (excluded === 'responsible' || !filters.responsible || (task.responsible ?? '').toLocaleLowerCase('pt-BR').includes(filters.responsible.toLocaleLowerCase('pt-BR')))
      && (excluded === 'featureId' || !filters.featureId || (task.featureId ?? '').toLocaleLowerCase('pt-BR').includes(filters.featureId.toLocaleLowerCase('pt-BR')))
      && (excluded === 'createdAfter' || !filters.createdAfter || String(task.createdAt ?? '').slice(0, 10) >= filters.createdAfter)
      && (excluded === 'createdBefore' || !filters.createdBefore || String(task.createdAt ?? '').slice(0, 10) <= filters.createdBefore)
      && (excluded === 'updatedAfter' || !filters.updatedAfter || String(task.updatedAt ?? '').slice(0, 10) >= filters.updatedAfter)
      && (excluded === 'updatedBefore' || !filters.updatedBefore || String(task.updatedAt ?? '').slice(0, 10) <= filters.updatedBefore);
  });
}

function collectOptions(tasks: Task[], getValue: (task: Task) => string | undefined, preferredOrder: string[] = [], numeric = false): TaskFacetOption[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const value = getValue(task);
    if (value !== undefined && value !== '') counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const preferredRank = new Map(preferredOrder.map((value, index) => [value, index]));
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => {
    if (numeric) return Number(a.value) - Number(b.value);
    const aRank = preferredRank.get(a.value);
    const bRank = preferredRank.get(b.value);
    if (aRank !== undefined || bRank !== undefined) return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
    return a.value.localeCompare(b.value, 'pt-BR', { sensitivity: 'base' });
  });
}

export function getTaskFilterOptions(tasks: Task[], filters: TaskFilters): TaskFilterOptions {
  return {
    status: collectOptions(filterTasks(tasks, filters, 'status'), task => task.status, Object.keys(statusLabels)),
    area: collectOptions(filterTasks(tasks, filters, 'area'), task => task.area, ['backend', 'frontend', 'outro']),
    type: collectOptions(filterTasks(tasks, filters, 'type'), task => task.type),
    priority: collectOptions(filterTasks(tasks, filters, 'priority'), task => task.priority == null ? undefined : String(task.priority), [], true)
  };
}

export function taskFilterOptionLabel(value: string, count: number): string {
  const label = statusLabels[value] ?? (value === 'backend' ? 'Backend' : value === 'frontend' ? 'Frontend' : value === 'outro' ? 'Outro' : value);
  return `${label} (${count})`;
}
