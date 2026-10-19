import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { buttonSecondary, eyebrow, textButton } from '../../components/ui/classes';
import { TaskLink, TasksLink } from '../../components/ui/Links';
import { ProjectMemoryPanel } from './ProjectMemoryPanel';
import { areaFilterValue, responsibleFilterValue, type TaskLinkFilters } from './dashboard-links';
import { statusLabels, statusTone } from '../tasks/status';
import { areaLabel } from '../../lib/labels';

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
  byStatus: Array<{ status: string; count: number }>;
  byResponsible: CountItem[];
  byArea: CountItem[];
  byFeature: FeatureCount[];
  development: { totalTimeMs: number; averageTimeMs: number | null; sampleCount: number };
  trendByPeriod: Array<{ period: string; taskCount: number; developmentSampleCount: number; averageDevelopmentTimeMs: number | null }>;
  recentTasks: DashboardTask[];
};
type ProjectDashboard = DashboardSummary & {
  scheduleSummary: { scheduledTaskCount: number; overdueTaskCount: number };
  schedule: ScheduleTask[];
};
type PortfolioProject = DashboardSummary & {
  projectId: string;
  projectName: string;
  scheduleSummary: { scheduledTaskCount: number; overdueTaskCount: number };
};
type PortfolioDashboard = DashboardSummary & {
  totalProjects: number;
  projects: PortfolioProject[];
  schedule: ScheduleTask[];
};
type Granularity = 'day' | 'week' | 'month';
type View = 'portfolio' | 'project';

function localDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function initialRange() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 89);
  return { from: localDateInput(from), to: localDateInput(today) };
}

function toIso(value: string, end = false) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0));
  return date.toISOString();
}

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date);
}

function formatDuration(value?: number | null) {
  if (value == null) return '—';
  const days = value / 86_400_000;
  if (days < 1) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 3_600_000)} h`;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(days)} ${days < 2 ? 'dia' : 'dias'}`;
}

function displayResponsible(value?: string | null) {
  if (!value) return 'Sem responsável';
  return value.split('@')[0].split(/[._+\-\s]+/).filter(Boolean)
    .map(part => part[0].toLocaleUpperCase('pt-BR') + part.slice(1)).join(' ');
}

function periodLabel(value: string, granularity: Granularity) {
  if (granularity === 'week') {
    const [year, week] = value.split('-W');
    return `Sem. ${week}/${year}`;
  }
  const date = granularity === 'day' ? new Date(`${value}T00:00:00Z`) : new Date(`${value}-15T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  const options: Intl.DateTimeFormatOptions = granularity === 'day'
    ? { day: '2-digit', month: 'short', timeZone: 'UTC' }
    : { month: 'short', year: '2-digit', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('pt-BR', options).format(date);
}

function statusName(status: string) {
  return statusLabels[status] ?? status;
}

function taskFilters(from?: string, to?: string): TaskLinkFilters {
  return { ...(from ? { createdAfter: from.slice(0, 10) } : {}), ...(to ? { createdBefore: to.slice(0, 10) } : {}) };
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className={metric}><span className="text-ui-sm text-muted-strong">{label}</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{value}</strong><small className="text-ui-xs text-muted-strong">{detail}</small></div>;
}

function DistributionChart({ title, items, projectId, filtersFor, onOpenProject }: {
  title: string;
  items: CountItem[];
  projectId?: string;
  filtersFor?: (item: CountItem) => TaskLinkFilters;
  onOpenProject?: (projectId: string) => void;
}) {
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

    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_repeat(2,minmax(0,1.1fr))] items-end gap-2 rounded-ui-md border border-line bg-surface p-3 max-[900px]:grid-cols-3 max-[560px]:grid-cols-2">
      <div className="col-span-full flex flex-wrap gap-1.5">
        {(['30d', '90d', 'year', 'all'] as const).map(preset => <button className={`${textButton} !px-2 !py-1`} type="button" key={preset} onClick={() => setPreset(preset)}>{preset === '30d' ? '30 dias' : preset === '90d' ? '90 dias' : preset === 'year' ? 'Este ano' : 'Todo o período'}</button>)}
      </div>
      <label className="grid gap-[5px] text-ui-xs text-muted-strong">De<input className={control} type="date" value={range.from} max={range.to || undefined} onChange={event => setRange(current => ({ ...current, from: event.target.value }))} /></label>
      <label className="grid gap-[5px] text-ui-xs text-muted-strong">Até<input className={control} type="date" value={range.to} min={range.from || undefined} onChange={event => setRange(current => ({ ...current, to: event.target.value }))} /></label>
      <label className="grid gap-[5px] text-ui-xs text-muted-strong">Agrupar por<select className={control} value={granularity} onChange={event => setGranularity(event.target.value as Granularity)}><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select></label>
      <label className="grid gap-[5px] text-ui-xs text-muted-strong">Feature<select className={control} value={featureFilter} onChange={event => setFeatureFilter(event.target.value)}><option value="">Todas as features</option>{featureOptions.map(item => <option key={item.key} value={item.key}>{view === 'portfolio' ? item.label : item.label}</option>)}</select></label>
      <label className="grid gap-[5px] text-ui-xs text-muted-strong">Responsável<select className={control} value={responsibleFilter} onChange={event => setResponsibleFilter(event.target.value)}><option value="">Todos os responsáveis</option>{responsibleOptions.map(item => <option key={item.key || 'none'} value={item.key || '__none__'}>{item.label}</option>)}</select></label>
    </div>
    {!validRange && <p className="rounded-ui-sm border border-tone-red/30 bg-tone-red/5 px-3 py-2 text-ui-sm text-tone-red" role="alert">A data inicial precisa ser anterior ou igual à data final.</p>}
    <p className="text-ui-xs text-muted-strong">O período considera a data de criação das tarefas; o cronograma lista todas as tarefas com datas planejadas. Feature e responsável refinam agrupamentos e cronograma, enquanto os indicadores resumem o período completo.</p>
    {isPending && <div className="py-2"><Skeleton rows={6} label="Carregando indicadores e cronograma…" /></div>}
    {activeError && <ErrorNotice error={activeError} onRetry={retry} retrying={retrying} title={view === 'project' ? 'Não foi possível carregar o dashboard do projeto' : 'Não foi possível carregar o portfólio'} />}
    {view === 'portfolio' && portfolio && !portfolio.totalProjects && <p className={emptyInline} role="status">Nenhum projeto acessível para esta credencial.</p>}
    {view === 'project' && !projectId && !projectQuery.isPending && <p className={emptyInline} role="status">Selecione um projeto acessível para abrir o detalhe.</p>}

    {activeSummary && <>
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))] gap-3 max-[960px]:grid-cols-[repeat(3,minmax(0,1fr))] max-[600px]:grid-cols-2 max-[480px]:gap-2" aria-label="Indicadores principais">
        <MetricCard label={view === 'portfolio' ? 'Projetos acessíveis' : 'Projeto'} value={view === 'portfolio' ? (projectFilter ? '1' : portfolio?.totalProjects ?? 0) : currentProjectName ?? 'Selecionado'} detail={view === 'portfolio' ? (projectFilter ? 'no recorte atual' : 'no portfólio') : 'escopo atual'} />
        <MetricCard label="Tarefas" value={activeSummary.totalTasks} detail="criadas no período" />
        <MetricCard label="Concluídas" value={`${completionRate}%`} detail={`${completedCount} tarefa(s) concluída(s)`} />
        <MetricCard label="Com cronograma" value={scheduledCount} detail={`${overdueCount} atrasada(s) no recorte`} />
        <MetricCard label="Tempo médio em execução" value={formatDuration(activeSummary.development.averageTimeMs)} detail={`${activeSummary.development.sampleCount} tarefa(s) com histórico`} />
      </div>

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[14px] max-[720px]:grid-cols-[1fr]">
        <section className={panel} aria-labelledby="dashboard-trend-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-trend-title">Tendência por {granularity === 'day' ? 'dia' : granularity === 'week' ? 'semana' : 'mês'}</h2><p className={panelSubtitle}>Tarefas criadas e duração média dos intervalos em execução.</p></div></div><TrendChart items={activeSummary.trendByPeriod} granularity={granularity} /></section>
        <section className={panel} aria-labelledby="dashboard-status-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-status-title">Tarefas por status</h2><p className={panelSubtitle}>Distribuição no período selecionado.</p></div></div><DistributionChart title="Quantidade de tarefas por status" items={statusItems} projectId={view === 'project' ? projectId : undefined} filtersFor={item => ({ status: item.key, ...periodTaskFilters })} /></section>
      </div>

      {view === 'portfolio' && portfolio && <>
        <section className={panel} aria-labelledby="dashboard-projects-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-projects-title">Projetos do portfólio</h2><p className={panelSubtitle}>Compare volume, conclusão e risco de prazo. Selecione um projeto para abrir o detalhe.</p></div></div>
          {projectRows.length ? <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">{projectRows.map(item => {
            const done = item.byStatus.find(status => status.status === 'concluida')?.count ?? 0;
            const rate = item.totalTasks ? Math.round(done / item.totalTasks * 100) : 0;
            return <button type="button" key={item.projectId} onClick={() => openProject(item.projectId)} className="grid min-w-0 gap-2 rounded-ui-md border border-line bg-surface p-3 text-left transition hover:border-focus hover:shadow-[0_2px_8px_#1720331a]">
              <strong className="truncate text-ui-sm text-ink">{item.projectName}</strong><span className="text-ui-xs text-muted-strong">{item.totalTasks} tarefa(s) · {rate}% concluídas</span><span className="grid grid-cols-[1fr_auto] gap-2 text-ui-xs text-ink-2"><span>{item.scheduleSummary.scheduledTaskCount} no cronograma</span><span className={item.scheduleSummary.overdueTaskCount ? 'font-semibold text-tone-red' : 'text-muted-strong'}>{item.scheduleSummary.overdueTaskCount} atrasada(s)</span></span><span className="h-1.5 overflow-hidden rounded-full bg-canvas"><span className="block h-full rounded-full bg-tone-green" style={{ width: `${rate}%` }} /></span>
            </button>;
          })}</div> : <p className={emptyInline}>Nenhum projeto para o filtro atual.</p>}
        </section>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[14px] max-[720px]:grid-cols-[1fr]">
          <section className={panel} aria-labelledby="portfolio-feature-title"><div className={panelHeading}><div><h2 className={panelTitle} id="portfolio-feature-title">Tarefas por feature</h2><p className={panelSubtitle}>Inclui tarefas sem feature, com o projeto identificado.</p></div></div><DistributionChart title="Quantidade de tarefas por feature" items={featureItems.map(item => ({ ...item }))} onOpenProject={openProject} /></section>
          <section className={panel} aria-labelledby="portfolio-owner-title"><div className={panelHeading}><div><h2 className={panelTitle} id="portfolio-owner-title">Tarefas por responsável</h2><p className={panelSubtitle}>Inclui tarefas sem responsável.</p></div></div><DistributionChart title="Quantidade de tarefas por responsável" items={responsibleItems.map(item => ({ ...item, label: displayResponsible(item.key) }))} /></section>
        </div>
      </>}

      {view === 'project' && projectQuery.data && <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[14px] max-[720px]:grid-cols-[1fr]">
        <section className={panel} aria-labelledby="dashboard-feature-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-feature-title">Tarefas por feature</h2><p className={panelSubtitle}>Inclui tarefas sem feature.</p></div></div><DistributionChart title="Quantidade de tarefas por feature" items={featureItems.map(item => ({ ...item }))} projectId={projectId} filtersFor={item => ({ featureId: item.featureId ?? '', ...periodTaskFilters })} /></section>
        <section className={panel} aria-labelledby="dashboard-owner-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-owner-title">Tarefas por responsável</h2><p className={panelSubtitle}>Inclui tarefas sem responsável.</p></div></div><DistributionChart title="Quantidade de tarefas por responsável" items={responsibleItems.map(item => ({ ...item, label: displayResponsible(item.key) }))} projectId={projectId} filtersFor={item => ({ responsible: responsibleFilterValue(item.key), ...periodTaskFilters })} /></section>
        <section className={panel} aria-labelledby="dashboard-area-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-area-title">Tarefas por área</h2><p className={panelSubtitle}>Distribuição do trabalho.</p></div></div><DistributionChart title="Quantidade de tarefas por área" items={areaItems} projectId={projectId} filtersFor={item => ({ area: areaFilterValue(item.key), ...periodTaskFilters })} /></section>
      </div>}

      <section className={panel} aria-labelledby="dashboard-schedule-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-schedule-title">Cronograma planejado e linha do tempo real</h2><p className={panelSubtitle}>As datas planejadas são previsões; os eventos abaixo vêm do histórico real de status da tarefa.</p></div></div><ScheduleTimeline items={schedule} showProject={view === 'portfolio'} /></section>

      {view === 'project' && projectQuery.data && <section className={`${panel} col-span-full`} aria-labelledby="dashboard-recent-title"><div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-recent-title">Tarefas recentes</h2><p className={panelSubtitle}>Responsável, feature, status e tempo real em execução.</p></div></div>
        {projectQuery.data.recentTasks.length ? <div className="overflow-x-auto"><table className="w-full min-w-[660px] border-collapse text-left text-ui-sm"><thead><tr><th className={th} scope="col">Tarefa</th><th className={th} scope="col">Feature</th><th className={th} scope="col">Responsável</th><th className={th} scope="col">Status</th><th className={th} scope="col">Desenvolvimento</th></tr></thead><tbody>{projectQuery.data.recentTasks.map(task => <tr className="[&:last-child>td]:border-b-0" key={task.id}><td className={`${cell} max-w-[300px] [overflow-wrap:anywhere]`}><TaskLink taskId={task.id} name={task.name} projectId={projectId} className="font-semibold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2">{task.name}</TaskLink></td><td className={cell}>{projectQuery.data.byFeature.find(item => item.featureId === task.featureId)?.label ?? 'Sem feature'}</td><td className={cell}>{displayResponsible(task.responsible)}</td><td className={cell}>{statusName(task.status)}</td><td className={cell}>{formatDuration(task.developmentTimeMs)}</td></tr>)}</tbody></table></div> : <p className={emptyInline}>Nenhuma tarefa criada neste período.</p>}
      </section>}
    </>}
    {view === 'project' && <ProjectMemoryPanel key={projectId} token={token} projectId={projectId} />}
  </section>;
}
