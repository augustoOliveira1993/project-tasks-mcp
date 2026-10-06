import { useId, useState } from 'react';
import { MarkdownView } from './MarkdownView';

/** Texto Markdown longo recolhido por padrão; só oferece "ver mais" quando há o que mostrar. */
export function ExpandableMarkdown({ content, fallback = 'Sem descrição cadastrada.', collapsedLines = 3, threshold = 140 }: { content?: string | null; fallback?: string; collapsedLines?: number; threshold?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = content?.trim() ?? '';
  if (!text) return <p className="muted-text expandable-empty">{fallback}</p>;
  const long = text.length > threshold || text.split('\n').filter(Boolean).length > collapsedLines;
  return <div className="expandable-markdown">
    <div id={id} className={'expandable-body' + (long && !open ? ' collapsed' : '')} style={{ ['--lines' as string]: collapsedLines }}><MarkdownView content={text} /></div>
    {long && <button type="button" className="text-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? 'Ver menos' : 'Ver mais'}</button>}
  </div>;
}
