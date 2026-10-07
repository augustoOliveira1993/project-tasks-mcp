import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { areaLabel } from '../../lib/labels';
import { statusLabels, statusTone } from '../tasks/status';
import './ProjectDashboardPage.css';

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
  if (!items.length) return <p className="empty-inline">Nenhuma tarefa neste período.</p>;
  const maximum = Math.max(1, ...items.map(item => item.count));
  return <div className="dashboard-bars" role="list" aria-label={title}>
    {items.map(item => <div className="dashboard-bar-row" role="listitem" key={item.key || 'empty'} title={responsible && item.key ? item.key : undefined}>
      <span className="dashboard-bar-label">{responsible ? displayResponsible(item.key) : item.label}</span>
      <span className="dashboard-bar-track" aria-hidden="true"><span className={`dashboard-bar-fill tone-${tone}`} style={{ width: `${Math.max(item.count ? 4 : 0, item.count / maximum * 100)}%` }} /></span>
      <strong className="dashboard-bar-count">{item.count}</strong>
    </div>)}
  </div>;
}

function DevelopmentTrend({ items }: { items: ProjectDashboard['trendByMonth'] }) {
  const visible = items.slice(-12);
  if (!visible.length) return <p className="empty-inline">Ainda não há histórico de desenvolvimento para exibir.</p>;
  const maximum = Math.max(1, ...visible.map(item => item.averageDevelopmentTimeMs ?? 0));
  return <div className="dashboard-trend" role="list" aria-label="Tempo médio de desenvolvimento por mês">
    {visible.map(item => <div className="dashboard-trend-row" role="listitem" key={item.month}>
      <span className="dashboard-trend-month">{monthLabel(item.month)}</span>
      <span className="dashboard-bar-track" aria-hidden="true"><span className="dashboard-bar-fill tone-purple" style={{ width: `${item.averageDevelopmentTimeMs == null ? 0 : Math.max(4, item.averageDevelopmentTimeMs / maximum * 100)}%` }} /></span>
      <span className="dashboard-trend-value">{formatDuration(item.averageDevelopmentTimeMs)}<small>{item.developmentSampleCount} tarefa(s)</small></span>
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

  return <section className="project-dashboard" aria-labelledby="dashboard-title">
    <div className="dashboard-heading">
      <div>
        <p className="eyebrow">ANÁLISE DO PROJETO</p>
        <h1 id="dashboard-title">Dashboard do projeto</h1>
        <p className="muted-text">Tarefas criadas no período selecionado.</p>
      </div>
      <div className="dashboard-controls">
        <label>Período
          <select value={period} onChange={event => setPeriod(event.target.value as Period)}>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="year">Este ano</option>
            <option value="all">Todo o período</option>
          </select>
        </label>
        <button type="button" className="button secondary" onClick={() => void dashboardQuery.refetch()} disabled={dashboardQuery.isFetching}>
          {dashboardQuery.isFetching ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
    </div>

    {dashboardQuery.isPending && <div className="dashboard-state"><Skeleton rows={6} label="Carregando dashboard…" /></div>}
    {dashboardQuery.isError && <ErrorNotice error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} retrying={dashboardQuery.isFetching} title="Não foi possível carregar o dashboard" />}
    {data && <>
      <div className="dashboard-metrics" aria-label="Indicadores principais">
        <article className="dashboard-metric"><span>Total de tarefas</span><strong>{data.totalTasks}</strong><small>no período selecionado</small></article>
        <article className="dashboard-metric"><span>Em execução</span><strong>{counts.get('em_execucao') ?? 0}</strong><small>tarefas ativas agora</small></article>
        <article className="dashboard-metric"><span>Concluídas</span><strong>{counts.get('concluida') ?? 0}</strong><small>status atual</small></article>
        <article className="dashboard-metric"><span>Tempo médio de desenvolvimento</span><strong>{formatDuration(data.development.averageTimeMs)}</strong><small>{data.development.sampleCount} tarefa(s) com tempo registrado</small></article>
      </div>

      {data.totalTasks === 0 && <p className="dashboard-empty" role="status">Não há tarefas criadas neste período. Escolha outro período para consultar o projeto.</p>}

      <div className="dashboard-chart-grid">
        <section className="dashboard-panel" aria-labelledby="dashboard-status-title">
          <div className="dashboard-panel-heading"><div><h2 id="dashboard-status-title">Tarefas por status</h2><p>Distribuição atual</p></div></div>
          <DistributionChart title="Quantidade de tarefas por status" items={statusItems} tone="blue" />
        </section>
        <section className="dashboard-panel" aria-labelledby="dashboard-owner-title">
          <div className="dashboard-panel-heading"><div><h2 id="dashboard-owner-title">Tarefas por responsável</h2><p>Inclui tarefas sem responsável</p></div></div>
          <DistributionChart title="Quantidade de tarefas por responsável" items={data.byResponsible} tone="green" responsible />
        </section>
        <section className="dashboard-panel" aria-labelledby="dashboard-area-title">
          <div className="dashboard-panel-heading"><div><h2 id="dashboard-area-title">Tarefas por área</h2><p>Distribuição do trabalho</p></div></div>
          <DistributionChart title="Quantidade de tarefas por área" items={areaItems} tone="amber" />
        </section>
        <section className="dashboard-panel" aria-labelledby="dashboard-development-title">
          <div className="dashboard-panel-heading"><div><h2 id="dashboard-development-title">Tempo em desenvolvimento</h2><p>Média das tarefas criadas em cada mês</p></div></div>
          <DevelopmentTrend items={data.trendByMonth} />
          <p className="dashboard-definition">Soma dos intervalos em “Em execução”; o período bloqueado fica fora do cálculo.</p>
        </section>
        <section className="dashboard-panel dashboard-panel-wide" aria-labelledby="dashboard-recent-title">
          <div className="dashboard-panel-heading"><div><h2 id="dashboard-recent-title">Tarefas recentes</h2><p>Responsável, status e duração em execução</p></div></div>
          {data.recentTasks.length ? <div className="dashboard-table-wrap"><table className="dashboard-table">
            <thead><tr><th scope="col">Tarefa</th><th scope="col">Responsável</th><th scope="col">Status</th><th scope="col">Desenvolvimento</th></tr></thead>
            <tbody>{data.recentTasks.map(task => <tr key={task.id}>
              <td className="dashboard-task-name">{task.name}</td>
              <td title={task.responsible ?? undefined}>{displayResponsible(task.responsible)}</td>
              <td><span className={`dashboard-status status-${statusTone[task.status] ?? 'muted'}`}><span aria-hidden="true" />{statusLabels[task.status] ?? task.status}</span></td>
              <td>{task.developmentTimeMs > 0 ? formatDuration(task.developmentTimeMs) : '—'}</td>
            </tr>)}</tbody>
          </table></div> : <p className="empty-inline">Nenhuma tarefa para exibir.</p>}
        </section>
      </div>
    </>}
  </section>;
}
