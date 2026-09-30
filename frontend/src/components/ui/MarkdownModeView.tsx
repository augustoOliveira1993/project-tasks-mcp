import { useState } from 'react';
import { MarkdownView } from './MarkdownView';

type MarkdownMode = 'preview' | 'source';

export function MarkdownModeView({ content, emptyMessage = 'Nenhum conteúdo Markdown disponível.', label = 'Modo de visualização Markdown', initialMode = 'preview' }: {
  content?: string | null;
  emptyMessage?: string;
  label?: string;
  initialMode?: MarkdownMode;
}) {
  const [mode, setMode] = useState<MarkdownMode>(initialMode);
  const source = typeof content === 'string' && content.trim() ? content : emptyMessage;

  return <section className="markdown-mode-view">
    <div className="markdown-mode-tabs" role="group" aria-label={label}>
      <button type="button" className="markdown-mode-button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Visualizar</button>
      <button type="button" className="markdown-mode-button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Código</button>
    </div>
    {mode === 'source'
      ? <pre className="markdown-content markdown-source">{source}</pre>
      : <div className="markdown-document-view"><MarkdownView content={source} /></div>}
  </section>;
}
