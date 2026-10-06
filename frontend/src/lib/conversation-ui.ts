import { plainText } from './labels';

/** O título da conversa costuma vir como "Task: nome da tarefa"; o prefixo só atrapalha a leitura. */
export function stripTaskPrefix(title?: string | null) {
  return (title ?? '').replace(/^\s*task\s*:\s*/i, '').trim();
}

/** Resumo de até ~60 caracteres para o título do critério (primeira frase, sem Markdown). */
export function shortCriterionTitle(text: string, max = 60) {
  const plain = plainText(text, 400);
  if (!plain) return 'Critério sem texto';
  const firstSentence = plain.split(/(?<=[.!?;:])\s+/)[0] || plain;
  if (firstSentence.length <= max) return firstSentence.replace(/[.;:]$/, '');
  const cut = firstSentence.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export type CriteriaFilter = 'all' | 'pending' | 'done';

export function filterCriteria<T extends { done: boolean }>(items: T[], filter: CriteriaFilter) {
  return filter === 'all' ? items : items.filter(item => filter === 'done' ? item.done : !item.done);
}

export type ConversationPhase = 1 | 2 | 3 | 4;

export const phaseLabels = ['Esclarecer', 'Proposta', 'Autorização', 'Execução'] as const;

/**
 * Fase da conversa: sem proposta → 1 (esclarecer); proposta aguardando o humano → 3; proposta autorizada → 4.
 * A fase 2 ("Proposta") é a etapa em que a IA a elabora e aparece sempre como concluída quando a 3 começa.
 */
export function conversationPhase(proposals: Array<{ status: string; stale?: boolean }>, jobs: Array<{ status: string }> = []): ConversationPhase {
  if (proposals.some(proposal => proposal.status === 'approved') || jobs.some(job => ['running', 'reserved', 'completed'].includes(job.status))) return 4;
  if (proposals.some(proposal => proposal.status === 'pending' && !proposal.stale)) return 3;
  return 1;
}

export function suggestionsFor(task: { name: string } | null | undefined, criteriaCount: number) {
  const criteria = criteriaCount === 1 ? 'do critério' : `dos ${criteriaCount} critérios`;
  return task ? [
    criteriaCount > 0 ? `Revisar as evidências ${criteria} desta tarefa` : 'Sugerir critérios de aceite objetivos para esta tarefa',
    'Listar riscos de regressão desta mudança',
    'Propor um plano de execução em etapas',
    'Explicar as decisões e alternativas consideradas'
  ] : [
    'Quero criar uma nova tarefa. Vou descrever o objetivo.',
    'Resumir o que está em revisão neste projeto',
    'Quais tarefas estão bloqueadas e por quê?',
    'Ajudar a quebrar uma feature em tarefas de back e front'
  ];
}

export const jobStatusLabel = (job: { status: string; failed: boolean }) => job.failed ? 'Falha na execução'
  : job.status === 'waiting_human' ? 'Aguardando autorização'
    : job.status === 'completed' ? 'Enviado para revisão'
      : job.status === 'queued' ? 'Na fila'
        : job.status === 'running' || job.status === 'reserved' ? 'Em execução'
          : job.status === 'blocked' ? 'Bloqueado' : job.status;

/** Texto de atividade da lista: "Não lida", "Lida · há 1 h" ou "Sem mensagens ainda". */
export function activityText(unreadCount: number, lastActivityAt: string | null | undefined, relative: (value?: string | null) => string) {
  if (unreadCount > 0) return 'Não lida';
  return lastActivityAt ? `Lida · ${relative(lastActivityAt)}` : 'Sem mensagens ainda';
}
