import type { ReactNode } from 'react';
import { IconDiff, IconMail, IconQuestion } from '../../components/ui/icons';

type Kpi = { id: string; label: string; value: ReactNode; hint: string; active: boolean; onClick: () => void; tone?: string; icon?: ReactNode; featured?: boolean };

function KpiButton({ kpi }: { kpi: Kpi }) {
  return <button type="button" className={`kpi kpi-${kpi.tone ?? 'neutral'}${kpi.featured ? ' kpi-featured' : ''}${kpi.active ? ' active' : ''}`} aria-pressed={kpi.active} title={kpi.hint} onClick={kpi.onClick}>
    <span className="kpi-label">{kpi.icon}{kpi.label}</span>
    <strong className="kpi-value">{kpi.value}</strong>
    <small className="kpi-hint">{kpi.hint}</small>
  </button>;
}

export type TaskKpiBarProps = {
  counts: { total: number; running: number; review: number; done: number; checked: number };
  sync?: { questions: number; unread: number; diff: number };
  syncState: 'pending' | 'error' | 'ready';
  onSyncRetry: () => void;
  statusFilter: string;
  flagFilter: string;
  onStatus: (status: string) => void;
  onFlag: (flag: string) => void;
  onClear: () => void;
  noFilters: boolean;
};

export function TaskKpiBar({ counts, sync, syncState, onSyncRetry, statusFilter, flagFilter, onStatus, onFlag, onClear, noFilters }: TaskKpiBarProps) {
  const toggleStatus = (status: string) => onStatus(statusFilter === status ? 'todos' : status);
  const toggleFlag = (flag: string) => onFlag(flagFilter === flag ? '' : flag);
  const syncValue = (value: number | undefined) => syncState === 'ready' ? value ?? 0 : '—';
  const primary: Kpi[] = [
    { id: 'review', label: 'Em revisão', value: counts.review, hint: 'Aguardando sua conferência e aprovação', tone: 'amber', featured: true, active: statusFilter === 'em_revisao', onClick: () => toggleStatus('em_revisao') },
    { id: 'running', label: 'Em execução', value: counts.running, hint: 'Agentes trabalhando agora', tone: 'blue', active: statusFilter === 'em_execucao', onClick: () => toggleStatus('em_execucao') },
    { id: 'done', label: 'Concluídas', value: counts.done, hint: `${counts.checked} conferida(s)`, tone: 'green', active: statusFilter === 'concluida', onClick: () => toggleStatus('concluida') },
    { id: 'total', label: 'Total', value: counts.total, hint: 'Tarefas ativas do projeto', active: noFilters, onClick: onClear }
  ];
  const attention: Kpi[] = [
    { id: 'questions', label: 'Perguntas abertas', icon: <IconQuestion size={13} />, value: syncValue(sync?.questions), hint: 'Perguntas dos agentes aguardando resposta', tone: 'blue', active: flagFilter === 'questions', onClick: () => toggleFlag('questions') },
    { id: 'unread', label: 'Com novidades', icon: <IconMail size={13} />, value: syncValue(sync?.unread), hint: 'Tarefas com atividade que você ainda não leu', tone: 'amber', active: flagFilter === 'unread', onClick: () => toggleFlag('unread') },
    { id: 'diff', label: 'Com diff Git', icon: <IconDiff size={13} />, value: syncValue(sync?.diff), hint: 'Tarefas com mudanças de código publicadas', tone: 'green', active: flagFilter === 'diff', onClick: () => toggleFlag('diff') }
  ];
  return <section className="kpi-bar" aria-label="Indicadores da fila de trabalho">
    <div className="kpi-group kpi-group-primary" role="group" aria-label="Por status">{primary.map(kpi => <KpiButton key={kpi.id} kpi={kpi} />)}</div>
    <div className="kpi-group kpi-group-attention" role="group" aria-label="Pedem atenção" aria-busy={syncState === 'pending'}>
      {attention.map(kpi => <KpiButton key={kpi.id} kpi={kpi} />)}
      {syncState === 'error' && <button type="button" className="text-button kpi-retry" onClick={onSyncRetry}>Falha ao carregar · tentar novamente</button>}
    </div>
  </section>;
}
