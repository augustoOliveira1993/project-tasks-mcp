import { statusLabels } from './status';

export const taskTypes = ['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci'] as const;

const areas = ['backend', 'frontend', 'outro'] as const;
const pageSizes = [10, 25, 50, 100] as const;

export type TaskQueryState = {
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
    search: params.get('search') ?? '',
    status: Object.hasOwn(statusLabels, status) ? status : 'todos',
    area: areas.some(value => value === area) ? area : 'todos',
    type: taskTypes.some(value => value === type) ? type : 'todos',
    priority: normalizedPriority,
    responsible: params.get('responsible') ?? '',
    featureId: params.get('featureId') ?? '',
    createdAfter: dateValue(params.get('createdAfter')),
    createdBefore: dateValue(params.get('createdBefore')),
    updatedAfter: dateValue(params.get('updatedAfter')),
    updatedBefore: dateValue(params.get('updatedBefore')),
    page: positiveInteger(params.get('page'), 1),
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
    ['page', state.page === 1 ? '' : String(state.page)],
    ['pageSize', state.pageSize === 25 ? '' : String(state.pageSize)]
  ];

  for (const [key, value] of values) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  const query = params.toString();
  const nextUrl = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl);
}
