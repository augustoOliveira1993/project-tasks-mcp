import { Badge } from '../ui/Badge';
import { formatDate } from '../../lib/format';
import { formatDuration, personName } from '../../lib/labels';
import { statusLabels, statusTone } from '../../features/tasks/status';

export type StatusHistoryEntry = { status: string; startedAt: string; endedAt: string | null; durationMs: number };
export type TimelineEvent = { kind?: string; author?: string; at?: string };

const statusEventKinds = new Set(['task.created', 'task.claimed', 'task.submitted', 'task.approved', 'task.blocked', 'task.status.changed', 'task.transferred']);

/** Quem causou a entrada no status: o evento de mudança mais próximo do início (tolerância de 2 min). */
function authorFor(entry: StatusHistoryEntry, events: TimelineEvent[]) {
  const started = new Date(entry.startedAt).getTime();
  if (!Number.isFinite(started)) return '';
  const match = events.filter(event => statusEventKinds.has(event.kind ?? '') && event.at).map(event => ({ event, delta: Math.abs(new Date(event.at!).getTime() - started) })).filter(item => item.delta <= 120_000).sort((a, b) => a.delta - b.delta)[0];
  const author = match?.event.author?.trim();
  return author && author !== 'Autor não identificado' ? personName(author) : '';
}

export function TaskTimeline({ history, events, now, truncated }: { history: StatusHistoryEntry[]; events: TimelineEvent[]; now: number; truncated?: boolean }) {
  if (!history.length) return <p className="empty-inline">Histórico de status indisponível para esta tarefa.</p>;
  const entries = [...history].reverse();
  return <>
    {truncated && <p className="muted-text">Exibindo apenas os status mais recentes devido ao limite do contexto.</p>}
    <ol className="task-status-timeline">{entries.map((entry, index) => {
      const current = !entry.endedAt;
      const startedAtMs = new Date(entry.startedAt).getTime();
      const durationMs = current && Number.isFinite(startedAtMs) ? Math.max(entry.durationMs, now - startedAtMs) : entry.durationMs;
      const author = authorFor(entry, events);
      return <li className={'task-status-timeline-item' + (current ? ' current' : '')} key={`${entry.status}-${entry.startedAt}-${index}`}>
        <span className="task-status-timeline-marker" aria-hidden="true" />
        <div className="task-status-timeline-content">
          <div className="task-status-timeline-heading"><Badge tone={statusTone[entry.status] ?? 'muted'}>{statusLabels[entry.status] ?? entry.status}</Badge>{current && <span className="timeline-current">status atual</span>}</div>
          <div className="task-status-timeline-meta"><span>Entrou em {formatDate(entry.startedAt)}{author ? ` · por ${author}` : ''}</span>{entry.endedAt && <span>Saiu em {formatDate(entry.endedAt)}</span>}</div>
        </div>
        <div className="timeline-duration"><small>{current ? 'Neste status há' : 'Permaneceu'}</small><strong>{formatDuration(durationMs)}</strong></div>
      </li>;
    })}</ol>
  </>;
}
