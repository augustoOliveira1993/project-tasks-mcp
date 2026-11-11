import { Badge } from '../ui/Badge';
import { formatDate } from '../../lib/format';
import { formatDuration, personName } from '../../lib/labels';
import { statusLabels, statusTone } from '../../features/tasks/status';

const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';

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
  if (!history.length) return <p className={emptyInline}>Histórico de status indisponível para esta tarefa.</p>;
  const entries = [...history].reverse();
  return <>
    {truncated && <p className="text-muted-strong">Exibindo apenas os status mais recentes devido ao limite do contexto.</p>}
    <ol className="m-0 grid list-none pl-[5px]">{entries.map((entry, index) => {
      const current = !entry.endedAt;
      const startedAtMs = new Date(entry.startedAt).getTime();
      const durationMs = current && Number.isFinite(startedAtMs) ? Math.max(entry.durationMs, now - startedAtMs) : entry.durationMs;
      const author = authorFor(entry, events);
      return <li className="relative ml-[5px] grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-l border-l-[#e5e8f2] pb-4 pl-[18px] last:border-l-transparent" key={`${entry.status}-${entry.startedAt}-${index}`}>
        <span className={`absolute top-0.5 -left-[5px] h-[9px] w-[9px] rounded-full border-2 border-white ${current ? 'bg-[#1f9d5b] shadow-[0_0_0_3px_#1f9d5b30]' : 'bg-[#6877dd] shadow-[0_0_0_1px_#cfd4fa]'}`} aria-hidden="true" />
        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5"><Badge tone={statusTone[entry.status] ?? 'muted'}>{statusLabels[entry.status] ?? entry.status}</Badge>{current && <span className="text-ui-xs font-bold text-tone-green">status atual</span>}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-ui-xs leading-[1.5] text-muted-strong"><span>Entrou em {formatDate(entry.startedAt)}{author ? ` · por ${author}` : ''}</span>{entry.endedAt && <span>Saiu em {formatDate(entry.endedAt)}</span>}</div>
        </div>
        <div className="grid justify-items-end gap-px text-right"><small className="text-[10px] text-muted-strong">{current ? 'Neste status há' : 'Permaneceu'}</small><strong className="text-ui-sm text-ink-2">{formatDuration(durationMs)}</strong></div>
      </li>;
    })}</ol>
  </>;
}
