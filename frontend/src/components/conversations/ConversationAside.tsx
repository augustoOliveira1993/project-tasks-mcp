import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ApiRequestError, operationId, request } from '../../api';
import type { Task } from '../../api';
import { Badge } from '../ui/Badge';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconCheck } from '../ui/icons';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { errorMessage, formatDate } from '../../lib/format';
import { relativeTime } from '../../lib/labels';
import { buttonBase, textButton } from '../ui/classes';
import { filterCriteria, jobStatusLabel, shortCriterionTitle, type CriteriaFilter } from '../../lib/conversation-ui';
import { TaskMessageAuthor, taskMessageTypeLabel } from './ConversationParts';
import type { ConversationDetail, TaskActivity } from './conversation-types';

const sectionBase = 'grid min-w-0 border-b border-b-[#eef0f4] bg-white';
const sectionPlain = `${sectionBase} gap-2 px-4 py-3`;
const markButton = `${buttonBase} min-h-9 justify-self-start px-2.5`;
const markSecondary = `${markButton} border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`;
const markPrimary = `${markButton} border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const sectionHeading = 'font-display text-ui-sm leading-[normal] font-bold text-ink-2';
const summaryClass = 'cursor-pointer font-display text-ui-sm leading-[normal] font-bold text-ink-2';
const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const jobState = 'flex flex-wrap items-center gap-2';
const jobSmall = 'text-[9px] text-[#6e7b8f]';

export type ConversationAsideProps = {
  detail: ConversationDetail;
  taskContext: UseQueryResult<TaskActivity>;
  onOpenAdmin: () => void;
  tabs?: ReactNode;
  /** Necessários para marcar critérios direto da conversa. */
  token?: string;
  nonce?: string;
  projectId?: string;
  hasPendingProposal?: boolean;
  /** Cartão da tarefa vinculada (status, área, feature, link); exibido no topo do painel. */
  taskCard?: ReactNode;
  /** Painel oculto pelo botão do cabeçalho (só vale a partir de 1280px, onde ele é uma coluna). */
  collapsed?: boolean;
};

/** Coluna "Critérios da tarefa": resumo, barra segmentada, filtros e itens expansíveis. */
export function ConversationAside({ detail, taskContext, onOpenAdmin, tabs, token = '', nonce = '', projectId = '', hasPendingProposal = false, taskCard, collapsed = false }: ConversationAsideProps) {
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState<{ index: number; kind: 'success' | 'error'; message: string } | null>(null);
  const canMark = Boolean(token && projectId);
  const mark = useMutation({
    mutationFn: ({ index, complete, evidence }: { index: number; complete: boolean; evidence: string }) => request<{ task: Task }>(token, '/admin/tasks/acceptance', { body: {
      operationId: operationId(), projectId, taskId: taskContext.data!.task._id, version: taskContext.data!.task.version, criterionIndex: index, complete, evidence
    } }),
    onSuccess: async (result, { index, complete, evidence }) => {
      const taskId = taskContext.data!.task._id;
      client.setQueryData<TaskActivity>(['conversation-task-context', nonce, projectId, taskId], current => {
        if (!current) return current;
        const evidences = [...current.task.acceptanceEvidence];
        evidences[index] = complete ? evidence : null;
        return { ...current, task: { ...current.task, version: result.task.version, acceptanceProgress: result.task.acceptanceProgress ?? current.task.acceptanceProgress, acceptanceEvidence: evidences } };
      });
      setDrafts(current => { const next = { ...current }; delete next[index]; return next; });
      setFeedback({ index, kind: 'success', message: complete ? 'Critério marcado como atendido.' : 'Critério desmarcado.' });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['conversation', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['task-context', nonce, projectId, taskId] }),
        client.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] })
      ]);
    },
    onError: async (error, { index }) => {
      const conflict = error instanceof ApiRequestError && error.status === 409;
      setFeedback({ index, kind: 'error', message: conflict ? 'A tarefa mudou em outra ação. Recarreguei os critérios; confira e tente de novo.' : errorMessage(error) });
      await taskContext.refetch();
    }
  });
  const [filter, setFilter] = useState<CriteriaFilter>('all');
  const [openState, setOpenState] = useState<Record<number, boolean>>({});
  const context = taskContext.data;
  const items = (context?.task.acceptance ?? []).map((text, index) => ({ index, text, done: context!.task.acceptanceProgress[index] === true, evidence: context!.task.acceptanceEvidence[index] ?? '' }));
  const total = items.length;
  const doneCount = items.filter(item => item.done).length;
  const pendingCount = total - doneCount;
  const visible = filterCriteria(items, filter);
  const allDone = total > 0 && doneCount === total;
  const filters: Array<{ id: CriteriaFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todos', count: total }, { id: 'pending', label: 'Pendentes', count: pendingCount }, { id: 'done', label: 'Atendidos', count: doneCount }
  ];

  return <aside className={'flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto border-l border-l-[#e2e5eb] bg-[#fafbfd] max-[1281px]:col-start-2 max-[1281px]:overflow-visible max-[1280px]:row-start-1 group-data-[tab=chat]/conv:max-[1280px]:hidden group-data-[view=list]/conv:max-[768px]:hidden' + (collapsed ? ' min-[1280px]:hidden' : '')} aria-label="Critérios da tarefa">
    {tabs}
    {taskCard && <section className={`${sectionBase} gap-2 px-5 pt-5 pb-4`} aria-label="Tarefa vinculada"><p className="text-ui-sm text-muted-strong">Tarefa vinculada</p>{taskCard}</section>}
    <section className={`${sectionBase} gap-3 p-4`} aria-labelledby="criteria-title">
      <div className="flex items-center justify-between gap-2"><h3 id="criteria-title" className={sectionHeading}>Critérios da tarefa</h3>{total > 0 && <span className={'text-[12.5px] font-bold ' + (allDone ? 'text-[#1f8a4c]' : 'text-muted-strong')}>{doneCount} de {total} atendidos</span>}</div>
      {taskContext.isPending ? <Skeleton rows={4} label="Carregando critérios…" /> : taskContext.isError ? <ErrorNotice error={taskContext.error} onRetry={() => void taskContext.refetch()} /> : total ? <>
        <div className="flex h-2 gap-[3px]" role="img" aria-label={`${doneCount} de ${total} critérios atendidos`}>{items.map(item => <span key={item.index} className={'flex-[1_1_0] rounded-[3px] ' + (item.done ? 'bg-[#1f8a4c]' : 'bg-[#d5dae3]')} />)}</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar critérios">{filters.map(item => <button type="button" key={item.id} className="min-h-[30px] rounded-full border border-line-strong bg-white px-3 text-ui-sm font-semibold text-ink-2 aria-pressed:border-[#4b4fcb] aria-pressed:bg-[#eef0ff] aria-pressed:text-[#4b4fcb]" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} {item.count}</button>)}</div>
        {visible.length ? <ul className="grid gap-1.5">{visible.map(item => {
          const open = openState[item.index] ?? item.index === 0;
          return <li key={item.index} className={'rounded-[12px] border bg-white ' + (item.done ? 'border-[#cbe8d9]' : 'border-[#e2e5eb]')}>
            <button type="button" className="flex min-h-[52px] w-full items-center gap-2.5 bg-transparent px-3 py-2 text-left" aria-expanded={open} aria-controls={`criterion-body-${item.index}`} onClick={() => setOpenState(current => ({ ...current, [item.index]: !open }))}>
              <span className={'inline-grid size-[22px] flex-none place-items-center rounded-full border-2 ' + (item.done ? 'border-[#1f8a4c] bg-[#1f8a4c] text-white' : 'border-[#aab2c0] bg-white')} role="img" aria-label={item.done ? 'Atendido' : 'Pendente'}>{item.done ? <IconCheck size={13} /> : null}</span>
              <span className="min-w-0 flex-1 text-[13.5px] leading-[1.4] font-semibold text-ink wrap-anywhere">{shortCriterionTitle(item.text)}</span>
              <span className={'text-[16px] text-muted-strong transition-[transform] duration-150 ease-[ease]' + (open ? ' [transform:rotate(180deg)]' : '')} aria-hidden="true">⌄</span>
            </button>
            {open && <div className="grid gap-2 pr-3 pb-3 pl-11" id={`criterion-body-${item.index}`}>
              <MarkdownView content={item.text} variant="criterionBody" />
              <div className="grid gap-0.5 rounded-[8px] bg-[#f6f7fa] px-2.5 py-2 text-[12.5px]"><strong>Evidência</strong>{item.evidence ? <p className="wrap-anywhere">{item.evidence}</p> : item.done || !canMark ? <p className="text-muted-strong wrap-anywhere">ainda sem evidência registrada</p> : null}</div>
              {canMark && (item.done && item.evidence ? <div><button type="button" className={markSecondary} disabled={mark.isPending} onClick={() => mark.mutate({ index: item.index, complete: false, evidence: item.evidence })}>{mark.isPending && mark.variables?.index === item.index ? 'Salvando…' : 'Desmarcar'}</button></div> : <div className="grid gap-2">
                <label className="grid gap-1 text-ui-sm font-bold text-ink-2">{item.done ? 'Motivo para desmarcar' : 'Evidência objetiva'}<textarea className="min-h-16 w-full resize-y rounded-[8px] border border-line-strong px-2.5 py-2 text-[13px]" rows={3} value={drafts[item.index] ?? ''} disabled={mark.isPending} placeholder={item.done ? 'Informe o motivo para desmarcar este critério.' : 'Como foi validado? Cole o comando, o teste ou o trecho de diff.'} onChange={event => setDrafts(current => ({ ...current, [item.index]: event.target.value }))} /></label>
                <button type="button" className={item.done ? markSecondary : markPrimary} disabled={mark.isPending || !(drafts[item.index] ?? '').trim()} onClick={() => mark.mutate({ index: item.index, complete: !item.done, evidence: (drafts[item.index] ?? '').trim() })}>{mark.isPending && mark.variables?.index === item.index ? 'Salvando…' : item.done ? 'Desmarcar' : 'Marcar como atendido'}</button>
              </div>)}
              {canMark && hasPendingProposal && <small className="text-[11.5px] leading-[1.45] text-tone-amber">Atenção: marcar um critério altera a versão da tarefa e deixa a proposta pendente desatualizada; peça uma nova versão à IA se precisar.</small>}
              {feedback?.index === item.index && <p className={feedback.kind === 'error' ? 'mt-1 text-ui-xs font-semibold text-tone-red' : 'text-ui-sm font-semibold text-tone-green'} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
            </div>}
          </li>;
        })}</ul> : <p className={emptyInline}>Nenhum critério nesse filtro.</p>}
      </> : <p className={emptyInline}>Nenhum critério cadastrado.</p>}
    </section>

    {detail.jobs.length > 0 && <section className={sectionPlain} aria-label="Estado da execução">
      {detail.jobs.map(job => <div className={jobState} key={job._id}>
        <Badge tone={job.failed ? 'red' : job.status === 'completed' ? 'green' : job.status === 'waiting_human' ? 'amber' : 'blue'}>{jobStatusLabel(job)}</Badge>
        {job.permissionTitle && <small className={jobSmall}>{job.permissionTitle}</small>}
        {job.status === 'waiting_human' && <button type="button" className={textButton} onClick={onOpenAdmin}>Abrir automações</button>}
      </div>)}
    </section>}

    {context?.messages.length ? <details className={sectionPlain}>
      <summary className={summaryClass}>Progresso e decisões recentes ({Math.min(5, context.messages.length)})</summary>
      {context.messages.slice(0, 5).map(message => <article key={message._id} className="rounded-ui-sm border border-line bg-[#fbfcfe] px-2.5 py-2">
        <div className="flex items-start justify-between gap-x-3 gap-y-[7px]"><TaskMessageAuthor message={message} /><div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-[7px] text-[9px] text-[#8791a1]"><Badge tone={message.type === 'resposta' ? 'green' : 'blue'}>{taskMessageTypeLabel(message.type)}</Badge><small title={formatDate(message.createdAt)}>{relativeTime(message.createdAt)}</small></div></div>
        <MarkdownView content={message.message} variant="aside" />
      </article>)}
    </details> : null}

    {context?.executions[0] && <details className={`${sectionPlain} grid-cols-[auto_1fr] items-center`}>
      <summary className={summaryClass}>Última execução</summary>
      <div className={jobState}><Badge>{context.executions[0].status}</Badge><small className={jobSmall}>Iniciada em {formatDate(context.executions[0].startedAt)}</small></div>
      {context.executions[0].result?.summary && <MarkdownView content={context.executions[0].result.summary} variant="aside" className="col-span-full" />}
    </details>}
  </aside>;
}
