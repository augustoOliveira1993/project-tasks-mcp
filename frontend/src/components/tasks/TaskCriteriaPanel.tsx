import { useEffect, useRef, useState } from 'react';
import { notice } from '../ui/classes';
import { MarkdownView } from '../ui/MarkdownView';

const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const itemBase = 'rounded-ui-md border px-4 py-3 text-ui-sm leading-[1.55] text-[#626f80]';
const itemTone = { done: 'border-[#cbe8d9] bg-[#f8fcfa]', pending: 'border-line bg-white' };
const stateBase = 'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold';
const stateTone = { done: 'bg-tone-green-bg text-tone-green', pending: 'bg-tone-slate-bg text-tone-slate' };
const evidenceTone = { has: 'bg-tone-green-bg text-tone-green', none: 'bg-tone-slate-bg' };

type Feedback = { kind: 'success' | 'error'; message: string } | null;

export type TaskCriteriaPanelProps = {
  acceptance: string[];
  progress: boolean[];
  evidence: Array<string | null | undefined>;
  savingIndex: number | null;
  feedback: Feedback;
  readOnly?: boolean;
  onUpdate: (index: number, complete: boolean, evidence: string) => void;
};

export function TaskCriteriaPanel({ acceptance, progress, evidence, savingIndex, feedback, readOnly = false, onUpdate }: TaskCriteriaPanelProps) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(() => new Set());
  const [missing, setMissing] = useState<number | null>(null);
  const textareas = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const completed = progress.filter(Boolean).length;
  const percent = acceptance.length ? Math.round(completed * 100 / acceptance.length) : 0;

  useEffect(() => {
    if (missing !== null) textareas.current[missing]?.focus();
  }, [missing]);

  function setOpen(index: number, open: boolean) {
    setOpenIndexes(current => {
      const next = new Set(current);
      if (open) next.add(index); else next.delete(index);
      return next;
    });
  }

  function toggle(index: number, complete: boolean) {
    const text = (drafts[index] ?? evidence[index] ?? '').trim();
    if (!text) {
      setOpen(index, true);
      setMissing(index);
      return;
    }
    setMissing(null);
    onUpdate(index, complete, text);
  }

  if (!acceptance.length) return <div className={emptyInline}>Nenhum critério de aceite cadastrado.</div>;

  return <div className="grid gap-3">
    <div className="grid gap-1.5 rounded-ui-md border border-line bg-[#fbfcfe] px-4 py-3">
      <div className="flex justify-between text-ui-sm text-ink-2"><strong>{completed} de {acceptance.length} critérios atendidos</strong><span>{percent}%</span></div>
      <div className="m-0 h-2 overflow-hidden rounded-[999px] bg-[#e3e7ef]" role="progressbar" aria-label="Critérios de aceite atendidos" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={acceptance.length}><span className="block h-full rounded-[inherit] bg-[#1f9d5b] transition-[width] duration-200 ease-[ease]" style={{ width: `${percent}%` }} /></div>
      <small className="text-ui-xs text-muted-strong">Cada critério precisa de uma evidência objetiva (teste, comando, link ou trecho de diff) para ser marcado.</small>
    </div>
    {savingIndex !== null && <p className={notice.info} role="status">Salvando critério…</p>}
    {feedback && <p className={feedback.kind === 'error' ? notice.error : notice.success} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <ol className="m-0 grid list-none gap-2 p-0 [&_li_li]:text-[10px] [&_li_li]:leading-[1.55] [&_li_li]:text-[#626f80]">{acceptance.map((item, index) => {
      const done = progress[index] === true;
      const saved = (evidence[index] ?? '').trim();
      const locked = done && Boolean(saved);
      const open = openIndexes.has(index);
      return <li className={`${itemBase} ${done ? itemTone.done : itemTone.pending}`} key={index}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 cursor-pointer items-start gap-2.5"><input className="mt-0.5 h-[18px] w-[18px] shrink-0 basis-[18px] accent-[#148058] disabled:cursor-wait" type="checkbox" checked={done} disabled={readOnly || savingIndex !== null} aria-label={`${done ? 'Desmarcar' : 'Marcar'} critério ${index + 1}`} onChange={event => toggle(index, event.currentTarget.checked)} /><span className="min-w-0"><MarkdownView content={item} variant="criterion" /></span></div>
          <span className={`${stateBase} ${done ? stateTone.done : stateTone.pending}`}>{done ? 'Atendido' : 'Pendente'}</span>
        </div>
        <details className="mt-2 ml-7 grid gap-1 text-[9px] text-[#737f90]" open={open} onToggle={event => setOpen(index, event.currentTarget.open)}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-ui-xs font-bold text-muted-strong before:text-[10px] before:transition-[rotate] before:duration-150 before:ease-[ease] before:content-['▸'] [[open]>&]:before:rotate-90 [&::-webkit-details-marker]:hidden"><span>Evidência</span><span className={`rounded-full px-[7px] py-px font-semibold ${saved ? evidenceTone.has : evidenceTone.none}`}>{saved ? 'registrada' : 'não registrada'}</span></summary>
          <textarea className="mt-1.5 block min-h-16 w-full resize-y rounded-ui-sm border border-[#dce1ea] bg-white px-2.5 py-2 text-ui-sm text-[#435064] disabled:cursor-not-allowed disabled:bg-[#f5f7fa] disabled:text-[#737f90]" ref={element => { textareas.current[index] = element; }} rows={3} value={drafts[index] ?? evidence[index] ?? ''} disabled={readOnly || savingIndex !== null || locked} placeholder={done && !saved ? 'Informe o motivo para desmarcar este critério.' : 'Como este critério foi validado? Cole o comando, o teste ou o trecho de diff.'} aria-label={`Evidência do critério ${index + 1}`} aria-invalid={missing === index} onChange={event => { setDrafts(current => ({ ...current, [index]: event.target.value })); if (missing === index) setMissing(null); }} />
          {missing === index && <p className="mt-1 text-ui-xs font-semibold text-tone-red" role="alert">Descreva a evidência para {done ? 'desmarcar' : 'marcar'} este critério.</p>}
          {locked && <small className="mt-1 block text-ui-xs text-muted-strong">Para alterar a evidência, desmarque o critério.</small>}
        </details>
      </li>;
    })}</ol>
  </div>;
}
