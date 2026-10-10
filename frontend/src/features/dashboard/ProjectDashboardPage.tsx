import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { areaLabel } from '../../lib/labels';
import { statusLabels, statusTone } from '../tasks/status';
import { buttonSecondary, eyebrow, textButton } from '../../components/ui/classes';
import { TaskLink, TasksLink } from '../../components/ui/Links';
import { areaFilterValue, monthFilters, periodFilters, responsibleFilterValue, type TaskLinkFilters } from './dashboard-links';
import { displayResponsible, formatDuration, formatPercent, periodStart, type DashboardPeriod as Period } from './dashboard-format';
import { ProjectMemoryPanel } from './ProjectMemoryPanel';

const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const barRow = 'grid items-center gap-[9px] min-w-0 text-ui-xs max-[480px]:gap-[6px]';
const barLabel = 'truncate text-ink-2';
const barTrack = 'block h-2 overflow-hidden rounded-[99px] bg-canvas';
const barFill = 'block h-full min-w-0 rounded-[inherit]';
const fillTones: Record<string, string> = { blue: 'bg-tone-blue', green: 'bg-tone-green', amber: 'bg-tone-amber' };
const dotTones: Record<string, string> = { muted: 'bg-muted-strong', blue: 'bg-tone-blue', green: 'bg-tone-green', amber: 'bg-tone-amber', red: 'bg-tone-red' };
const metric = 'grid min-w-0 content-start gap-1.5 rounded-ui-md border border-line bg-surface px-4 py-[15px] no-underline shadow-[0_1px_2px_#1720330a] transition hover:border-focus hover:shadow-[0_2px_8px_#1720331a] max-[480px]:p-3';
const rowLink = '-mx-1.5 -my-0.5 rounded-ui-sm px-1.5 py-0.5 no-underline transition-colors hover:bg-canvas';
const cellLink = 'no-underline hover:text-tone-blue hover:underline';
const panel = 'min-w-0 rounded-ui-md border border-line bg-surface px-[18px] py-4 max-[480px]:px-3 max-[480px]:py-[14px]';
const panelHeading = 'mb-[15px] flex justify-between gap-3 [align-items:start]';
const panelTitle = 'text-ui-md font-bold text-ink';
const panelSubtitle = 'mt-1 text-ui-xs text-muted-strong';
const th = 'border-b border-b-line px-[9px] py-2 text-ui-xs font-semibold whitespace-nowrap text-muted-strong';
const cell = 'border-b border-b-line px-[9px] py-[11px] text-ink-2';

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
  status: string;
  area: string | null;
  responsible: string | null;
  createdAt: string;
  updatedAt: string;
  developmentTimeMs: number;
};
type ProjectDashboard = {
  period: { from: string | null; to: string; basis: 'createdAt' };
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
  if (!items.length) return <p className={emptyInline}>Nenhuma tarefa neste período.</p>;
  const maximum = Math.max(1, ...items.map(item => item.count));
  return <div className="grid gap-[11px]" role="list" aria-label={title}>
    {items.map(item => <div role="listitem" key={item.key || 'empty'}>
      <TasksLink projectId={projectId} filters={filtersFor(item)} title={`Ver ${item.count} tarefa(s): ${responsible ? displayResponsible(item.key) : item.label}`} className={`${barRow} ${rowLink} grid-cols-[minmax(90px,1.1fr)_minmax(50px,2fr)_34px] max-[480px]:grid-cols-[minmax(76px,1.15fr)_minmax(30px,1fr)_28px]`}>
        <span className={barLabel}>{responsible ? displayResponsible(item.key) : item.label}</span>
        <span className={barTrack} aria-hidden="true"><span className={`${barFill} ${fillTones[tone] ?? fillTones.blue}`} style={{ width: `${Math.max(item.count ? 4 : 0, item.count / maximum * 100)}%` }} /></span>
        <strong className="text-right text-ink-2 tabular-nums">{item.count}</strong>
      </TasksLink>
    </div>)}
  </div>;
}

function DevelopmentTrend({ items, projectId, from }: { items: ProjectDashboard['trendByMonth']; projectId: string; from?: string }) {
  const visible = items.slice(-12);
  if (!visible.length) return <p className={emptyInline}>Ainda não há histórico de desenvolvimento para exibir.</p>;
  const maximum = Math.max(1, ...visible.map(item => item.averageDevelopmentTimeMs ?? 0));
  return <div className="grid gap-[11px]" role="list" aria-label="Tempo médio de desenvolvimento por mês">
    {visible.map(item => <div role="listitem" key={item.month}>
      <TasksLink projectId={projectId} filters={monthFilters(item.month, from)} title={`Ver as ${item.taskCount} tarefa(s) criadas em ${monthLabel(item.month)}`} className={`${barRow} ${rowLink} grid-cols-[50px_minmax(40px,1fr)_minmax(86px,auto)] max-[480px]:grid-cols-[40px_minmax(24px,1fr)_minmax(74px,auto)]`}>
        <span className={barLabel}>{monthLabel(item.month)}</span>
        <span className={barTrack} aria-hidden="true"><span className={`${barFill} bg-focus`} style={{ width: `${item.averageDevelopmentTimeMs == null ? 0 : Math.max(4, item.averageDevelopmentTimeMs / maximum * 100)}%` }} /></span>
        <span className="grid text-right text-ink-2 tabular-nums">{formatDuration(item.averageDevelopmentTimeMs)}<small className="text-[10px] text-muted-strong">{item.developmentSampleCount} tarefa(s)</small></span>
      </TasksLink>
    </div>)}
  </div>;
}

export function ProjectDashboardPage({ token, nonce, projectId }: { token: string; nonce: string; projectId: string }) {
  const [period, setPeriod] = useState<Period>('30d');
  const from = useMemo(() => periodStart(period), [period]);
  const dashboardQuery = useQuery({
    queryKey: ['project-dashboard', nonce, projectId, period],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => query<ProjectDashboard>(token, 'get_project_dashboard', { projectId, ...(from ? { from } : {}) })
  });
  const data = dashboardQuery.data;
  const inPeriod = periodFilters(from);
  const counts = new Map<string, number>((data?.byStatus ?? []).map(item => [item.status, item.count] as const));
  const statusItems = (data?.byStatus ?? []).map(item => ({
    key: item.status,
    label: statusLabels[item.status] ?? item.status,
    count: item.count
  }));
  const areaItems = (data?.byArea ?? []).map(item => ({ ...item, label: areaLabel(item.key || null) }));

  return <section className="grid gap-4" aria-labelledby="dashboard-title">
    <div className="mb-[5px] flex justify-between gap-5 [align-items:end] max-[720px]:flex-col max-[720px]:[align-items:start]">
      <div>
        <p className={eyebrow}>ANÁLISE DO PROJETO</p>
        <h1 id="dashboard-title" className="mb-1.5 font-display text-[length:clamp(21px,2vw,27px)] leading-[normal] font-extrabold tracking-[-.045em]">Dashboard do projeto</h1>
        <p className="text-ui-sm text-muted-strong">Tarefas criadas no período selecionado.</p>
      </div>
      <div className="flex gap-[9px] [align-items:end] max-[720px]:w-full">
        <label className="grid gap-[5px] text-ui-xs text-muted-strong max-[720px]:flex-1">Período
          <select className="min-h-9 min-w-[158px] rounded-ui-sm border border-line-strong bg-surface px-[10px] text-ink max-[720px]:w-full" value={period} onChange={event => setPeriod(event.target.value as Period)}>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="year">Este ano</option>
            <option value="all">Todo o período</option>
          </select>
        </label>
        <button type="button" className={buttonSecondary} onClick={() => void dashboardQuery.refetch()} disabled={dashboardQuery.isFetching}>
          {dashboardQuery.isFetching ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
    </div>

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

      {data.totalTasks === 0 && <p className="rounded-ui-sm border border-dashed border-line-strong px-[14px] py-3 text-ui-sm text-muted-strong" role="status">Não há tarefas criadas neste período. Escolha outro período para consultar o projeto.</p>}

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[14px] max-[720px]:grid-cols-[1fr]">
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
      </div>
    </>}
    <ProjectMemoryPanel key={projectId} token={token} projectId={projectId} />
  </section>;
}
