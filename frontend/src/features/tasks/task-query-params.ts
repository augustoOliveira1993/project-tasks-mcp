import { statusLabels } from './status';
import { decodeFilterExpression, encodeFilterExpression, emptyFilterGroup, type FilterGroup } from './advanced-filter';

export const taskTypes = ['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'] as const;

const pageSizes = [10, 25, 50, 100] as const;
export const taskFlags = ['unread', 'questions', 'diff'] as const;
export const taskSorts = ['priority', 'updated', 'created', 'name', 'status'] as const;

export type TaskQueryState = {
  expression: FilterGroup;
  search: string;
  status: string;
  area: string;
  type: string;
  priority: string;
  responsible: string;
  featureId: string;
  createdAfter: string;
  createdBefore: string;
  updatedAfter: string;
  updatedBefore: string;
  flag: string;
  sort: string;
  page: number;
  pageSize: number;
};

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dateValue(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? '' : value;
}

export function readTaskQueryState(search = window.location.search): TaskQueryState {
  const params = new URLSearchParams(search);
  const status = params.get('status') ?? '';
  const area = params.get('area') ?? '';
  const type = params.get('type') ?? '';
  const priority = params.get('priority') ?? '';
  const requestedPageSize = positiveInteger(params.get('pageSize'), 25);
  const parsedPriority = Number(priority);
  const normalizedPriority = /^\d+$/.test(priority) && Number.isSafeInteger(parsedPriority) ? String(parsedPriority) : '';

  return {
    expression: decodeFilterExpression(params.get('filter')),
    search: params.get('search') ?? '',
    status: Object.hasOwn(statusLabels, status) ? status : 'todos',
    area: area.trim().length > 0 && area.trim().length <= 80 && !/[\r\n]/.test(area) ? area.trim() : 'todos',
    type: taskTypes.some(value => value === type) ? type : 'todos',
    priority: normalizedPriority,
    responsible: params.get('responsible') ?? '',
    featureId: params.get('featureId') ?? '',
    createdAfter: dateValue(params.get('createdAfter')),
    createdBefore: dateValue(params.get('createdBefore')),
    updatedAfter: dateValue(params.get('updatedAfter')),
    updatedBefore: dateValue(params.get('updatedBefore')),
    flag: taskFlags.some(value => value === params.get('flag')) ? params.get('flag')! : '',
    sort: taskSorts.some(value => value === params.get('sort')) ? params.get('sort')! : 'priority',
    page: 1,
    pageSize: pageSizes.some(value => value === requestedPageSize) ? requestedPageSize : 25
  };
}

export function syncTaskQueryState(state: TaskQueryState): void {
  const params = new URLSearchParams(window.location.search);
  const values: Array<[string, string]> = [
    ['search', state.search],
    ['status', state.status === 'todos' ? '' : state.status],
    ['area', state.area === 'todos' ? '' : state.area],
    ['type', state.type === 'todos' ? '' : state.type],
    ['priority', state.priority],
    ['responsible', state.responsible],
    ['featureId', state.featureId],
    ['createdAfter', state.createdAfter],
    ['createdBefore', state.createdBefore],
    ['updatedAfter', state.updatedAfter],
    ['updatedBefore', state.updatedBefore],
    ['flag', state.flag],
    ['sort', state.sort === 'priority' ? '' : state.sort],
    ['pageSize', state.pageSize === 25 ? '' : String(state.pageSize)]
  ];

  for (const [key, value] of values) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete('page');

  const expression = encodeFilterExpression(state.expression);
  if (expression) params.set('filter', expression);
  else params.delete('filter');

  const query = params.toString();
  const nextUrl = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl);
}

export { emptyFilterGroup };
