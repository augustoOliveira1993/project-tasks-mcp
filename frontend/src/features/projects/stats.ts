import type { ProjectSummary } from '../../api';

export function projectStats(item: ProjectSummary) {
  const counts = (item.taskSummary?.counts ?? {}) as Record<string, number>;
  const total = Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const active = Math.max(0, total - (Number(counts.cancelada) || 0));
  const completed = Number(counts.concluida) || 0;
  return { total, completed, progress: active ? Math.min(100, Math.round(completed * 100 / active)) : 0 };
}
