import { useEffect, useRef, useState } from 'react';
import { MarkdownView } from '../ui/MarkdownView';

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

  if (!acceptance.length) return <div className="empty-inline">Nenhum critério de aceite cadastrado.</div>;

  return <div className="criteria-panel">
    <div className="criteria-summary">
      <div className="criteria-summary-head"><strong>{completed} de {acceptance.length} critérios atendidos</strong><span>{percent}%</span></div>
      <div className="criteria-progress" role="progressbar" aria-label="Critérios de aceite atendidos" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={acceptance.length}><span style={{ width: `${percent}%` }} /></div>
      <small>Cada critério precisa de uma evidência objetiva (teste, comando, link ou trecho de diff) para ser marcado.</small>
    </div>
    {savingIndex !== null && <p className="notice" role="status">Salvando critério…</p>}
    {feedback && <p className={`notice ${feedback.kind === 'error' ? 'error' : 'success'}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <ol className="criteria">{acceptance.map((item, index) => {
      const done = progress[index] === true;
      const saved = (evidence[index] ?? '').trim();
      const locked = done && Boolean(saved);
      const open = openIndexes.has(index);
      return <li className={'criteria-item' + (done ? ' done' : '')} key={index}>
        <div className="criteria-item-heading">
          <div className="criteria-check-label"><input className="criterion-toggle" type="checkbox" checked={done} disabled={readOnly || savingIndex !== null} aria-label={`${done ? 'Desmarcar' : 'Marcar'} critério ${index + 1}`} onChange={event => toggle(index, event.currentTarget.checked)} /><span className="criterion-text"><MarkdownView content={item} /></span></div>
          <span className={done ? 'criterion-state criterion-complete' : 'criterion-state'}>{done ? 'Atendido' : 'Pendente'}</span>
        </div>
        <details className="criterion-evidence" open={open} onToggle={event => setOpen(index, event.currentTarget.open)}>
          <summary><span>Evidência</span><span className={saved ? 'evidence-state has' : 'evidence-state'}>{saved ? 'registrada' : 'não registrada'}</span></summary>
          <textarea ref={element => { textareas.current[index] = element; }} rows={3} value={drafts[index] ?? evidence[index] ?? ''} disabled={readOnly || savingIndex !== null || locked} placeholder={done && !saved ? 'Informe o motivo para desmarcar este critério.' : 'Como este critério foi validado? Cole o comando, o teste ou o trecho de diff.'} aria-label={`Evidência do critério ${index + 1}`} aria-invalid={missing === index} onChange={event => { setDrafts(current => ({ ...current, [index]: event.target.value })); if (missing === index) setMissing(null); }} />
          {missing === index && <p className="field-error" role="alert">Descreva a evidência para {done ? 'desmarcar' : 'marcar'} este critério.</p>}
          {locked && <small>Para alterar a evidência, desmarque o critério.</small>}
        </details>
      </li>;
    })}</ol>
  </div>;
}
