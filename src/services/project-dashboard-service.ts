import { Event, Feature, Task } from '../db.js';
import { states } from '../schema.js';
import { buildStatusHistory } from './task-context-service.js';

type ProjectRef = { id: string; name: string };
type DashboardTask = {
  _id: string;
  projectId: string;
  featureId?: string;
  name: string;
  status: string;
  area?: string;
  responsible?: string;
  plannedStartAt?: Date | null;
  plannedDueAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type TaskMetric = DashboardTask & { statusHistory: Array<{ status: string; startedAt: Date; endedAt: Date | null; durationMs: number }>; developmentTimeMs: number };
type Granularity = 'day' | 'week' | 'month';

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function sortedCounts(values: Map<string, number>, labelFor: (key: string) => string) {
  return [...values.entries()].map(([key, count]) => ({ key, label: labelFor(key), count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'));
}

function periodKey(value: Date, granularity: Granularity) {
  if (granularity === 'day') return value.toISOString().slice(0, 10);
  if (granularity === 'month') return value.toISOString().slice(0, 7);
  const thursday = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  yearStart.setUTCDate(yearStart.getUTCDate() + 3 - ((yearStart.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - yearStart.getTime()) / 604800000);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildSummary(metrics: TaskMetric[], featureNames: Map<string, string>, projectNames: Map<string, string>, granularity: Granularity, now: Date, from?: Date, to?: Date, prefixProject = false) {
  const statusCounts = new Map<string, number>();
  const responsibleCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();
  const featureCounts = new Map<string, { projectId: string; featureId: string | null; label: string; count: number }>();
  const trends = new Map<string, { taskCount: number; durations: number[] }>();
  const months = new Map<string, { taskCount: number; durations: number[] }>();

  for (const task of metrics) {
    const responsible = typeof task.responsible === 'string' && task.responsible.trim() ? task.responsible.trim() : '';
    const area = typeof task.area === 'string' && task.area.trim() ? task.area.trim() : '';
    const featureId = task.featureId ?? '';
    const featureKey = `${task.projectId}:${featureId || 'none'}`;
    const featureName = featureId ? featureNames.get(featureKey) ?? 'Feature sem nome' : 'Sem feature';
    const projectName = projectNames.get(task.projectId) ?? task.projectId;
    const featureMetric = featureCounts.get(featureKey) ?? {
      projectId: task.projectId,
      featureId: featureId || null,
      label: prefixProject ? `${projectName} · ${featureName}` : featureName,
      count: 0
    };
    featureMetric.count += 1;
    featureCounts.set(featureKey, featureMetric);
    statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
    responsibleCounts.set(responsible, (responsibleCounts.get(responsible) ?? 0) + 1);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

    const period = periodKey(task.createdAt, granularity);
    const trend = trends.get(period) ?? { taskCount: 0, durations: [] };
    trend.taskCount += 1;
    if (task.developmentTimeMs > 0) trend.durations.push(task.developmentTimeMs);
    trends.set(period, trend);

    const month = periodKey(task.createdAt, 'month');
    const monthMetric = months.get(month) ?? { taskCount: 0, durations: [] };
    monthMetric.taskCount += 1;
    if (task.developmentTimeMs > 0) monthMetric.durations.push(task.developmentTimeMs);
    months.set(month, monthMetric);
  }

  const durations = metrics.map(task => task.developmentTimeMs).filter(value => value > 0);
  const trendByPeriod = [...trends.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, metric]) => ({
    period,
    taskCount: metric.taskCount,
    developmentSampleCount: metric.durations.length,
    averageDevelopmentTimeMs: average(metric.durations)
  }));
  const trendByMonth = [...months.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, metric]) => ({
    month,
    taskCount: metric.taskCount,
    developmentSampleCount: metric.durations.length,
    averageDevelopmentTimeMs: average(metric.durations)
  }));

  return {
    generatedAt: now.toISOString(),
    period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? now.toISOString(), basis: 'createdAt' },
    granularity,
    totalTasks: metrics.length,
    byStatus: states.map(status => ({ status, count: statusCounts.get(status) ?? 0 })),
    byResponsible: sortedCounts(responsibleCounts, key => key || 'Sem responsável'),
    byArea: sortedCounts(areaCounts, key => key || 'Sem área'),
    byFeature: [...featureCounts.entries()].map(([key, value]) => ({ key, ...value }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
    development: {
      totalTimeMs: durations.reduce((sum, value) => sum + value, 0),
      averageTimeMs: average(durations),
      sampleCount: durations.length
    },
    trendByPeriod,
    trendByMonth,
    recentTasks: metrics.slice(0, 8).map(task => ({
      id: task._id,
      name: task.name,
      projectId: task.projectId,
      projectName: projectNames.get(task.projectId) ?? null,
      featureId: task.featureId ?? null,
      status: task.status,
      area: task.area?.trim() || null,
      responsible: task.responsible?.trim() || null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      developmentTimeMs: task.developmentTimeMs,
      plannedStartAt: task.plannedStartAt ?? null,
      plannedDueAt: task.plannedDueAt ?? null
    }))
  };
}

async function readDashboards(projects: ProjectRef[], from?: Date, to?: Date, granularity: Granularity = 'month') {
  const now = new Date();
  const projectIds = projects.map(project => project.id);
  if (!projectIds.length) {
    const empty = buildSummary([], new Map(), new Map(), granularity, now, from, to);
    return { projectIds, taskMetrics: [] as TaskMetric[], summary: empty, byProject: [] as any[], projectNames: new Map<string, string>(), featureNames: new Map<string, string>() };
  }

  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const allTasks = await Task.find({ projectId: { $in: projectIds }, archived: false })
    .select('_id projectId featureId name status area responsible createdAt updatedAt plannedStartAt plannedDueAt')
    .sort({ updatedAt: -1, _id: -1 })
    .lean() as DashboardTask[];
  const isInPeriod = (task: DashboardTask) => (!from || task.createdAt >= from) && (!to || task.createdAt <= to);
  const metricTasks = allTasks.filter(isInPeriod);
  const scheduleTasks = allTasks.filter(task => task.plannedStartAt || task.plannedDueAt);
  const relevantIds = [...new Set([...metricTasks, ...scheduleTasks].map(task => task._id))];
  const [events, features] = await Promise.all([
    relevantIds.length ? Event.find({
      projectId: { $in: projectIds },
      entityId: { $in: relevantIds },
      $or: [{ action: 'create_task' }, { 'data.task.status': { $exists: true } }]
    }).select('_id projectId entityId action at data.status data.task.status data.task.version').sort({ at: 1, _id: 1 }).lean() : Promise.resolve([]),
    Feature.find({ projectId: { $in: projectIds } }).select('_id projectId name').lean()
  ]);
  const featureNames = new Map(features.map(feature => [`${feature.projectId}:${feature._id}`, feature.name ?? 'Feature sem nome']));
  const eventsByTask = new Map<string, any[]>();
  for (const event of events) {
    const key = String(event.entityId);
    const taskEvents = eventsByTask.get(key);
    if (taskEvents) taskEvents.push(event);
    else eventsByTask.set(key, [event]);
  }
  const relevantTasks = new Map([...metricTasks, ...scheduleTasks].map(task => [task._id, task]));
  const taskMetrics: TaskMetric[] = [...relevantTasks.values()].map(task => {
    const statusHistory = buildStatusHistory(eventsByTask.get(String(task._id)) ?? [], {
      status: task.status || 'pendente',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }, now);
    return {
      ...task,
      statusHistory,
      developmentTimeMs: statusHistory.filter(interval => interval.status === 'em_execucao')
        .reduce((sum, interval) => sum + interval.durationMs, 0)
    };
  });
  const metricsById = new Map(taskMetrics.map(task => [task._id, task]));
  const selectedMetrics = metricTasks.map(task => metricsById.get(task._id)!).filter(Boolean);
  const scheduledMetrics = scheduleTasks.map(task => metricsById.get(task._id)!).filter(Boolean)
    .sort((left, right) => (left.plannedStartAt?.getTime() ?? left.plannedDueAt?.getTime() ?? 0) - (right.plannedStartAt?.getTime() ?? right.plannedDueAt?.getTime() ?? 0));
  const summary = buildSummary(selectedMetrics, featureNames, projectNames, granularity, now, from, to);
  const byProject = projects.map(project => {
    const metrics = selectedMetrics.filter(task => task.projectId === project.id);
    const scheduled = scheduledMetrics.filter(task => task.projectId === project.id);
    const projectSummary = buildSummary(metrics, featureNames, projectNames, granularity, now, from, to);
    const overdue = scheduled.filter(task => task.plannedDueAt && task.plannedDueAt < now && !['concluida', 'cancelada'].includes(task.status)).length;
    return {
      projectId: project.id,
      projectName: project.name,
      ...projectSummary,
      scheduleSummary: { scheduledTaskCount: scheduled.length, overdueTaskCount: overdue }
    };
  });
  return { projectIds, taskMetrics: scheduledMetrics, summary, byProject, projectNames, featureNames };
}

function scheduleRows(tasks: TaskMetric[], projectNames: Map<string, string>, featureNames: Map<string, string>) {
  return tasks.map(task => ({
    taskId: task._id,
    projectId: task.projectId,
      projectName: projectNames.get(task.projectId) || null,
    featureId: task.featureId ?? null,
    featureName: task.featureId ? featureNames.get(`${task.projectId}:${task.featureId}`) ?? null : null,
    name: task.name,
    status: task.status,
    responsible: task.responsible?.trim() || null,
    plannedStartAt: task.plannedStartAt ?? null,
    plannedDueAt: task.plannedDueAt ?? null,
    actualStatusHistory: task.statusHistory
  }));
}

export async function getProjectDashboard(projectId: string, from?: Date, to?: Date, granularity: Granularity = 'month') {
  const result = await readDashboards([{ id: projectId, name: '' }], from, to, granularity);
  return {
    ...result.summary,
    scheduleSummary: result.byProject[0]?.scheduleSummary ?? { scheduledTaskCount: 0, overdueTaskCount: 0 },
    schedule: scheduleRows(result.taskMetrics, result.projectNames ?? new Map(), result.featureNames ?? new Map())
  };
}

export async function getPortfolioDashboard(projects: ProjectRef[], from?: Date, to?: Date, granularity: Granularity = 'month') {
  const result = await readDashboards(projects, from, to, granularity);
  return {
    ...result.summary,
    totalProjects: projects.length,
    projects: result.byProject,
    schedule: scheduleRows(result.taskMetrics, result.projectNames ?? new Map(), result.featureNames ?? new Map())
  };
}
