import type { ReactNode } from 'react';
import { textButton } from '../../components/ui/classes';
import { IconDiff, IconMail, IconQuestion } from '../../components/ui/icons';

type Kpi = { id: string; label: string; value: ReactNode; hint: string; active: boolean; onClick: () => void; tone?: string; icon?: ReactNode; featured?: boolean; compact?: boolean };

const card = 'relative grid min-w-0 content-start gap-[3px] rounded-ui-md border text-left text-ink-2 transition-[border-color,box-shadow,transform] duration-150 ease-[ease]';
const cardHover = 'hover:border-[#c3caf5] hover:shadow-[0_4px_12px_#27336d14]';
const cardSurface = {
  idle: `border-line bg-white shadow-[0_1px_2px_#1720330a] ${cardHover}`,
  active: 'border-focus bg-[#f8f9ff] shadow-[0_0_0_2px_#3b4fd62e]',
  featuredIdle: `border-[#f0d9a8] bg-[linear-gradient(180deg,#fffaf0,#fff)] shadow-[0_1px_2px_#1720330a] ${cardHover}`,
  featuredActive: 'border-[#b97d14] bg-[#f8f9ff] shadow-[0_0_0_2px_#b97d1430]'
};
const valueBase = 'font-display font-bold leading-[1.1] tracking-[-.04em]';

function KpiButton({ kpi }: { kpi: Kpi }) {
  const surface = kpi.featured ? (kpi.active ? cardSurface.featuredActive : cardSurface.featuredIdle) : kpi.active ? cardSurface.active : cardSurface.idle;
  const size = kpi.compact ? 'p-3' : 'px-4 py-3';
  const scroll = kpi.featured ? 'max-[760px]:flex-[0_0_148px]' : 'max-[760px]:flex-[0_0_132px]';
  const valueTone = kpi.featured ? 'text-[30px] text-tone-amber max-[760px]:text-[26px]' : kpi.compact ? 'text-[20px] text-ink' : 'text-[22px] text-ink';
  return <button type="button" className={`${card} ${size} ${scroll} ${surface} max-[760px]:snap-start`} aria-pressed={kpi.active} title={kpi.hint} onClick={kpi.onClick}>
    <span className="inline-flex items-center gap-[5px] text-ui-xs font-bold text-muted-strong">{kpi.icon}{kpi.label}</span>
    <strong className={`${valueBase} ${valueTone}`}>{kpi.value}</strong>
    <small className={`${kpi.compact ? 'hidden' : 'max-[760px]:hidden'} text-[10.5px] leading-[1.35] text-muted-strong`}>{kpi.hint}</small>
  </button>;
}

const barClass = 'mb-4 grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-3 max-[1180px]:grid-cols-[minmax(0,1fr)] max-[760px]:gap-2';
const groupBase = 'grid gap-2 max-[760px]:flex max-[760px]:snap-x max-[760px]:snap-proximity max-[760px]:overflow-x-auto max-[760px]:pb-1';
const groupPrimary = `${groupBase} grid-cols-[1.25fr_repeat(3,1fr)] max-[760px]:grid-cols-[repeat(2,minmax(0,1fr))]`;
const groupAttention = `${groupBase} grid-cols-[repeat(3,1fr)] content-stretch min-[420px]:max-[760px]:grid-cols-[repeat(3,minmax(0,1fr))] max-[420px]:grid-cols-[repeat(2,minmax(0,1fr))]`;

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
    { id: 'questions', label: 'Perguntas abertas', icon: <IconQuestion size={13} />, value: syncValue(sync?.questions), hint: 'Perguntas dos agentes aguardando resposta', tone: 'blue', compact: true, active: flagFilter === 'questions', onClick: () => toggleFlag('questions') },
    { id: 'unread', label: 'Com novidades', icon: <IconMail size={13} />, value: syncValue(sync?.unread), hint: 'Tarefas com atividade que você ainda não leu', tone: 'amber', compact: true, active: flagFilter === 'unread', onClick: () => toggleFlag('unread') },
    { id: 'diff', label: 'Com diff Git', icon: <IconDiff size={13} />, value: syncValue(sync?.diff), hint: 'Tarefas com mudanças de código publicadas', tone: 'green', compact: true, active: flagFilter === 'diff', onClick: () => toggleFlag('diff') }
  ];
  return <section className={barClass} aria-label="Indicadores da fila de trabalho">
    <div className={groupPrimary} role="group" aria-label="Por status">{primary.map(kpi => <KpiButton key={kpi.id} kpi={kpi} />)}</div>
    <div className={groupAttention} role="group" aria-label="Pedem atenção" aria-busy={syncState === 'pending'}>
      {attention.map(kpi => <KpiButton key={kpi.id} kpi={kpi} />)}
      {syncState === 'error' && <button type="button" className={`${textButton} col-[1/-1] justify-self-start max-[760px]:flex-[0_0_auto]`} onClick={onSyncRetry}>Falha ao carregar · tentar novamente</button>}
    </div>
  </section>;
}
