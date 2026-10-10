import { Event, Task } from '../db.js';
import { states } from '../schema.js';
import { buildStatusHistory } from './task-context-service.js';

export type DashboardProject = { id: string; name: string };

type DashboardTask = {
  _id: string;
  projectId: string;
  name: string;
  status: string;
  area?: string;
  responsible?: string;
  createdAt: Date;
  updatedAt: Date;
};

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

export async function getProjectDashboard(projectId: string, from?: Date) {
  const { now, projectNames, buckets } = await buildDashboards([{ id: projectId, name: '' }], from);
  const bucket = buckets.get(projectId) ?? emptyBucket();
  const { byStatus, completedCount, completionRate, ...summary } = dashboardSummary(bucket, projectNames, false);
  return {
    generatedAt: now.toISOString(),
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
  };
}
