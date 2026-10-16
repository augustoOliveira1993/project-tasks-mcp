import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { buttonSecondary, eyebrow, textButton } from '../../components/ui/classes';
import { TaskLink, TasksLink } from '../../components/ui/Links';
<<<<<<< HEAD
import { areaFilterValue, responsibleFilterValue, type TaskLinkFilters } from './dashboard-links';
import { statusLabels, statusTone } from '../tasks/status';
import { areaLabel } from '../../lib/labels';
=======
import { areaFilterValue, monthFilters, periodFilters, responsibleFilterValue, type TaskLinkFilters } from './dashboard-links';
import { displayResponsible, formatDuration, formatPercent, periodStart, type DashboardPeriod as Period } from './dashboard-format';
import { ProjectMemoryPanel } from './ProjectMemoryPanel';

const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const panel = 'min-w-0 rounded-ui-md border border-line bg-surface px-[18px] py-4 max-[480px]:px-3 max-[480px]:py-[14px]';
const panelHeading = 'mb-[15px] flex justify-between gap-3 [align-items:start]';
const panelTitle = 'text-ui-md font-bold text-ink';
const panelSubtitle = 'mt-1 text-ui-xs text-muted-strong';
const metric = 'grid min-w-0 content-start gap-1.5 rounded-ui-md border border-line bg-surface px-4 py-[15px] no-underline shadow-[0_1px_2px_#1720330a] transition hover:border-focus hover:shadow-[0_2px_8px_#1720331a] max-[480px]:p-3';
const th = 'border-b border-b-line px-[9px] py-2 text-ui-xs font-semibold whitespace-nowrap text-muted-strong';
const cell = 'border-b border-b-line px-[9px] py-[11px] text-ink-2 align-top';
const control = 'min-h-9 min-w-0 rounded-ui-sm border border-line-strong bg-surface px-[10px] text-ink';
const trendBar = 'block min-h-1 w-full rounded-t-[4px] bg-focus';
const toneByStatus: Record<string, string> = { muted: 'bg-muted-strong', blue: 'bg-tone-blue', green: 'bg-tone-green', amber: 'bg-tone-amber', red: 'bg-tone-red' };

<<<<<<< HEAD
type CountItem = { key: string; label: string; count: number; projectId?: string; featureId?: string | null };
type FeatureCount = CountItem & { projectId: string; featureId: string | null };
type StatusInterval = { status: string; startedAt: string; endedAt: string | null; durationMs: number };
type ScheduleTask = {
  taskId: string;
  projectId: string;
  projectName: string | null;
  featureId: string | null;
  featureName: string | null;
  name: string;
  status: string;
  responsible: string | null;
  plannedStartAt: string | null;
  plannedDueAt: string | null;
  actualStatusHistory: StatusInterval[];
=======
type CountItem = { key: string; label: string; count: number };
type ResponsibleMetric = CountItem & {
  byStatus: Array<{ status: string; count: number }>;
  completedCount: number;
  completionRate: number | null;
  averageDevelopmentTimeMs: number | null;
  developmentSampleCount: number;
  withoutDevelopmentSampleCount: number;
};
type DashboardTask = {
  id: string;
  name: string;
  projectId: string;
  projectName: string | null;
  featureId: string | null;
  status: string;
  area: string | null;
  responsible: string | null;
  createdAt: string;
  updatedAt: string;
  developmentTimeMs: number;
};
type DashboardSummary = {
  period: { from: string | null; to: string; basis: 'createdAt' };
  granularity: 'day' | 'week' | 'month';
  totalTasks: number;
  completedCount: number;
  completionRate: number | null;
  byStatus: Array<{ status: string; count: number }>;
  byResponsible: ResponsibleMetric[];
  byArea: CountItem[];
  development: { totalTimeMs: number; averageTimeMs: number | null; sampleCount: number; withoutSampleCount: number };
  trendByMonth: Array<{ month: string; taskCount: number; developmentSampleCount: number; averageDevelopmentTimeMs: number | null }>;
  recentTasks: DashboardTask[];
};
function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
}

function ResponsiblePerformanceTable({ items, projectId, from }: { items: ResponsibleMetric[]; projectId: string; from?: string }) {
  if (!items.length) return <p className={emptyInline}>Nenhum responsável com tarefas neste período.</p>;
  return <div className="mt-4 overflow-x-auto rounded-ui-sm border border-line">
    <table className="w-full min-w-[650px] border-collapse text-left text-ui-xs">
      <thead><tr><th className={th} scope="col">Responsável</th><th className={th} scope="col">Tarefas por status</th><th className={th} scope="col">Concluídas</th><th className={th} scope="col">Execução média</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.key || 'unassigned'} className="[&:last-child>td]:border-b-0">
        <td className={`${cell} font-semibold`}><TasksLink projectId={projectId} filters={{ responsible: responsibleFilterValue(item.key), ...periodFilters(from) }} title={`Ver as ${item.count} tarefas de ${displayResponsible(item.key)}`} className={cellLink}>{displayResponsible(item.key)}</TasksLink><small className="mt-1 block font-normal text-muted-strong">{item.count} tarefa(s)</small></td>
        <td className={cell}><div className="flex max-w-[410px] flex-wrap gap-1.5">{item.byStatus.filter(status => status.count > 0).map(status => <TasksLink key={status.status} projectId={projectId} filters={{ responsible: responsibleFilterValue(item.key), status: status.status, ...periodFilters(from) }} title={`Ver ${status.count} tarefa(s) de ${displayResponsible(item.key)} com status ${statusLabels[status.status] ?? status.status}`} className="rounded-ui-sm bg-canvas px-1.5 py-1 font-semibold text-ink-2 no-underline hover:bg-tone-blue-bg hover:text-tone-blue">{statusLabels[status.status] ?? status.status} · {status.count}</TasksLink>)}{!item.byStatus.some(status => status.count > 0) && <span className="text-muted-strong">Sem tarefas</span>}</div></td>
        <td className={cell}><strong className="text-ink">{item.completedCount} · {formatPercent(item.completionRate)}</strong><small className="mt-1 block text-muted-strong">das tarefas não canceladas</small></td>
        <td className={cell}><strong className="text-ink">{formatDuration(item.averageDevelopmentTimeMs)}</strong><small className="mt-1 block text-muted-strong">{item.developmentSampleCount} com tempo · {item.withoutDevelopmentSampleCount} sem amostra</small></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function DistributionChart({ title, items, tone = 'blue', responsible = false, projectId, filtersFor }: { title: string; items: CountItem[]; tone?: string; responsible?: boolean; projectId: string; filtersFor: (item: CountItem) => TaskLinkFilters }) {
>>>>>>> 9c6390edb4c0782932252fa27bc56fc1c607f84e
if (!items.length) return <p className={emptyInline}>Nenhuma tarefa neste período.</p>;
const maximum = Math.max(1, ...items.map(item => item.count));
return <div className="grid gap-[11px]" role="list" aria-label={title}>
  {items.map(item => {
    const content = <span className="grid min-w-0 grid-cols-[minmax(90px,1.1fr)_minmax(50px,2fr)_34px] items-center gap-[9px] text-ui-xs max-[480px]:grid-cols-[minmax(76px,1.15fr)_minmax(30px,1fr)_28px] max-[480px]:gap-[6px]">
      <span className="truncate text-ink-2">{item.label}</span>
      <span className="block h-2 overflow-hidden rounded-[99px] bg-canvas" aria-hidden="true"><span className="block h-full min-w-0 rounded-[inherit] bg-tone-blue" style={{ width: `${Math.max(item.count ? 4 : 0, item.count / maximum * 100)}%` }} /></span>
      <strong className="text-right text-ink-2 tabular-nums">{item.count}</strong>
    </span>;
    const className = 'block rounded-ui-sm px-1.5 py-0.5 text-left no-underline transition-colors hover:bg-canvas';
    const hasFeatureFilter = !('featureId' in item) || Boolean(item.featureId);
    return <div role="listitem" key={item.key || 'empty'}>
      {projectId && filtersFor && hasFeatureFilter
        ? <TasksLink projectId={projectId} filters={filtersFor(item)} title={`Ver ${item.count} tarefa(s): ${item.label}`} className={className}>{content}</TasksLink>
        : item.projectId && onOpenProject
          ? <button type="button" className={`${className} w-full cursor-pointer`} onClick={() => onOpenProject(item.projectId!)}>{content}</button>
          : <div className={className}>{content}</div>}
    </div>;
  })}
</div>;
}

function TrendChart({ items, granularity }: { items: DashboardSummary['trendByPeriod']; granularity: Granularity }) {
  if (!items.length) return <p className={emptyInline}>Nenhuma tarefa criada neste período.</p>;
  const maximum = Math.max(1, ...items.map(item => item.taskCount));
  return <div className="overflow-x-auto pb-2">
    <div className="flex min-w-max items-end gap-2" role="list" aria-label={`Tarefas por ${granularity}`}>
      {items.map(item => <div className="grid w-[82px] justify-items-center gap-1 text-center" role="listitem" key={item.period} title={`${item.taskCount} tarefa(s), média de desenvolvimento ${formatDuration(item.averageDevelopmentTimeMs)}`}>
        <strong className="text-ui-xs tabular-nums text-ink-2">{item.taskCount}</strong>
        <span className="flex h-24 w-full items-end justify-center rounded-t-[4px] bg-canvas"><span className={trendBar} style={{ height: `${item.taskCount ? Math.max(6, item.taskCount / maximum * 100) : 0}%` }} /></span>
        <span className="text-[10px] text-ink-2">{periodLabel(item.period, granularity)}</span>
        <small className="text-[9px] text-muted-strong">{formatDuration(item.averageDevelopmentTimeMs)} média</small>
      </div>)}
    </div>
  </div>;
}

function ScheduleTimeline({ items, showProject = false }: { items: ScheduleTask[]; showProject?: boolean }) {
  if (!items.length) return <p className={emptyInline}>Nenhuma tarefa com datas planejadas neste recorte.</p>;
  const visible = items.slice(0, 100);
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[890px] border-collapse text-left text-ui-sm">
      <thead><tr>{showProject && <th className={th} scope="col">Projeto</th>}<th className={th} scope="col">Tarefa / feature</th><th className={th} scope="col">Responsável</th><th className={th} scope="col">Início planejado</th><th className={th} scope="col">Entrega planejada</th><th className={th} scope="col">Linha do tempo real de status</th></tr></thead>
      <tbody>{visible.map(task => {
        const overdue = task.plannedDueAt && new Date(task.plannedDueAt).valueOf() < Date.now() && !['concluida', 'cancelada'].includes(task.status);
        return <tr className="[&:last-child>td]:border-b-0" key={task.taskId}>
          {showProject && <td className={`${cell} max-w-[160px] [overflow-wrap:anywhere]`}>{task.projectName ?? 'Projeto'}</td>}
          <td className={`${cell} max-w-[240px] [overflow-wrap:anywhere]`}><TaskLink taskId={task.taskId} name={task.name} projectId={task.projectId} className="font-semibold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2 hover:text-[#2a3dbe]">{task.name}</TaskLink><small className="mt-1 block text-[10px] text-muted-strong">{task.featureName ?? 'Sem feature'} · {statusName(task.status)}{overdue ? ' · Atrasada' : ''}</small></td>
          <td className={cell}>{displayResponsible(task.responsible)}</td>
          <td className={`${cell} whitespace-nowrap`}>{dateLabel(task.plannedStartAt)}</td>
          <td className={`${cell} whitespace-nowrap`}><span className={overdue ? 'font-semibold text-tone-red' : ''}>{dateLabel(task.plannedDueAt)}</span></td>
          <td className={cell}>{task.actualStatusHistory.length ? <ol className="flex min-w-[220px] flex-wrap gap-1.5" aria-label={`Histórico real de status de ${task.name}`}>
            {task.actualStatusHistory.map((interval, index) => <li className="rounded-full border border-line bg-canvas px-2 py-1 text-[10px] text-ink-2" key={`${interval.startedAt}-${index}`} title={`${dateLabel(interval.startedAt)} até ${interval.endedAt ? dateLabel(interval.endedAt) : 'em aberto'} · ${formatDuration(interval.durationMs)}`}><span className={`mr-1 inline-block size-[6px] rounded-full ${toneByStatus[statusTone[interval.status] ?? 'muted'] ?? toneByStatus.muted}`} aria-hidden="true" />{statusName(interval.status)} <time dateTime={interval.startedAt}>{dateLabel(interval.startedAt)}</time></li>)}
          </ol> : <span className="text-muted-strong">Sem eventos registrados</span>}</td>
        </tr>;
      })}</tbody>
    </table>
    {items.length > visible.length && <p className="mt-2 text-ui-xs text-muted-strong">Exibindo {visible.length} de {items.length} tarefas planejadas. Ajuste os filtros para reduzir o recorte.</p>}
  </div>;
}

export function ProjectDashboardPage({ token, nonce, projectId, onSelectProject }: { token: string; nonce: string; projectId: string; onSelectProject: (projectId: string) => void }) {
  const [view, setView] = useState<View>('portfolio');
  const [range, setRange] = useState(initialRange);
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [projectFilter, setProjectFilter] = useState('');
  const [featureFilter, setFeatureFilter] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState('');
  useEffect(() => { setFeatureFilter(''); setResponsibleFilter(''); }, [projectId]);

  const from = useMemo(() => toIso(range.from), [range.from]);
  const to = useMemo(() => toIso(range.to, true), [range.to]);
  const validRange = !range.from || !range.to || range.from <= range.to;
  const commonArgs = { granularity, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-dashboard', nonce, range.from, range.to, granularity],
    enabled: Boolean(token && nonce && validRange),
    queryFn: () => query<PortfolioDashboard>(token, 'get_portfolio_dashboard', commonArgs)
  });
  const projectQuery = useQuery({
    queryKey: ['project-dashboard', nonce, projectId, range.from, range.to, granularity],
    enabled: Boolean(token && nonce && projectId && validRange && view === 'project'),
    queryFn: () => query<ProjectDashboard>(token, 'get_project_dashboard', { projectId, ...commonArgs })
  });
  const portfolio = portfolioQuery.data;
  const projectInPortfolio = portfolio?.projects.find(item => item.projectId === projectFilter);
  const activeSummary: DashboardSummary | undefined = view === 'project' ? projectQuery.data : projectInPortfolio ?? portfolio;
  const portfolioSchedule = portfolio?.schedule ?? [];
  const selectedResponsibleKey = responsibleFilter === '__none__' ? '' : responsibleFilter;
  const schedule = (view === 'project' ? projectQuery.data?.schedule ?? [] : portfolioSchedule)
    .filter(item => !projectFilter || view === 'project' || item.projectId === projectFilter)
    .filter(item => !featureFilter || `${item.projectId}:${item.featureId ?? 'none'}` === featureFilter)
    .filter(item => !responsibleFilter || (item.responsible ?? '') === selectedResponsibleKey);
  const featureOptions = activeSummary?.byFeature ?? [];
  const responsibleOptions = activeSummary?.byResponsible ?? [];
  const featureItems = featureOptions.filter(item => !featureFilter || item.key === featureFilter);
  const responsibleItems = responsibleOptions.filter(item => !responsibleFilter || item.key === selectedResponsibleKey);
  const statusItems = (activeSummary?.byStatus ?? []).map(item => ({ key: item.status, label: statusName(item.status), count: item.count }));
  const areaItems = (activeSummary?.byArea ?? []).map(item => ({ ...item, label: areaLabel(item.key || null) }));
  const projectRows = (portfolio?.projects ?? []).filter(item => !projectFilter || item.projectId === projectFilter);
  const overdueCount = schedule.filter(item => item.plannedDueAt && new Date(item.plannedDueAt).valueOf() < Date.now() && !['concluida', 'cancelada'].includes(item.status)).length;
  const scheduledCount = schedule.length;
  const completedCount = activeSummary?.byStatus.find(item => item.status === 'concluida')?.count ?? 0;
  const completionRate = activeSummary?.totalTasks ? Math.round(completedCount / activeSummary.totalTasks * 100) : 0;
  const periodTaskFilters = taskFilters(from, to);
  const currentProjectName = portfolio?.projects.find(item => item.projectId === projectId)?.projectName;

  function chooseProject(id: string) {
    setProjectFilter(id);
    setFeatureFilter('');
    setResponsibleFilter('');
    if (id) onSelectProject(id);
  }

  function openProject(id: string) {
    chooseProject(id);
    setView('project');
  }

  function setPreset(preset: '30d' | '90d' | 'year' | 'all') {
    const today = new Date();
    const end = localDateInput(today);
    if (preset === 'all') { setRange({ from: '', to: '' }); return; }
    const start = new Date(today);
    if (preset === '30d') start.setDate(start.getDate() - 29);
    if (preset === '90d') start.setDate(start.getDate() - 89);
    if (preset === 'year') start.setMonth(0, 1);
    setRange({ from: localDateInput(start), to: end });
  }

  const isPending = portfolioQuery.isPending || view === 'project' && projectQuery.isPending;
  const activeError = view === 'project' && projectQuery.isError ? projectQuery.error : portfolioQuery.error;
  const retry = () => view === 'project' ? void projectQuery.refetch() : void portfolioQuery.refetch();
  const retrying = portfolioQuery.isFetching || projectQuery.isFetching;

  return <section className="grid min-w-0 gap-4" aria-labelledby="dashboard-title">
    <div className="mb-[5px] flex flex-wrap justify-between gap-5 [align-items:end] max-[720px]:flex-col max-[720px]:[align-items:start]">
      <div><p className={eyebrow}>GESTÃO DO PROJETO</p><h1 id="dashboard-title" className="mb-1.5 font-display text-[length:clamp(21px,2vw,27px)] leading-[normal] font-extrabold tracking-[-.045em]">Dashboard de projetos</h1><p className="text-ui-sm text-muted-strong">Portfólio, desempenho, responsáveis e cronograma planejado com histórico real de status.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-ui-sm border border-line bg-surface p-1" role="group" aria-label="Escopo do dashboard">
          <button type="button" className={`${buttonSecondary} ${view === 'portfolio' ? 'border-focus text-focus' : ''}`} aria-pressed={view === 'portfolio'} onClick={() => setView('portfolio')}>Portfólio</button>
          <button type="button" className={`${buttonSecondary} ${view === 'project' ? 'border-focus text-focus' : ''}`} aria-pressed={view === 'project'} onClick={() => setView('project')}>Projeto</button>
        </div>
        {view === 'portfolio' && <label className="grid gap-[5px] text-ui-xs text-muted-strong">Projeto no portfólio<select className={control} value={projectFilter} onChange={event => chooseProject(event.target.value)}><option value="">Todos os projetos acessíveis</option>{(portfolio?.projects ?? []).map(item => <option value={item.projectId} key={item.projectId}>{item.projectName}</option>)}</select></label>}
      </div>
    </div>

<<<<<<< HEAD
  <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_repeat(2,minmax(0,1.1fr))] items-end gap-2 rounded-ui-md border border-line bg-surface p-3 max-[900px]:grid-cols-3 max-[560px]:grid-cols-2">
    <div className="col-span-full flex flex-wrap gap-1.5">
      {(['30d', '90d', 'year', 'all'] as const).map(preset => <button className={`${textButton} !px-2 !py-1`} type="button" key={preset} onClick={() => setPreset(preset)}>{preset === '30d' ? '30 dias' : preset === '90d' ? '90 dias' : preset === 'year' ? 'Este ano' : 'Todo o período'}</button>)}
=======
    {dashboardQuery.isPending && <div className="py-2"><Skeleton rows={6} label="Carregando dashboard…" /></div>}
      {dashboardQuery.isError && <ErrorNotice error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} retrying={dashboardQuery.isFetching} title="Não foi possível carregar o dashboard" />}
      {data && <>
        <div className="grid grid-cols-[repeat(5,minmax(0,1fr))] gap-3 max-[960px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[480px]:gap-2" aria-label="Indicadores principais">
          <TasksLink projectId={projectId} filters={inPeriod} title="Ver todas as tarefas do período" className={metric}><span className="text-ui-sm text-muted-strong">Total de tarefas</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{data.totalTasks}</strong><small className="text-ui-xs text-muted-strong">no período selecionado</small></TasksLink>
          <TasksLink projectId={projectId} filters={{ status: 'em_execucao', ...inPeriod }} title="Ver as tarefas em execução" className={metric}><span className="text-ui-sm text-muted-strong">Em execução</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{counts.get('em_execucao') ?? 0}</strong><small className="text-ui-xs text-muted-strong">tarefas ativas agora</small></TasksLink>
          <TasksLink projectId={projectId} filters={{ status: 'concluida', ...inPeriod }} title="Ver as tarefas concluídas" className={metric}><span className="text-ui-sm text-muted-strong">Concluídas</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{counts.get('concluida') ?? 0}</strong><small className="text-ui-xs text-muted-strong">status atual</small></TasksLink>
          <TasksLink projectId={projectId} filters={inPeriod} title="Ver as tarefas usadas para calcular a taxa de conclusão" className={metric}><span className="text-ui-sm text-muted-strong">Taxa de conclusão</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{formatPercent(data.completionRate)}</strong><small className="text-ui-xs text-muted-strong">concluídas sobre as não canceladas</small></TasksLink>
          <TasksLink projectId={projectId} filters={{ sort: 'updated', ...inPeriod }} title="Ver as tarefas do período, das atualizadas mais recentemente" className={metric}><span className="text-ui-sm text-muted-strong">Tempo médio em execução</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{formatDuration(data.development.averageTimeMs)}</strong><small className="text-ui-xs text-muted-strong">{data.development.sampleCount} com tempo · {data.development.withoutSampleCount} sem amostra</small></TasksLink>
        </div>

        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[14px] max-[720px]:grid-cols-[1fr]">
<<<<<<< HEAD
        <section className={panel} aria-labelledby="dashboard-trend-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-trend-title">Tendência por {granularity === 'day' ? 'dia' : granularity === 'week' ? 'semana' : 'mês'}</h2><p className={panelSubtitle}>Tarefas criadas e duração média dos intervalos em execução.</p></div></div><TrendChart items={activeSummary.trendByPeriod} granularity={granularity} /></section>
        <section className={panel} aria-labelledby="dashboard-status-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-status-title">Tarefas por status</h2><p className={panelSubtitle}>Distribuição no período selecionado.</p></div></div><DistributionChart title="Quantidade de tarefas por status" items={statusItems} projectId={view === 'project' ? projectId : undefined} filtersFor={item => ({ status: item.key, ...periodTaskFilters })} /></section>
=======
        <section className={panel} aria-labelledby="dashboard-status-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-status-title">Tarefas por status</h2><p className={panelSubtitle}>Distribuição atual</p></div></div>
          <DistributionChart title="Quantidade de tarefas por status" items={statusItems} tone="blue" projectId={projectId} filtersFor={item => ({ status: item.key, ...inPeriod })} />
        </section>
        <section className={panel} aria-labelledby="dashboard-owner-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-owner-title">Tarefas por responsável</h2><p className={panelSubtitle}>Inclui tarefas sem responsável</p></div></div>
          <DistributionChart title="Quantidade de tarefas por responsável" items={data.byResponsible} tone="green" responsible projectId={projectId} filtersFor={item => ({ responsible: responsibleFilterValue(item.key), ...inPeriod })} />
          <ResponsiblePerformanceTable items={data.byResponsible} projectId={projectId} from={from} />
        </section>
        <section className={panel} aria-labelledby="dashboard-area-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-area-title">Tarefas por área</h2><p className={panelSubtitle}>Distribuição do trabalho</p></div></div>
          <DistributionChart title="Quantidade de tarefas por área" items={areaItems} tone="amber" projectId={projectId} filtersFor={item => ({ area: areaFilterValue(item.key), ...inPeriod })} />
        </section>
        <section className={panel} aria-labelledby="dashboard-development-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-development-title">Tempo em desenvolvimento</h2><p className={panelSubtitle}>Média das tarefas criadas em cada mês</p></div></div>
          <DevelopmentTrend items={data.trendByMonth} projectId={projectId} from={from} />
          <p className="mt-[14px] text-ui-xs leading-normal text-muted-strong">Soma dos intervalos em “Em execução”; o período bloqueado fica fora do cálculo.</p>
        </section>
        <section className={`${panel} col-span-full max-[720px]:col-auto`} aria-labelledby="dashboard-recent-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-recent-title">Tarefas recentes</h2><p className={panelSubtitle}>Responsável, status e duração em execução</p></div><TasksLink projectId={projectId} filters={{ sort: 'created', ...inPeriod }} className={`${textButton} whitespace-nowrap no-underline`} title="Abrir a lista de tarefas, das criadas mais recentemente">Ver todas →</TasksLink></div>
          {data.recentTasks.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-ui-sm max-[480px]:min-w-[570px]">
            <thead><tr><th className={th} scope="col">Tarefa</th><th className={th} scope="col">Responsável</th><th className={th} scope="col">Status</th><th className={th} scope="col">Desenvolvimento</th></tr></thead>
            <tbody>{data.recentTasks.map(task => <tr className="[&:last-child>td]:border-b-0" key={task.id}>
              <td className={`${cell} max-w-[460px] font-semibold [overflow-wrap:anywhere]`}><TaskLink taskId={task.id} name={task.name} projectId={projectId} title="Abrir a tarefa" className={cellLink}>{task.name}</TaskLink></td>
              <td className={cell} title={task.responsible ?? undefined}><TasksLink projectId={projectId} filters={{ responsible: responsibleFilterValue(task.responsible ?? '') }} title="Ver as tarefas deste responsável" className={cellLink}>{displayResponsible(task.responsible)}</TasksLink></td>
              <td className={cell}><TasksLink projectId={projectId} filters={{ status: task.status }} title="Ver as tarefas neste status" className={`inline-flex items-center gap-1.5 whitespace-nowrap ${cellLink}`}><span className={`size-[7px] rounded-[50%] ${dotTones[statusTone[task.status] ?? 'muted'] ?? dotTones.muted}`} aria-hidden="true" />{statusLabels[task.status] ?? task.status}</TasksLink></td>
              <td className={cell}>{task.developmentTimeMs > 0 ? formatDuration(task.developmentTimeMs) : '—'}</td>
            </tr>)}</tbody>
          </table></div> : <p className={emptyInline}>Nenhuma tarefa para exibir.</p>}
        </section>
>>>>>>> 9c6390edb4c0782932252fa27bc56fc1c607f84e
      </div >
    </>}
<ProjectMemoryPanel key={projectId} token={token} projectId={projectId} />
  </section >;
}
