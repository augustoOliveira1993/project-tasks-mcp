import { useEffect, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Badge } from '../ui/Badge';
import { ErrorNotice } from '../ui/ErrorNotice';
import { TaskLink } from '../ui/Links';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { formatDate } from '../../lib/format';
import { relativeTime } from '../../lib/labels';
import { TaskMessageAuthor, taskMessageTypeLabel } from './ConversationParts';
import type { ConversationDetail, Proposal, TaskActivity } from './conversation-types';

const jobLabel = (job: { status: string; failed: boolean }) => job.failed ? 'Falha na execução'
  : job.status === 'waiting_human' ? 'Aguardando autorização'
    : job.status === 'completed' ? 'Enviado para revisão'
      : job.status === 'queued' ? 'Na fila'
        : job.status === 'running' || job.status === 'reserved' ? 'Em execução'
          : job.status === 'blocked' ? 'Bloqueado' : job.status;

const proposalStatusLabel = (proposal: Proposal) => proposal.stale ? 'Desatualizada' : proposal.status === 'pending' ? 'Aguardando autorização' : proposal.status === 'approved' ? 'Autorizada' : proposal.status;
const proposalTone = (proposal: Proposal) => proposal.stale ? 'muted' : proposal.status === 'pending' ? 'amber' : proposal.status === 'approved' ? 'green' : 'blue';

export type ConversationAsideProps = {
  detail: ConversationDetail;
  taskContext: UseQueryResult<TaskActivity>;
  approving: boolean;
  onApprove: (proposal: Proposal) => void;
  onOpenAdmin: () => void;
};

export function ConversationAside({ detail, taskContext, approving, onApprove, onOpenAdmin }: ConversationAsideProps) {
  const proposals = [...detail.proposals].sort((a, b) => b.version - a.version);
  const authorizable = (proposal: Proposal) => proposal.status === 'pending' && !proposal.stale && Boolean(detail.task) && detail.task!.version === proposal.expectedTaskVersion;
  const initialId = (proposals.find(authorizable) ?? proposals[0])?._id;
  const [selectedId, setSelectedId] = useState(initialId);
  useEffect(() => { setSelectedId(current => proposals.some(item => item._id === current) ? current : initialId); }, [initialId, detail.conversation._id]);
  const selected = proposals.find(item => item._id === selectedId) ?? proposals[0];
  const pending = proposals.find(authorizable);
  const context = taskContext.data;
  const completed = context ? context.task.acceptanceProgress.filter(Boolean).length : 0;
  const total = context?.task.acceptance.length ?? 0;

  return <aside className="conversation-aside" aria-label="Proposta e acompanhamento da tarefa">
    {pending && <section className="authorize-card" aria-labelledby="authorize-title">
      <p className="eyebrow">AGUARDANDO VOCÊ</p>
      <h3 id="authorize-title">{pending.title}</h3>
      {detail.task && <p className="authorize-meta">Tarefa: <TaskLink taskId={detail.task._id} projectId={detail.conversation.projectId}>{detail.task.name}</TaskLink></p>}
      <p className="authorize-meta">Versão {pending.version} · inicia a automação configurada e envia o resultado para revisão.</p>
      <button type="button" className="button primary authorize-button" disabled={approving} onClick={() => onApprove(pending)}>{approving ? 'Autorizando…' : 'Autorizar execução'}</button>
    </section>}

    {detail.jobs.length > 0 && <section className="aside-section" aria-label="Estado da execução">
      {detail.jobs.map(job => <div className="conversation-job-state" key={job._id}>
        <Badge tone={job.failed ? 'red' : job.status === 'completed' ? 'green' : job.status === 'waiting_human' ? 'amber' : 'blue'}>{jobLabel(job)}</Badge>
        {job.permissionTitle && <small>{job.permissionTitle}</small>}
        {job.status === 'waiting_human' && <button type="button" className="text-button" onClick={onOpenAdmin}>Abrir automações</button>}
      </div>)}
    </section>}

    {proposals.length > 0 && selected && <section className="aside-section conversation-proposals" id="conversation-proposals" aria-labelledby="proposals-title">
      <h3 id="proposals-title">Propostas de execução</h3>
      {proposals.length > 1 && <div className="proposal-versions" role="tablist" aria-label="Versões da proposta">{proposals.map(item => <button type="button" role="tab" aria-selected={item._id === selected._id} className={'proposal-version' + (item._id === selected._id ? ' active' : '')} key={item._id} onClick={() => setSelectedId(item._id)}>Versão {item.version}</button>)}</div>}
      <article className="proposal-card" aria-label={`Versão ${selected.version} da proposta`}>
        <div className="proposal-heading"><h4>{selected.title}</h4><Badge tone={proposalTone(selected)}>{proposalStatusLabel(selected)}</Badge></div>
        <small>Versão {selected.version}</small>
        <MarkdownView content={selected.summary} />
        {selected.taskPatch.instructions && <div className="aside-block"><h5>Instruções propostas</h5><MarkdownView content={selected.taskPatch.instructions} /></div>}
        {selected.taskPatch.acceptance?.length ? <div className="aside-block"><h5>Critérios propostos</h5><ul>{selected.taskPatch.acceptance.map((criterion, index) => <li key={index}><MarkdownView content={criterion} /></li>)}</ul></div> : null}
        {selected.stale || (selected.status === 'pending' && detail.task && detail.task.version !== selected.expectedTaskVersion) ? <p className="notice" role="note">Esta proposta foi feita sobre uma versão anterior da tarefa (esperada v{selected.expectedTaskVersion}{detail.task ? `, atual v${detail.task.version}` : ''}). Peça uma nova versão à IA antes de autorizar.</p> : null}
        {!authorizable(selected) ? null : pending?._id === selected._id ? null : <div className="button-row end-row"><button type="button" className="button primary" disabled={approving} onClick={() => onApprove(selected)}>Autorizar execução</button></div>}
      </article>
    </section>}

    {detail.task && <section className="aside-section" aria-labelledby="criteria-title">
      <div className="aside-heading"><h3 id="criteria-title">Critérios da tarefa</h3>{context && total > 0 && <span className="aside-count">{completed}/{total}</span>}</div>
      {taskContext.isPending ? <Skeleton rows={3} label="Carregando acompanhamento…" /> : taskContext.isError ? <ErrorNotice error={taskContext.error} onRetry={() => void taskContext.refetch()} /> : total ? <>
        <div className="criteria-progress" role="progressbar" aria-label="Critérios atendidos" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${Math.round(completed * 100 / total)}%` }} /></div>
        <ul className="conversation-acceptance">{context!.task.acceptance.map((criterion, index) => {
          const done = context!.task.acceptanceProgress[index];
          const evidence = context!.task.acceptanceEvidence[index];
          return <li key={index}>
            <Badge tone={done ? 'green' : 'muted'}>{done ? 'Atendido' : 'Pendente'}</Badge>
            <div><MarkdownView content={criterion} />{evidence && <details className="aside-evidence"><summary>Evidência</summary><p>{evidence}</p></details>}</div>
          </li>;
        })}</ul>
      </> : <p className="empty-inline">Nenhum critério cadastrado.</p>}
    </section>}

    {context?.messages.length ? <section className="aside-section conversation-task-messages" aria-labelledby="decisions-title">
      <h3 id="decisions-title">Progresso e decisões recentes</h3>
      {context.messages.slice(0, 5).map(message => <article key={message._id}>
        <div className="conversation-task-message-meta"><TaskMessageAuthor message={message} /><div className="conversation-task-message-state"><Badge tone={message.type === 'resposta' ? 'green' : 'blue'}>{taskMessageTypeLabel(message.type)}</Badge><small title={formatDate(message.createdAt)}>{relativeTime(message.createdAt)}</small></div></div>
        <MarkdownView content={message.message} />
      </article>)}
    </section> : null}

    {context?.executions[0] && <section className="aside-section conversation-execution" aria-labelledby="execution-title">
      <h3 id="execution-title">Última execução</h3>
      <div className="conversation-job-state"><Badge>{context.executions[0].status}</Badge><small>Iniciada em {formatDate(context.executions[0].startedAt)}</small></div>
      {context.executions[0].result?.summary && <MarkdownView content={context.executions[0].result.summary} />}
    </section>}
  </aside>;
}
