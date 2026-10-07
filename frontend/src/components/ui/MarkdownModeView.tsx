import { useState } from 'react';
import { MarkdownView } from './MarkdownView';

const modeButton = 'min-h-[27px] rounded-ui-sm px-2.5 text-[10px] font-semibold text-[#738093] aria-pressed:bg-white aria-pressed:text-[#4e5ece] aria-pressed:shadow-[0_1px_3px_#1720331a]';

type MarkdownMode = 'preview' | 'source';

export function MarkdownModeView({ content, emptyMessage = 'Nenhum conteúdo Markdown disponível.', label = 'Modo de visualização Markdown', initialMode = 'preview' }: {
  content?: string | null;
  emptyMessage?: string;
  label?: string;
  initialMode?: MarkdownMode;
}) {
  const [mode, setMode] = useState<MarkdownMode>(initialMode);
  const source = typeof content === 'string' && content.trim() ? content : emptyMessage;

  return <section className="min-w-0">
    <div className="inline-flex gap-0.5 rounded-[8px] border border-[#e1e5ed] bg-[#f5f6fa] p-[3px]" role="group" aria-label={label}>
      <button type="button" className={modeButton} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Visualizar</button>
      <button type="button" className={modeButton} aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Código</button>
    </div>
    {mode === 'source'
      ? <pre className="mt-2 box-border max-h-[min(55vh,520px)] w-full overflow-auto rounded-[8px] border border-[#edf0f4] bg-[#fafbfc] p-3 font-[ui-monospace,monospace] text-[10px] leading-[1.65] whitespace-pre-wrap text-[#526075] wrap-anywhere">{source}</pre>
      : <div className="mt-2 overflow-auto rounded-[8px] border border-[#edf0f4] bg-[#fafbfc] p-3"><MarkdownView content={source} variant="document" /></div>}
  </section>;
}
