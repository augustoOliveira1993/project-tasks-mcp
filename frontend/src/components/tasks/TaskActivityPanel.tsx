import { useState } from 'react';
import { Avatar } from '../ui/Person';
import { ErrorNotice } from '../ui/ErrorNotice';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { Badge } from '../ui/Badge';
import { ConversationLink } from '../ui/Links';
import { formatDate } from '../../lib/format';
import { personName, relativeTime } from '../../lib/labels';
import { eventKindLabel, eventSummary, isTechnicalEvent, originLabel } from '../../lib/activity';

export type TaskActivityEvent = { _id?: string; conversationId?: string | null; projectId?: string | null; kind?: string; toolName?: string | null; summary?: string; detail?: string | null; author?: string; origin?: string; at?: string };
type Execution = { _id: string; status: string; startedAt: string; result?: { summary?: string; evidence?: string[] } };

export function TaskActivityPanel({ events, isPending, isError, error, onRetry, executions, now }: {
  events: TaskActivityEvent[]; isPending: boolean; isError: boolean; error: unknown; onRetry: () => void; executions: Execution[]; now: number;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const visible = events.filter(event => showTechnical || !isTechnicalEvent(event));
  const hidden = events.length - events.filter(event => !isTechnicalEvent(event)).length;
  return <div className="task-activity">
    {executions.length > 0 && <section className="drawer-section" aria-label="Execuções">
      <h3>Execuções</h3>
      <ul className="activity-list">{executions.slice(0, 5).map(execution => <li key={execution._id}>
        <div className="activity-row-head"><Badge tone={execution.status === 'completed' || execution.status === 'concluida' ? 'green' : 'blue'}>{execution.status}</Badge><small>Iniciada {relativeTime(execution.startedAt, now)} · {formatDate(execution.startedAt)}</small></div>
        {execution.result?.summary && <MarkdownView content={execution.result.summary} />}
      </li>)}</ul>
    </section>}
    <section className="drawer-section" aria-label="Eventos da tarefa">
      <div className="drawer-section-head"><h3>Eventos</h3>{hidden > 0 && <label className="toggle-line"><input type="checkbox" checked={showTechnical} onChange={event => setShowTechnical(event.target.checked)} /> Mostrar chamadas MCP e heartbeats ({hidden})</label>}</div>
      {isPending ? <Skeleton rows={4} label="Carregando atividade…" /> : isError ? <ErrorNotice error={error} onRetry={onRetry} title="Não foi possível carregar a atividade" /> : visible.length ? <ul className="activity-list">{visible.map((event, index) => {
        const author = event.author?.trim() || '';
        return <li key={event._id ?? `${event.at}-${index}`}>
          <Avatar identity={author} size={26} />
          <div className="activity-row-body">
            <div className="activity-row-head"><strong>{author && author !== 'Autor não identificado' ? personName(author) : 'Autor desconhecido'}</strong><span>{eventKindLabel(event.kind)}</span><small>{originLabel(event.origin)}</small><time dateTime={event.at} title={formatDate(event.at)}>{relativeTime(event.at, now)}</time></div>
            <p>{eventSummary(event)}{event.conversationId && <> · <ConversationLink conversationId={event.conversationId} projectId={event.projectId}>Ver conversa</ConversationLink></>}</p>
            {event.detail && <div className="activity-detail"><MarkdownView content={event.detail} /></div>}
          </div>
        </li>;
      })}</ul> : <p className="empty-inline">Nenhum evento relevante registrado para esta tarefa.</p>}
    </section>
  </div>;
}
