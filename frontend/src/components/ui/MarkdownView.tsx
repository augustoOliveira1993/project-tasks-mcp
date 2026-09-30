import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type AcceptanceProgress = { completed: number; total: number };

function acceptanceProgress(content: string): AcceptanceProgress | null {
  const match = content.match(/<!--\s*acceptance-progress:(\d+):(\d+)\s*-->/);
  return match ? { completed: Number(match[1]), total: Number(match[2]) } : null;
}

function textContent(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(textContent).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return isValidElement<{ children?: ReactNode }>(children) ? textContent(children.props.children) : '';
}

export function MarkdownView({ content }: { content?: string | null }) {
  const source = typeof content === 'string' ? content : '';
  const progress = acceptanceProgress(source);
  const markdown = source.replace(/\s*<!--\s*acceptance-progress:\d+:\d+\s*-->/g, '');
  const progressPercent = progress?.total ? Math.round(progress.completed * 100 / progress.total) : 0;

  return <div className="task-summary-content">
    {markdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => <h1 className="task-summary-heading">{children}</h1>,
      h2: ({ children }) => textContent(children).trim() === 'Critérios de aceite' && progress ? <section className="task-summary-acceptance"><div><h2 className="task-summary-heading">{children}</h2><span>{progress.completed} / {progress.total}</span></div><div className="task-summary-progress" role="progressbar" aria-label="Critérios de aceite concluídos" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={Math.max(progress.total, 1)}><span style={{ width: progressPercent + '%' }} /></div></section> : <h2 className="task-summary-heading">{children}</h2>,
      h3: ({ children }) => <h3 className="task-summary-heading">{children}</h3>,
      h4: ({ children }) => <h4 className="task-summary-heading">{children}</h4>,
      h5: ({ children }) => <h5 className="task-summary-heading">{children}</h5>,
      h6: ({ children }) => <h6 className="task-summary-heading">{children}</h6>,
      p: ({ children }) => <p className="task-summary-paragraph">{children}</p>,
      ul: ({ children }) => <ul className="task-summary-list">{children}</ul>,
      ol: ({ children }) => <ol className="task-summary-list ordered">{children}</ol>,
      li: ({ children }) => <li className="task-summary-list-item">{children}</li>,
      blockquote: ({ children }) => <blockquote className="task-summary-quote">{children}</blockquote>,
      pre: ({ children }) => <pre className="task-summary-code">{children}</pre>,
      table: ({ children }) => <div className="task-summary-table-wrap"><table>{children}</table></div>,
      th: ({ children }) => <th>{children}</th>,
      td: ({ children }) => <td>{children}</td>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      input: ({ checked, type }) => type === 'checkbox' ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? 'Critério concluído' : 'Critério pendente'} /> : null
    }}>{markdown}</ReactMarkdown> : <p className="task-summary-paragraph">Nenhum conteúdo Markdown disponível.</p>}
  </div>;
}
