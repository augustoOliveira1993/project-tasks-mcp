import { useId, useState } from 'react';
import { MarkdownView } from './MarkdownView';

const body = 'w-full min-w-0';
const collapsedBody = (collapsed: boolean) => collapsed
  ? `${body} relative max-h-[calc(var(--lines,3)*1.55em)] overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[1.6em] after:bg-[linear-gradient(transparent,#fff)] after:content-['']`
  : body;

/** Texto Markdown longo recolhido por padrão; só oferece "ver mais" quando há o que mostrar. */
export function ExpandableMarkdown({ content, fallback = 'Sem descrição cadastrada.', collapsedLines = 3, threshold = 140 }: { content?: string | null; fallback?: string; collapsedLines?: number; threshold?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = content?.trim() ?? '';
  if (!text) return <p className="m-0 text-ui-sm text-muted-strong">{fallback}</p>;
  const long = text.length > threshold || text.split('\n').filter(Boolean).length > collapsedLines;
  return <div className="grid min-w-0 justify-items-start gap-1">
    <div id={id} className={collapsedBody(long && !open)} style={{ ['--lines' as string]: collapsedLines }}><MarkdownView content={text} variant="compact" /></div>
    {long && <button type="button" className="px-0 py-1 text-[11px] font-semibold text-[#5c6bd5] hover:text-[#3748bf]" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? 'Ver menos' : 'Ver mais'}</button>}
  </div>;
}
