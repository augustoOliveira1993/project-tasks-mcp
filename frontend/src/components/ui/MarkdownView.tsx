import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type AcceptanceProgress = { completed: number; total: number };

/** Tipografia por contexto de uso; cada valor é uma string completa para o Tailwind gerar as classes. */
const variants = {
  default: 'gap-3 text-[11px] leading-[1.7] text-[#5f6b7c]',
  event: 'gap-[7px] text-[11px] leading-[1.55] text-[#5f6b7c]',
  description: 'max-w-[72ch] gap-[13px] text-ui-md leading-[1.7] text-[#5f6b7c] [&_h1]:text-[21px] [&_h2]:mt-3 [&_h2]:text-[17px] [&_h3]:mt-2.5 [&_h3]:text-[14px]',
  criterion: 'gap-1.5 text-ui-sm leading-[1.55] text-ink-2',
  criterionBody: 'gap-1.5 text-[13px] leading-[1.55] text-ink-2',
  aside: 'gap-3 text-[11px] leading-[1.7] text-[#586579]',
  chat: 'max-w-full gap-3 text-[14px] leading-[1.6] text-[#2b3140] wrap-anywhere [&_pre]:max-w-full',
  compact: 'gap-1.5 text-ui-sm leading-[1.55] text-muted-strong [&_:is(h1,h2,h3)]:m-0 [&_:is(h1,h2,h3)]:border-none [&_:is(h1,h2,h3)]:p-0 [&_:is(h1,h2,h3)]:text-ui-sm',
  document: 'gap-2.5 text-[11px] leading-[1.7] text-[#5f6b7c]'
};

export type MarkdownVariant = keyof typeof variants;

const root = "grid min-w-0 [&>:first-child]:mt-0 [&_strong]:font-bold [&_strong]:text-[#465469] [&_em]:text-[#8791a0] [&_code]:rounded-[4px] [&_code]:bg-[#f0f2f7] [&_code]:px-[5px] [&_code]:py-0.5 [&_code]:font-code [&_code]:text-[.9em] [&_code]:leading-[1.6] [&_code]:font-normal [&_code]:text-[#4e5b70] [&_pre_code]:bg-transparent [&_pre_code]:p-0";
const heading = 'mt-[7px] font-display leading-[1.45] font-bold text-[#38465b]';
const headings = {
  h1: `${heading} border-b border-[#e4e8f0] pb-[9px] text-[19px]`,
  h2: `${heading} border-b border-[#e9ecf2] pb-[7px] text-[15px]`,
  h3: `${heading} text-[13px]`,
  h4: `${heading} text-[12px]`
};
const list = 'm-0 grid gap-1.5 pl-[22px]';
const cell = 'border border-[#e3e7ef] px-[9px] py-[7px] text-left align-top';

function acceptanceProgress(content: string): AcceptanceProgress | null {
  const match = content.match(/<!--\s*acceptance-progress:(\d+):(\d+)\s*-->/);
  return match ? { completed: Number(match[1]), total: Number(match[2]) } : null;
}

function textContent(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(textContent).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return isValidElement<{ children?: ReactNode }>(children) ? textContent(children.props.children) : '';
}

export function MarkdownView({ content, variant = 'default', className = '' }: { content?: string | null; variant?: MarkdownVariant; className?: string }) {
  const source = typeof content === 'string' ? content : '';
  const progress = acceptanceProgress(source);
  const markdown = source.replace(/\s*<!--\s*acceptance-progress:\d+:\d+\s*-->/g, '');
  const progressPercent = progress?.total ? Math.round(progress.completed * 100 / progress.total) : 0;

  return <div className={`${root} ${variants[variant]} ${className}`.trim()}>
    {markdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => <h1 className={headings.h1}>{children}</h1>,
      h2: ({ children }) => textContent(children).trim() === 'Critérios de aceite' && progress ? <section><div className="flex items-center justify-between gap-3"><h2 className={headings.h2}>{children}</h2><span className="text-[9px] font-semibold text-[#657187]">{progress.completed} / {progress.total}</span></div><div className="mt-[7px] h-1.5 overflow-hidden rounded-[99px] bg-[#e9edf3]" role="progressbar" aria-label="Critérios de aceite concluídos" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={Math.max(progress.total, 1)}><span className="block h-full rounded-[inherit] bg-[#19a36b] transition-[width] duration-200 ease-[ease]" style={{ width: progressPercent + '%' }} /></div></section> : <h2 className={headings.h2}>{children}</h2>,
      h3: ({ children }) => <h3 className={headings.h3}>{children}</h3>,
      h4: ({ children }) => <h4 className={headings.h4}>{children}</h4>,
      h5: ({ children }) => <h5 className={headings.h4}>{children}</h5>,
      h6: ({ children }) => <h6 className={headings.h4}>{children}</h6>,
      p: ({ children }) => <p className="m-0 wrap-anywhere">{children}</p>,
      ul: ({ children }) => <ul className={`${list} list-disc`}>{children}</ul>,
      ol: ({ children }) => <ol className={`${list} list-decimal`}>{children}</ol>,
      li: ({ children }) => <li className="pl-0.5">{children}</li>,
      blockquote: ({ children }) => <blockquote className="m-0 rounded-r-[7px] border-l-[3px] border-[#cfd6e5] bg-[#f7f8fb] px-3 py-[9px] text-[#758195]">{children}</blockquote>,
      pre: ({ children }) => <pre className="m-0 overflow-x-auto rounded-[4px] bg-[#f0f2f7] p-3 font-code text-[.9em] leading-[1.6] whitespace-pre text-[#4e5b70]">{children}</pre>,
      table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-[.95em]">{children}</table></div>,
      th: ({ children }) => <th className={`${cell} bg-[#f5f6fa] font-bold text-[#435064]`}>{children}</th>,
      td: ({ children }) => <td className={cell}>{children}</td>,
      a: ({ children, href }) => <a className="text-[#4d5fca] underline underline-offset-2 hover:text-[#3949ae]" href={href} target="_blank" rel="noreferrer">{children}</a>,
      input: ({ checked, type }) => type === 'checkbox' ? <input className="m-0 mr-1.5 align-middle accent-[#5364dd]" type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? 'Critério concluído' : 'Critério pendente'} /> : null
    }}>{markdown}</ReactMarkdown> : <p className="m-0 wrap-anywhere">Nenhum conteúdo Markdown disponível.</p>}
  </div>;
}
