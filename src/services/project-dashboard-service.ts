import { Event, Task } from '../db.js';
import { states } from '../schema.js';
import { buildStatusHistory } from './task-context-service.js';

type DashboardTask = {
  _id: string;
  name: string;
  status: string;
  area?: string;
  responsible?: string;
  createdAt: Date;
  updatedAt: Date;
};

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function counts(items: Array<{ key: string; label: string }>, values: Map<string, number>) {
  return items.map(({ key, label }) => ({ key, label, count: values.get(key) ?? 0 }));
}

export async function getProjectDashboard(projectId: string, from?: Date) {
  const now = new Date();
  const tasks = await Task.find({
    projectId,
    archived: false,
    ...(from ? { createdAt: { $gte: from } } : {})
  })
    .select('_id name status area responsible createdAt updatedAt')
    .sort({ updatedAt: -1, _id: -1 })
    .lean() as DashboardTask[];

  const taskIds = tasks.map(task => task._id);
  const events = taskIds.length ? await Event.find({
    projectId,
    entityId: { $in: taskIds },
    $or: [{ action: 'create_task' }, { 'data.task.status': { $exists: true } }]
  })
    .select('_id entityId action at data.status data.task.status data.task.version')
    .sort({ at: 1, _id: 1 })
    .lean() : [];

  const eventsByTask = new Map<string, any[]>();
  for (const event of events) {
    const key = String(event.entityId);
    const taskEvents = eventsByTask.get(key);
    if (taskEvents) taskEvents.push(event);
    else eventsByTask.set(key, [event]);
  }

  const statusCounts = new Map<string, number>();
  const responsibleCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();
  const monthMetrics = new Map<string, { taskCount: number; durations: number[] }>();
  const taskMetrics = tasks.map(task => {
    const responsible = typeof task.responsible === 'string' && task.responsible.trim() ? task.responsible.trim() : '';
    const area = typeof task.area === 'string' && task.area.trim() ? task.area.trim() : '';
    statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
    responsibleCounts.set(responsible, (responsibleCounts.get(responsible) ?? 0) + 1);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

    const history = buildStatusHistory(eventsByTask.get(String(task._id)) ?? [], {
      status: task.status || 'pendente',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }, now);
    const developmentTimeMs = history
      .filter(interval => interval.status === 'em_execucao')
      .reduce((sum, interval) => sum + interval.durationMs, 0);
    const month = task.createdAt.toISOString().slice(0, 7);
    const monthMetric = monthMetrics.get(month) ?? { taskCount: 0, durations: [] };
    monthMetric.taskCount += 1;
    if (developmentTimeMs > 0) monthMetric.durations.push(developmentTimeMs);
    monthMetrics.set(month, monthMetric);

    return {
      id: task._id,
      name: task.name,
      status: task.status,
      area: area || null,
      responsible: responsible || null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      developmentTimeMs
    };
  });

  const durations = taskMetrics.map(task => task.developmentTimeMs).filter(value => value > 0);
  const byResponsible = counts(
    [...responsibleCounts.keys()].map(key => ({ key, label: key || 'Sem responsável' })),
    responsibleCounts
  ).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'));
  const byArea = counts(
    [...areaCounts.keys()].map(key => ({ key, label: key || 'Sem área' })),
    areaCounts
  ).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'));
  const trendByMonth = [...monthMetrics.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, metric]) => ({
    month,
    taskCount: metric.taskCount,
    developmentSampleCount: metric.durations.length,
    averageDevelopmentTimeMs: average(metric.durations)
  }));

  return {
    generatedAt: now.toISOString(),
    period: { from: from?.toISOString() ?? null, to: now.toISOString(), basis: 'createdAt' },
    totalTasks: tasks.length,
    byStatus: states.map(status => ({ status, count: statusCounts.get(status) ?? 0 })),
    byResponsible,
    byArea,
    development: {
      totalTimeMs: durations.reduce((sum, value) => sum + value, 0),
      averageTimeMs: average(durations),
      sampleCount: durations.length
    },
    trendByMonth,
    recentTasks: taskMetrics.slice(0, 8)
  };
}
