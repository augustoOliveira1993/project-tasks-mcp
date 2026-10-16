import { Event, Feature, Task } from '../db.js';
import { states } from '../schema.js';
import { buildStatusHistory } from './task-context-service.js';

<<<<<<< HEAD
type ProjectRef = { id: string; name: string };
type DashboardTask = {
  _id: string;
  projectId: string;
  featureId?: string;
=======
export type DashboardProject = { id: string; name: string };

type DashboardTask = {
  _id: string;
  projectId: string;
>>>>>>> 9c6390edb4c0782932252fa27bc56fc1c607f84e
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

type TaskMetric = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  status: string;
  area: string | null;
  responsible: string | null;
  createdAt: Date;
  updatedAt: Date;
  developmentTimeMs: number;
};

type Contribution = {
  count: number;
  statuses: Map<string, number>;
  durations: number[];
};

type ResponsibleMetric = Contribution & {
  projects: Map<string, Contribution>;
};

type DashboardBucket = {
  tasks: TaskMetric[];
  statuses: Map<string, number>;
  responsibles: Map<string, ResponsibleMetric>;
  areas: Map<string, number>;
  months: Map<string, { taskCount: number; durations: number[] }>;
};

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

<<<<<<< HEAD
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
=======
function emptyContribution(): Contribution {
  return { count: 0, statuses: new Map(), durations: [] };
}

function emptyBucket(): DashboardBucket {
  return { tasks: [], statuses: new Map(), responsibles: new Map(), areas: new Map(), months: new Map() };
}

function increment(values: Map<string, number>, key: string) {
  values.set(key, (values.get(key) ?? 0) + 1);
}

function statusItems(values: Map<string, number>) {
  return states.map(status => ({ status, count: values.get(status) ?? 0 }));
}

function rate(completed: number, total: number, cancelled: number) {
  const denominator = total - cancelled;
  return denominator > 0 ? Math.round(completed * 1000 / denominator) / 10 : null;
}

function contributionSummary(contribution: Contribution) {
  const completedCount = contribution.statuses.get('concluida') ?? 0;
  const cancelledCount = contribution.statuses.get('cancelada') ?? 0;
  const totalDevelopmentTimeMs = contribution.durations.reduce((sum, value) => sum + value, 0);
  return {
    count: contribution.count,
    byStatus: statusItems(contribution.statuses),
    completedCount,
    completionRate: rate(completedCount, contribution.count, cancelledCount),
    totalDevelopmentTimeMs,
    averageDevelopmentTimeMs: average(contribution.durations),
    developmentSampleCount: contribution.durations.length,
    withoutDevelopmentSampleCount: contribution.count - contribution.durations.length
  };
}

function responsibleItems(bucket: DashboardBucket, projectNames: Map<string, string>, includeProjects = true) {
  return [...bucket.responsibles.entries()].map(([key, contribution]) => ({
    key,
    label: key || 'Sem responsável',
    ...contributionSummary(contribution),
    ...(includeProjects ? {
      byProject: [...contribution.projects.entries()].map(([projectId, project]) => ({
        projectId,
        projectName: projectNames.get(projectId) ?? '',
        ...contributionSummary(project)
      })).sort((left, right) => right.count - left.count || left.projectName.localeCompare(right.projectName, 'pt-BR'))
    } : {})
  })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'));
}

function areaItems(values: Map<string, number>) {
  return [...values.entries()]
    .map(([key, count]) => ({ key, label: key || 'Sem área', count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'));
}

function trendItems(bucket: DashboardBucket) {
  return [...bucket.months.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, metric]) => ({
    month,
    taskCount: metric.taskCount,
    developmentSampleCount: metric.durations.length,
    averageDevelopmentTimeMs: average(metric.durations)
  }));
}

function addTask(bucket: DashboardBucket, task: TaskMetric, projectId: string) {
  bucket.tasks.push(task);
  increment(bucket.statuses, task.status);
  increment(bucket.areas, task.area ?? '');
  const key = task.responsible ?? '';
  const responsible = bucket.responsibles.get(key) ?? { ...emptyContribution(), projects: new Map<string, Contribution>() };
  responsible.count += 1;
  increment(responsible.statuses, task.status);
  if (task.developmentTimeMs > 0) responsible.durations.push(task.developmentTimeMs);

  const projectContribution = responsible.projects.get(projectId) ?? emptyContribution();
  projectContribution.count += 1;
  increment(projectContribution.statuses, task.status);
  if (task.developmentTimeMs > 0) projectContribution.durations.push(task.developmentTimeMs);
  responsible.projects.set(projectId, projectContribution);
  bucket.responsibles.set(key, responsible);

  const month = task.createdAt.toISOString().slice(0, 7);
  const monthMetric = bucket.months.get(month) ?? { taskCount: 0, durations: [] };
  monthMetric.taskCount += 1;
  if (task.developmentTimeMs > 0) monthMetric.durations.push(task.developmentTimeMs);
  bucket.months.set(month, monthMetric);
}

function dashboardSummary(bucket: DashboardBucket, projectNames: Map<string, string>, includeProjectBreakdown = true) {
  const totalTasks = bucket.tasks.length;
  const completedCount = bucket.statuses.get('concluida') ?? 0;
  const cancelledCount = bucket.statuses.get('cancelada') ?? 0;
  const durations = bucket.tasks.map(task => task.developmentTimeMs).filter(value => value > 0);
  return {
    totalTasks,
    byStatus: statusItems(bucket.statuses),
    completedCount,
    completionRate: rate(completedCount, totalTasks, cancelledCount),
    byResponsible: responsibleItems(bucket, projectNames, includeProjectBreakdown),
    byArea: areaItems(bucket.areas),
    development: {
      totalTimeMs: durations.reduce((sum, value) => sum + value, 0),
      averageTimeMs: average(durations),
      sampleCount: durations.length,
      withoutSampleCount: totalTasks - durations.length
    },
    trendByMonth: trendItems(bucket),
    recentTasks: bucket.tasks.slice(0, 8)
  };
}

async function buildDashboards(projects: DashboardProject[], from?: Date) {
  const now = new Date();
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const buckets = new Map(projects.map(project => [project.id, emptyBucket()]));
  const overall = emptyBucket();
  const projectIds = projects.map(project => project.id);
  const tasks = projectIds.length ? await Task.find({
    projectId: { $in: projectIds },
    archived: false,
    ...(from ? { createdAt: { $gte: from } } : {})
  })
    .select('_id projectId name status area responsible createdAt updatedAt')
    .sort({ updatedAt: -1, _id: -1 })
    .lean() as DashboardTask[] : [];

  const taskIds = tasks.map(task => task._id);
  const events = taskIds.length ? await Event.find({
    projectId: { $in: projectIds },
    entityId: { $in: taskIds },
    $or: [{ action: 'create_task' }, { 'data.task.status': { $exists: true } }]
  })
    .select('_id projectId entityId action at data.status data.task.status data.task.version')
    .sort({ at: 1, _id: 1 })
    .lean() : [];

  const eventsByTask = new Map<string, any[]>();
  for (const event of events) {
    const key = String(event.entityId);
    const taskEvents = eventsByTask.get(key);
    if (taskEvents) taskEvents.push(event);
    else eventsByTask.set(key, [event]);
  }

  for (const task of tasks) {
    const projectId = String(task.projectId);
    const projectName = projectNames.get(projectId);
    const bucket = buckets.get(projectId);
    if (projectName === undefined || !bucket) continue;

    const responsible = typeof task.responsible === 'string' && task.responsible.trim() ? task.responsible.trim() : null;
    const area = typeof task.area === 'string' && task.area.trim() ? task.area.trim() : null;
    const history = buildStatusHistory(eventsByTask.get(String(task._id)) ?? [], {
      status: task.status || 'pendente',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }, now);
    const developmentTimeMs = history
      .filter(interval => interval.status === 'em_execucao')
      .reduce((sum, interval) => sum + interval.durationMs, 0);
    const metric: TaskMetric = {
      id: String(task._id),
      projectId,
      projectName,
      name: task.name,
      status: task.status,
      area,
      responsible,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      developmentTimeMs
    };
    addTask(bucket, metric, projectId);
    addTask(overall, metric, projectId);
  }

  return { now, projectNames, buckets, overall, projects };
}
>>>>>>> 9c6390edb4c0782932252fa27bc56fc1c607f84e

export async function getProjectDashboard(projectId: string, from?: Date) {
  const { now, projectNames, buckets } = await buildDashboards([{ id: projectId, name: '' }], from);
  const bucket = buckets.get(projectId) ?? emptyBucket();
  const { byStatus, completedCount, completionRate, ...summary } = dashboardSummary(bucket, projectNames, false);
  return {
    generatedAt: now.toISOString(),
<<<<<<< HEAD
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
=======
    period: { from: from?.toISOString() ?? null, to: now.toISOString(), basis: 'createdAt' as const },
    projectId,
    totalTasks: summary.totalTasks,
    byStatus,
    completedCount,
    completionRate,
    byResponsible: summary.byResponsible,
    byArea: summary.byArea,
    development: summary.development,
    trendByMonth: summary.trendByMonth,
    recentTasks: summary.recentTasks
  };
}

export async function getGlobalDashboard(projects: DashboardProject[], from?: Date) {
  const { now, projectNames, buckets, overall } = await buildDashboards(projects, from);
  const summary = dashboardSummary(overall, projectNames);
  const projectMetrics = projects.map(project => {
    const result = dashboardSummary(buckets.get(project.id) ?? emptyBucket(), projectNames);
    return {
      id: project.id,
      name: project.name,
      totalTasks: result.totalTasks,
      byStatus: result.byStatus,
      completedCount: result.completedCount,
      completionRate: result.completionRate,
      development: result.development
    };
  }).sort((left, right) => right.totalTasks - left.totalTasks || left.name.localeCompare(right.name, 'pt-BR'));
  return {
    generatedAt: now.toISOString(),
    period: { from: from?.toISOString() ?? null, to: now.toISOString(), basis: 'createdAt' as const },
    projectCount: projects.length,
    ...summary,
    projects: projectMetrics
>>>>>>> 9c6390edb4c0782932252fa27bc56fc1c607f84e
  };
}
