import { noAreaFilter, noResponsibleFilter } from '../tasks/task-filters';

export type TaskLinkFilters = Record<string, string>;

/** Data (AAAA-MM-DD) usada como "criada desde" a partir do início do período em ISO. */
export function periodFilters(from?: string): TaskLinkFilters {
  return from ? { createdAfter: from.slice(0, 10) } : {};
}

export function responsibleFilterValue(key: string): string {
  return key || noResponsibleFilter;
}

export function areaFilterValue(key: string): string {
  return key || noAreaFilter;
}

/** Faixa de criação de um mês (AAAA-MM), limitada ao início do período quando ele começa depois do mês. */
export function monthFilters(month: string, from?: string): TaskLinkFilters {
  const [year, number] = month.split('-').map(Number);
  if (!year || !number) return periodFilters(from);
  const start = `${year}-${String(number).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const periodStart = from?.slice(0, 10);
  return { createdAfter: periodStart && periodStart > start ? periodStart : start, createdBefore: end };
}
