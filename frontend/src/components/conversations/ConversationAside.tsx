import { useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Badge } from '../ui/Badge';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconCheck } from '../ui/icons';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { formatDate } from '../../lib/format';
import { relativeTime } from '../../lib/labels';
import { filterCriteria, jobStatusLabel, shortCriterionTitle, type CriteriaFilter } from '../../lib/conversation-ui';
import { TaskMessageAuthor, taskMessageTypeLabel } from './ConversationParts';
import type { ConversationDetail, TaskActivity } from './conversation-types';

export type ConversationAsideProps = {
  detail: ConversationDetail;
  taskContext: UseQueryResult<TaskActivity>;
  onOpenAdmin: () => void;
  tabs?: ReactNode;
};

/** Coluna "Critérios da tarefa": resumo, barra segmentada, filtros e itens expansíveis. */
export function ConversationAside({ detail, taskContext, onOpenAdmin, tabs }: ConversationAsideProps) {
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

  return <aside className="conversation-aside" aria-label="Critérios da tarefa">
    {tabs}
    <section className="aside-section criteria-column" aria-labelledby="criteria-title">
      <div className="aside-heading"><h3 id="criteria-title">Critérios da tarefa</h3>{total > 0 && <span className={'criteria-count' + (allDone ? ' complete' : '')}>{doneCount} de {total} atendidos</span>}</div>
      {taskContext.isPending ? <Skeleton rows={4} label="Carregando critérios…" /> : taskContext.isError ? <ErrorNotice error={taskContext.error} onRetry={() => void taskContext.refetch()} /> : total ? <>
        <div className="segment-bar" role="img" aria-label={`${doneCount} de ${total} critérios atendidos`}>{items.map(item => <span key={item.index} className={item.done ? 'segment done' : 'segment'} />)}</div>
        <div className="criteria-filters" role="group" aria-label="Filtrar critérios">{filters.map(item => <button type="button" key={item.id} className={'criteria-filter' + (filter === item.id ? ' active' : '')} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} {item.count}</button>)}</div>
        {visible.length ? <ul className="criteria-disclosure">{visible.map(item => {
          const open = openState[item.index] ?? item.index === 0;
          return <li key={item.index} className={item.done ? 'done' : undefined}>
            <button type="button" className="criterion-toggle-row" aria-expanded={open} aria-controls={`criterion-body-${item.index}`} onClick={() => setOpenState(current => ({ ...current, [item.index]: !open }))}>
              <span className={'criterion-icon' + (item.done ? ' done' : '')} role="img" aria-label={item.done ? 'Atendido' : 'Pendente'}>{item.done ? <IconCheck size={13} /> : null}</span>
              <span className="criterion-short">{shortCriterionTitle(item.text)}</span>
              <span className={'criterion-chevron' + (open ? ' open' : '')} aria-hidden="true">⌄</span>
            </button>
            {open && <div className="criterion-body" id={`criterion-body-${item.index}`}>
              <MarkdownView content={item.text} />
              <div className="criterion-evidence-block"><strong>Evidência</strong>{item.evidence ? <p>{item.evidence}</p> : <p className="muted-text">ainda sem evidência registrada</p>}</div>
            </div>}
          </li>;
        })}</ul> : <p className="empty-inline">Nenhum critério nesse filtro.</p>}
      </> : <p className="empty-inline">Nenhum critério cadastrado.</p>}
    </section>

    {detail.jobs.length > 0 && <section className="aside-section" aria-label="Estado da execução">
      {detail.jobs.map(job => <div className="conversation-job-state" key={job._id}>
        <Badge tone={job.failed ? 'red' : job.status === 'completed' ? 'green' : job.status === 'waiting_human' ? 'amber' : 'blue'}>{jobStatusLabel(job)}</Badge>
        {job.permissionTitle && <small>{job.permissionTitle}</small>}
        {job.status === 'waiting_human' && <button type="button" className="text-button" onClick={onOpenAdmin}>Abrir automações</button>}
      </div>)}
    </section>}

    {context?.messages.length ? <details className="aside-section conversation-task-messages">
      <summary>Progresso e decisões recentes ({Math.min(5, context.messages.length)})</summary>
      {context.messages.slice(0, 5).map(message => <article key={message._id}>
        <div className="conversation-task-message-meta"><TaskMessageAuthor message={message} /><div className="conversation-task-message-state"><Badge tone={message.type === 'resposta' ? 'green' : 'blue'}>{taskMessageTypeLabel(message.type)}</Badge><small title={formatDate(message.createdAt)}>{relativeTime(message.createdAt)}</small></div></div>
        <MarkdownView content={message.message} />
      </article>)}
    </details> : null}

    {context?.executions[0] && <details className="aside-section conversation-execution">
      <summary>Última execução</summary>
      <div className="conversation-job-state"><Badge>{context.executions[0].status}</Badge><small>Iniciada em {formatDate(context.executions[0].startedAt)}</small></div>
      {context.executions[0].result?.summary && <MarkdownView content={context.executions[0].result.summary} />}
    </details>}
  </aside>;
}
