import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { TasksLink } from '../../components/ui/Links';
import { buttonSecondary, eyebrow } from '../../components/ui/classes';
import { statusLabels, statusTone } from '../tasks/status';
import { displayResponsible, formatDuration, formatPercent, periodStart, type DashboardPeriod } from './dashboard-format';
import { periodFilters, responsibleFilterValue } from './dashboard-links';

const panel = 'min-w-0 rounded-ui-md border border-line bg-surface px-[18px] py-4 max-[480px]:px-3 max-[480px]:py-[14px]';
const panelTitle = 'text-ui-md font-bold text-ink';
const subtitle = 'mt-1 text-ui-xs text-muted-strong';
const cell = 'border-b border-b-line px-[9px] py-[11px] align-top text-ink-2';
const th = 'border-b border-b-line px-[9px] py-2 text-ui-xs font-semibold whitespace-nowrap text-muted-strong';
const card = 'grid min-w-0 content-start gap-1.5 rounded-ui-md border border-line bg-surface px-4 py-[15px] shadow-[0_1px_2px_#1720330a] max-[480px]:p-3';
const tones: Record<string, string> = { muted: 'bg-muted-strong', blue: 'bg-tone-blue', green: 'bg-tone-green', amber: 'bg-tone-amber', red: 'bg-tone-red' };

type StatusMetric = { status: string; count: number };
type DevelopmentMetric = { totalTimeMs: number; averageTimeMs: number | null; sampleCount: number; withoutSampleCount: number };
type ProjectMetric = {
  id: string;
  name: string;
  totalTasks: number;
  byStatus: StatusMetric[];
  completedCount: number;
  completionRate: number | null;
  development: DevelopmentMetric;
};
type ProjectContribution = {
  projectId: string;
  projectName: string;
  count: number;
  byStatus: StatusMetric[];
};
type ResponsibleMetric = {
  key: string;
  label: string;
  count: number;
  byStatus: StatusMetric[];
  completedCount: number;
  completionRate: number | null;
  averageDevelopmentTimeMs: number | null;
  developmentSampleCount: number;
  withoutDevelopmentSampleCount: number;
  byProject: ProjectContribution[];
};
type GlobalDashboard = {
  period: { from: string | null; to: string; basis: 'createdAt' };
  projectCount: number;
  totalTasks: number;
  byStatus: StatusMetric[];
  completedCount: number;
  completionRate: number | null;
  development: DevelopmentMetric;
  byResponsible: ResponsibleMetric[];
  projects: ProjectMetric[];
};

function StatusBadges({ items, projectId, from, responsibleKey }: { items: StatusMetric[]; projectId?: string; from?: string; responsibleKey?: string }) {
  const populated = items.filter(item => item.count > 0);
  if (!populated.length) return <span className="text-muted-strong">Sem tarefas</span>;
  return <div className="flex max-w-[450px] flex-wrap gap-1.5">
    {populated.map(item => {
      const content = <><span className={`size-[7px] shrink-0 rounded-full ${tones[statusTone[item.status] ?? 'muted'] ?? tones.muted}`} aria-hidden="true" />{statusLabels[item.status] ?? item.status} · {item.count}</>;
      const className = 'inline-flex items-center gap-1 rounded-ui-sm bg-canvas px-1.5 py-1 text-[10px] font-semibold text-ink-2 no-underline';
      const filters = { ...(responsibleKey === undefined ? {} : { responsible: responsibleFilterValue(responsibleKey) }), status: item.status, ...periodFilters(from) };
      return projectId
        ? <TasksLink key={item.status} projectId={projectId} filters={filters} title={`Ver ${item.count} tarefa(s)${responsibleKey === undefined ? '' : ` de ${displayResponsible(responsibleKey)}`} com status ${statusLabels[item.status] ?? item.status}`} className={`${className} hover:bg-tone-blue-bg hover:text-tone-blue`}>{content}</TasksLink>
        : <span key={item.status} className={className}>{content}</span>;
    })}
  </div>;
}

function ResponsibleProjects({ items, responsibleKey, from, onOpenProject }: { items: ProjectContribution[]; responsibleKey: string; from?: string; onOpenProject: (projectId: string) => void }) {
  if (!items.length) return <span className="text-muted-strong">Nenhum projeto</span>;
  return <details className="max-w-[360px]">
    <summary className="cursor-pointer text-tone-blue underline decoration-[#b9c1f5] underline-offset-2">Ver projetos e status ({items.length})</summary>
    <div className="mt-2 grid gap-2.5">
      {items.map(project => <div key={project.projectId} className="grid gap-1.5 rounded-ui-sm bg-canvas p-2">
        <button type="button" className="w-fit text-left text-ui-xs font-bold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2 hover:text-[#2a39ad]" onClick={() => onOpenProject(project.projectId)}>{project.projectName} · {project.count} tarefa(s)</button>
        <StatusBadges items={project.byStatus} projectId={project.projectId} from={from} responsibleKey={responsibleKey} />
        <TasksLink projectId={project.projectId} filters={{ responsible: responsibleFilterValue(responsibleKey), ...periodFilters(from) }} title={`Ver as tarefas de ${displayResponsible(responsibleKey)} em ${project.projectName}`} className="w-fit text-[10px] font-semibold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2">Tarefas deste responsável</TasksLink>
      </div>)}
    </div>
  </details>;
}

export function GlobalDashboardPage({ token, nonce, onOpenProject }: { token: string; nonce: string; onOpenProject: (projectId: string) => void }) {
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const from = useMemo(() => periodStart(period), [period]);
  const dashboardQuery = useQuery({
    queryKey: ['global-dashboard', nonce, period],
    enabled: Boolean(token && nonce),
    queryFn: () => query<GlobalDashboard>(token, 'get_global_dashboard', from ? { from } : {})
  });
  const data = dashboardQuery.data;
  const activeStatuses = (data?.byStatus ?? []).filter(item => item.count > 0);
  const maximumStatus = Math.max(1, ...activeStatuses.map(item => item.count));

  return <section className="grid gap-4" aria-labelledby="global-dashboard-title">
    <div className="mb-[5px] flex justify-between gap-5 [align-items:end] max-[720px]:flex-col max-[720px]:[align-items:start]">
      <div><p className={eyebrow}>DESEMPENHO DO WORKSPACE</p><h1 id="global-dashboard-title" className="mb-1.5 font-display text-[length:clamp(21px,2vw,27px)] leading-[normal] font-extrabold tracking-[-.045em]">Visão geral dos projetos</h1><p className="text-ui-sm text-muted-strong">Projetos acessíveis e tarefas criadas no período selecionado.</p></div>
      <div className="flex gap-[9px] [align-items:end] max-[720px]:w-full">
        <label className="grid gap-[5px] text-ui-xs text-muted-strong max-[720px]:flex-1">Período
          <select className="min-h-9 min-w-[158px] rounded-ui-sm border border-line-strong bg-surface px-[10px] text-ink max-[720px]:w-full" value={period} onChange={event => setPeriod(event.target.value as DashboardPeriod)}>
            <option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option><option value="year">Este ano</option><option value="all">Todo o período</option>
          </select>
        </label>
        <button type="button" className={buttonSecondary} onClick={() => void dashboardQuery.refetch()} disabled={dashboardQuery.isFetching}>{dashboardQuery.isFetching ? 'Atualizando…' : 'Atualizar'}</button>
      </div>
    </div>

    {dashboardQuery.isPending && <div className="py-2"><Skeleton rows={6} label="Carregando indicadores dos projetos…" /></div>}
    {dashboardQuery.isError && <ErrorNotice error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} retrying={dashboardQuery.isFetching} title="Não foi possível carregar os indicadores" />}
    {data && <>
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))] gap-3 max-[960px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[480px]:gap-2" aria-label="Indicadores gerais">
        <div className={card}><span className="text-ui-sm text-muted-strong">Projetos acessíveis</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold text-ink">{data.projectCount}</strong><small className="text-ui-xs text-muted-strong">incluídos nesta visão</small></div>
        <div className={card}><span className="text-ui-sm text-muted-strong">Tarefas</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold text-ink">{data.totalTasks}</strong><small className="text-ui-xs text-muted-strong">criadas no período</small></div>
        <div className={card}><span className="text-ui-sm text-muted-strong">Concluídas</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold text-ink">{data.completedCount}</strong><small className="text-ui-xs text-muted-strong">status atual</small></div>
        <div className={card}><span className="text-ui-sm text-muted-strong">Taxa de conclusão</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold text-ink">{formatPercent(data.completionRate)}</strong><small className="text-ui-xs text-muted-strong">concluídas ÷ não canceladas</small></div>
        <div className={card}><span className="text-ui-sm text-muted-strong">Tempo médio em execução</span><strong className="text-[length:clamp(20px,2vw,25px)] font-bold text-ink">{formatDuration(data.development.averageTimeMs)}</strong><small className="text-ui-xs text-muted-strong">{data.development.sampleCount} com tempo · {data.development.withoutSampleCount} sem amostra</small></div>
      </div>
      <p className="-mt-2 text-ui-xs text-muted-strong">A taxa exclui tarefas canceladas do cálculo. O período filtra tarefas pela data de criação; tempos usam os intervalos em “Em execução”.</p>
      {data.projectCount === 0 && <p className="rounded-ui-sm border border-dashed border-line-strong px-[14px] py-3 text-ui-sm text-muted-strong" role="status">Nenhum projeto acessível para esta credencial.</p>}
      {data.projectCount > 0 && data.totalTasks === 0 && <p className="rounded-ui-sm border border-dashed border-line-strong px-[14px] py-3 text-ui-sm text-muted-strong" role="status">Nenhuma tarefa criada neste período. Os projetos continuam listados para consulta.</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-[14px] max-[850px]:grid-cols-1">
        <section className={panel} aria-labelledby="global-status-title">
          <h2 id="global-status-title" className={panelTitle}>Distribuição por status</h2><p className={subtitle}>Situação atual das tarefas criadas no período.</p>
          {activeStatuses.length ? <div className="mt-4 grid gap-3" role="list" aria-label="Tarefas por status">{activeStatuses.map(item => <div key={item.status} role="listitem" className="grid grid-cols-[minmax(95px,auto)_minmax(60px,1fr)_36px] items-center gap-2 text-ui-xs"><span className="truncate text-ink-2">{statusLabels[item.status] ?? item.status}</span><span className="h-2 overflow-hidden rounded-full bg-canvas" aria-hidden="true"><span className={`block h-full rounded-full ${tones[statusTone[item.status] ?? 'muted'] ?? tones.muted}`} style={{ width: `${Math.max(4, item.count / maximumStatus * 100)}%` }} /></span><strong className="text-right tabular-nums text-ink-2">{item.count}</strong></div>)}</div> : <p className="mt-4 rounded-ui-sm border border-dashed border-line-strong px-3 py-3 text-ui-xs text-muted-strong">Sem tarefas para distribuir por status.</p>}
        </section>

        <section className={panel} aria-labelledby="global-projects-title">
          <h2 id="global-projects-title" className={panelTitle}>Comparação por projeto</h2><p className={subtitle}>Selecione um projeto para abrir seu dashboard detalhado.</p>
          {data.projects.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[690px] border-collapse text-left text-ui-xs"><thead><tr><th className={th} scope="col">Projeto</th><th className={th} scope="col">Tarefas</th><th className={th} scope="col">Status</th><th className={th} scope="col">Conclusão</th><th className={th} scope="col">Tempo médio em execução</th></tr></thead>
            <tbody>{data.projects.map(project => <tr key={project.id} className="[&:last-child>td]:border-b-0">
              <td className={`${cell} min-w-[135px]`}><button type="button" className="text-left font-semibold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2 hover:text-[#2a39ad]" onClick={() => onOpenProject(project.id)}>{project.name}</button><small className="mt-1 block text-muted-strong">Abrir dashboard →</small></td>
              <td className={cell}><strong>{project.totalTasks}</strong><small className="mt-1 block text-muted-strong">{project.completedCount} concluídas</small></td>
              <td className={cell}><StatusBadges items={project.byStatus} projectId={project.id} from={from} /></td>
              <td className={cell}><strong>{formatPercent(project.completionRate)}</strong><small className="mt-1 block text-muted-strong">não canceladas</small></td>
              <td className={cell}><strong>{formatDuration(project.development.averageTimeMs)}</strong><small className="mt-1 block text-muted-strong">{project.development.sampleCount} com tempo · {project.development.withoutSampleCount} sem amostra</small></td>
            </tr>)}</tbody>
          </table></div> : <p className="mt-4 rounded-ui-sm border border-dashed border-line-strong px-3 py-3 text-ui-xs text-muted-strong">Nenhum projeto acessível.</p>}
        </section>
      </div>

      <section className={panel} aria-labelledby="global-responsibles-title">
        <h2 id="global-responsibles-title" className={panelTitle}>Desempenho por responsável</h2><p className={subtitle}>Totais agregados; abra “Ver projetos e status” para navegar às tarefas dentro de cada projeto. Inclui Sem responsável.</p>
        {data.byResponsible.length ? <div className="mt-3 max-h-[680px] overflow-auto rounded-ui-sm border border-line"><table className="w-full min-w-[840px] border-collapse text-left text-ui-xs"><thead className="sticky top-0 bg-surface"><tr><th className={th} scope="col">Responsável</th><th className={th} scope="col">Tarefas</th><th className={th} scope="col">Status</th><th className={th} scope="col">Concluídas</th><th className={th} scope="col">Tempo médio em execução</th><th className={th} scope="col">Projetos e tarefas</th></tr></thead>
          <tbody>{data.byResponsible.map(item => <tr key={item.key || 'unassigned'} className="[&:last-child>td]:border-b-0">
            <td className={`${cell} font-semibold`}>{displayResponsible(item.key)}{item.key && <small className="mt-1 block font-normal text-muted-strong">{item.key}</small>}</td>
            <td className={cell}><strong>{item.count}</strong></td>
            <td className={cell}><StatusBadges items={item.byStatus} /></td>
            <td className={cell}><strong>{item.completedCount} · {formatPercent(item.completionRate)}</strong><small className="mt-1 block text-muted-strong">sobre as não canceladas</small></td>
            <td className={cell}><strong>{formatDuration(item.averageDevelopmentTimeMs)}</strong><small className="mt-1 block text-muted-strong">{item.developmentSampleCount} com tempo · {item.withoutDevelopmentSampleCount} sem amostra</small></td>
            <td className={cell}><ResponsibleProjects items={item.byProject} responsibleKey={item.key} from={from} onOpenProject={onOpenProject} /></td>
          </tr>)}</tbody>
        </table></div> : <p className="mt-4 rounded-ui-sm border border-dashed border-line-strong px-3 py-3 text-ui-xs text-muted-strong" role="status">Nenhum responsável com tarefas neste período.</p>}
      </section>
    </>}
  </section>;
}
