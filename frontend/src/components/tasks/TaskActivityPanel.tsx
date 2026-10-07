import { useState } from 'react';
import { Avatar } from '../ui/Person';
import { ErrorNotice } from '../ui/ErrorNotice';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { Badge } from '../ui/Badge';
import { AgentClientIcon, isKnownAgentClient } from '../ui/AgentClientIcon';
import { ConversationLink } from '../ui/Links';
import { formatDate } from '../../lib/format';
import { personName, relativeTime } from '../../lib/labels';
import { eventKindLabel, eventSummary, isTechnicalEvent, originLabel } from '../../lib/activity';

const section = 'grid gap-3 [&_h3]:font-display [&_h3]:text-[13px] [&_h3]:leading-[normal] [&_h3]:font-bold [&_h3]:text-ink [&_h3]:normal-case [&_h3]:m-0';
const list = 'm-0 grid list-none gap-3 p-0 [&_p]:text-ui-sm [&_p]:leading-[1.5] [&_p]:text-ink-2';
const item = 'flex items-start gap-2.5 border-b border-b-[#eef0f5] pb-3 last:border-b-0';
const rowHead = 'flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ui-xs text-muted-strong';
const badge = 'inline-flex max-w-full rounded-[4px] px-[7px] py-[3px] text-[10.5px] leading-[1.3] wrap-anywhere';

export type TaskActivityEvent = { _id?: string; conversationId?: string | null; projectId?: string | null; kind?: string; toolName?: string | null; summary?: string; detail?: string | null; author?: string; origin?: string; at?: string };
type Execution = { _id: string; status: string; startedAt: string; result?: { summary?: string; evidence?: string[] } };

export function TaskActivityPanel({ events, isPending, isError, error, onRetry, executions, now }: {
  events: TaskActivityEvent[]; isPending: boolean; isError: boolean; error: unknown; onRetry: () => void; executions: Execution[]; now: number;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const visible = events.filter(event => showTechnical || !isTechnicalEvent(event));
  const hidden = events.length - events.filter(event => !isTechnicalEvent(event)).length;
  return <div>
    {executions.length > 0 && <section className={section} aria-label="Execuções">
      <h3>Execuções</h3>
      <ul className={list}>{executions.slice(0, 5).map(execution => <li className={item} key={execution._id}>
        <div className={rowHead}><Badge tone={execution.status === 'completed' || execution.status === 'concluida' ? 'green' : 'blue'}>{execution.status}</Badge><small>Iniciada {relativeTime(execution.startedAt, now)} · {formatDate(execution.startedAt)}</small></div>
        {execution.result?.summary && <MarkdownView content={execution.result.summary} />}
      </li>)}</ul>
    </section>}
    <section className={section} aria-label="Eventos da tarefa">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3>Eventos</h3>{hidden > 0 && <label className="inline-flex items-center gap-1.5 text-ui-xs text-muted-strong"><input type="checkbox" checked={showTechnical} onChange={event => setShowTechnical(event.target.checked)} /> Mostrar chamadas MCP e heartbeats ({hidden})</label>}</div>
      {isPending ? <Skeleton rows={4} label="Carregando atividade…" /> : isError ? <ErrorNotice error={error} onRetry={onRetry} title="Não foi possível carregar a atividade" /> : visible.length ? <ul className={list}>{visible.map((event, index) => {
        const author = event.author?.trim() || '';
        return <li className={item} key={event._id ?? `${event.at}-${index}`}>
          <Avatar identity={author} size={26} />
          <div className="grid min-w-0 flex-1 gap-1">
            <div className={rowHead}><strong className="text-ui-sm text-ink">{author && author !== 'Autor não identificado' ? personName(author) : 'Autor desconhecido'}</strong><span className={`${badge} bg-[#e8efff] text-[#2c4ea8]`}>{eventKindLabel(event.kind)}</span><span className={`${badge} items-center gap-1 bg-[#f1f3f7] text-ink-2`} title="Origem do evento">{isKnownAgentClient(event.origin) && <AgentClientIcon clientName={event.origin} />}<span>{originLabel(event.origin)}</span></span><time className="ml-auto whitespace-nowrap" dateTime={event.at} title={formatDate(event.at)}>{relativeTime(event.at, now)}</time></div>
            <p>{eventSummary(event)}{event.conversationId && <> · <ConversationLink conversationId={event.conversationId} projectId={event.projectId}>Ver conversa</ConversationLink></>}</p>
            {event.detail && <div className="max-h-[180px] overflow-auto border-l-2 border-line-strong pl-2.5"><MarkdownView content={event.detail} /></div>}
          </div>
        </li>;
      })}</ul> : <p className="rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong">Nenhum evento relevante registrado para esta tarefa.</p>}
    </section>
  </div>;
}
