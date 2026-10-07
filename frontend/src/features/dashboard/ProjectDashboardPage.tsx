import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { areaLabel } from '../../lib/labels';
import { statusLabels, statusTone } from '../tasks/status';
import { buttonSecondary, eyebrow } from '../../components/ui/classes';

const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const barRow = 'grid items-center gap-[9px] min-w-0 text-ui-xs max-[480px]:gap-[6px]';
const barLabel = 'truncate text-ink-2';
const barTrack = 'block h-2 overflow-hidden rounded-[99px] bg-canvas';
const barFill = 'block h-full min-w-0 rounded-[inherit]';
const fillTones: Record<string, string> = { blue: 'bg-tone-blue', green: 'bg-tone-green', amber: 'bg-tone-amber' };
const dotTones: Record<string, string> = { muted: 'bg-muted-strong', blue: 'bg-tone-blue', green: 'bg-tone-green', amber: 'bg-tone-amber', red: 'bg-tone-red' };
const metric = 'grid min-w-0 content-start gap-1.5 rounded-ui-md border border-line bg-surface px-4 py-[15px] shadow-[0_1px_2px_#1720330a] max-[480px]:p-3';
const panel = 'min-w-0 rounded-ui-md border border-line bg-surface px-[18px] py-4 max-[480px]:px-3 max-[480px]:py-[14px]';
const panelHeading = 'mb-[15px] flex justify-between gap-3 [align-items:start]';
const panelTitle = 'text-ui-md font-bold text-ink';
const panelSubtitle = 'mt-1 text-ui-xs text-muted-strong';
const th = 'border-b border-b-line px-[9px] py-2 text-ui-xs font-semibold whitespace-nowrap text-muted-strong';
const cell = 'border-b border-b-line px-[9px] py-[11px] text-ink-2';

type CountItem = { key: string; label: string; count: number };
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
  byStatus: Array<{ status: string; count: number }>;
  byResponsible: CountItem[];
  byArea: CountItem[];
  development: { totalTimeMs: number; averageTimeMs: number | null; sampleCount: number };
  trendByMonth: Array<{ month: string; taskCount: number; developmentSampleCount: number; averageDevelopmentTimeMs: number | null }>;
  recentTasks: DashboardTask[];
};
type Period = '30d' | '90d' | 'year' | 'all';

function periodStart(period: Period) {
  if (period === 'all') return undefined;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (period === '30d') date.setDate(date.getDate() - 29);
  if (period === '90d') date.setDate(date.getDate() - 89);
  if (period === 'year') date.setMonth(0, 1);
  return date.toISOString();
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

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
}

function DistributionChart({ title, items, tone = 'blue', responsible = false }: { title: string; items: CountItem[]; tone?: string; responsible?: boolean }) {
  if (!items.length) return <p className={emptyInline}>Nenhuma tarefa neste período.</p>;
  const maximum = Math.max(1, ...items.map(item => item.count));
  return <div className="grid gap-[11px]" role="list" aria-label={title}>
    {items.map(item => <div className={`${barRow} grid-cols-[minmax(90px,1.1fr)_minmax(50px,2fr)_34px] max-[480px]:grid-cols-[minmax(76px,1.15fr)_minmax(30px,1fr)_28px]`} role="listitem" key={item.key || 'empty'} title={responsible && item.key ? item.key : undefined}>
      <span className={barLabel}>{responsible ? displayResponsible(item.key) : item.label}</span>
      <span className={barTrack} aria-hidden="true"><span className={`${barFill} ${fillTones[tone] ?? fillTones.blue}`} style={{ width: `${Math.max(item.count ? 4 : 0, item.count / maximum * 100)}%` }} /></span>
      <strong className="text-right text-ink-2 tabular-nums">{item.count}</strong>
    </div>)}
  </div>;
}

function DevelopmentTrend({ items }: { items: ProjectDashboard['trendByMonth'] }) {
  const visible = items.slice(-12);
  if (!visible.length) return <p className={emptyInline}>Ainda não há histórico de desenvolvimento para exibir.</p>;
  const maximum = Math.max(1, ...visible.map(item => item.averageDevelopmentTimeMs ?? 0));
  return <div className="grid gap-[11px]" role="list" aria-label="Tempo médio de desenvolvimento por mês">
    {visible.map(item => <div className={`${barRow} grid-cols-[50px_minmax(40px,1fr)_minmax(86px,auto)] max-[480px]:grid-cols-[40px_minmax(24px,1fr)_minmax(74px,auto)]`} role="listitem" key={item.month}>
      <span className={barLabel}>{monthLabel(item.month)}</span>
      <span className={barTrack} aria-hidden="true"><span className={`${barFill} bg-focus`} style={{ width: `${item.averageDevelopmentTimeMs == null ? 0 : Math.max(4, item.averageDevelopmentTimeMs / maximum * 100)}%` }} /></span>
      <span className="grid text-right text-ink-2 tabular-nums">{formatDuration(item.averageDevelopmentTimeMs)}<small className="text-[10px] text-muted-strong">{item.developmentSampleCount} tarefa(s)</small></span>
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
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-3 max-[960px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[480px]:gap-2" aria-label="Indicadores principais">
        <article className={metric}><span className="text-ui-sm text-muted-strong">Total de tarefas</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{data.totalTasks}</strong><small className="text-ui-xs text-muted-strong">no período selecionado</small></article>
        <article className={metric}><span className="text-ui-sm text-muted-strong">Em execução</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{counts.get('em_execucao') ?? 0}</strong><small className="text-ui-xs text-muted-strong">tarefas ativas agora</small></article>
        <article className={metric}><span className="text-ui-sm text-muted-strong">Concluídas</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{counts.get('concluida') ?? 0}</strong><small className="text-ui-xs text-muted-strong">status atual</small></article>
        <article className={metric}><span className="text-ui-sm text-muted-strong">Tempo médio de desenvolvimento</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold tracking-[-.03em] text-ink max-[480px]:text-[20px]">{formatDuration(data.development.averageTimeMs)}</strong><small className="text-ui-xs text-muted-strong">{data.development.sampleCount} tarefa(s) com tempo registrado</small></article>
      </div>

      {data.totalTasks === 0 && <p className="rounded-ui-sm border border-dashed border-line-strong px-[14px] py-3 text-ui-sm text-muted-strong" role="status">Não há tarefas criadas neste período. Escolha outro período para consultar o projeto.</p>}

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[14px] max-[720px]:grid-cols-[1fr]">
        <section className={panel} aria-labelledby="dashboard-status-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-status-title">Tarefas por status</h2><p className={panelSubtitle}>Distribuição atual</p></div></div>
          <DistributionChart title="Quantidade de tarefas por status" items={statusItems} tone="blue" />
        </section>
        <section className={panel} aria-labelledby="dashboard-owner-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-owner-title">Tarefas por responsável</h2><p className={panelSubtitle}>Inclui tarefas sem responsável</p></div></div>
          <DistributionChart title="Quantidade de tarefas por responsável" items={data.byResponsible} tone="green" responsible />
        </section>
        <section className={panel} aria-labelledby="dashboard-area-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-area-title">Tarefas por área</h2><p className={panelSubtitle}>Distribuição do trabalho</p></div></div>
          <DistributionChart title="Quantidade de tarefas por área" items={areaItems} tone="amber" />
        </section>
        <section className={panel} aria-labelledby="dashboard-development-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-development-title">Tempo em desenvolvimento</h2><p className={panelSubtitle}>Média das tarefas criadas em cada mês</p></div></div>
          <DevelopmentTrend items={data.trendByMonth} />
          <p className="mt-[14px] text-ui-xs leading-normal text-muted-strong">Soma dos intervalos em “Em execução”; o período bloqueado fica fora do cálculo.</p>
        </section>
        <section className={`${panel} col-span-full max-[720px]:col-auto`} aria-labelledby="dashboard-recent-title">
          <div className={panelHeading}><div><h2 className={panelTitle} id="dashboard-recent-title">Tarefas recentes</h2><p className={panelSubtitle}>Responsável, status e duração em execução</p></div></div>
          {data.recentTasks.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-ui-sm max-[480px]:min-w-[570px]">
            <thead><tr><th className={th} scope="col">Tarefa</th><th className={th} scope="col">Responsável</th><th className={th} scope="col">Status</th><th className={th} scope="col">Desenvolvimento</th></tr></thead>
            <tbody>{data.recentTasks.map(task => <tr className="[&:last-child>td]:border-b-0" key={task.id}>
              <td className={`${cell} max-w-[460px] font-semibold [overflow-wrap:anywhere]`}>{task.name}</td>
              <td className={cell} title={task.responsible ?? undefined}>{displayResponsible(task.responsible)}</td>
              <td className={cell}><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`size-[7px] rounded-[50%] ${dotTones[statusTone[task.status] ?? 'muted'] ?? dotTones.muted}`} aria-hidden="true" />{statusLabels[task.status] ?? task.status}</span></td>
              <td className={cell}>{task.developmentTimeMs > 0 ? formatDuration(task.developmentTimeMs) : '—'}</td>
            </tr>)}</tbody>
          </table></div> : <p className={emptyInline}>Nenhuma tarefa para exibir.</p>}
        </section>
      </div>
    </>}
  </section>;
}
