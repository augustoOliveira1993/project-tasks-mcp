import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { Badge } from '../ui/Badge';
import { buttonSecondarySmall, notice } from '../ui/classes';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconChevron, IconCopy } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { copyToClipboard } from '../../lib/clipboard';
import { formatDate } from '../../lib/format';
import { plural, relativeTime } from '../../lib/labels';
import { diffTotals, parsePatch, statusLabels, type FileDiff } from '../../lib/patch';

export type TaskDiffSummary = { _id: string; commit?: string; baseCommit?: string; branch?: string; files?: string[]; at?: string; createdAt?: string; truncated?: boolean; agent?: string };
type TaskDiffFull = TaskDiffSummary & { patch?: string };

const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const statusBase = 'shrink-0 rounded-[5px] px-[7px] py-px text-[10px] font-bold';
const statusTone: Record<FileDiff['status'], string> = {
  added: 'bg-tone-green-bg text-tone-green',
  deleted: 'bg-tone-red-bg text-tone-red',
  renamed: 'bg-tone-amber-bg text-tone-amber',
  modified: 'bg-tone-slate-bg text-tone-slate',
  binary: 'bg-tone-slate-bg text-tone-slate'
};
const lineRow: Record<string, string> = { add: 'bg-[#e9f8ef] font-bold text-[#1a7f4b]', del: 'bg-[#fdeeee] font-bold text-[#b3303c]', note: 'text-ui-xs text-muted-strong', context: '' };
const lineNum: Record<string, string> = { add: 'bg-[#d6f1e0]', del: 'bg-[#f9d9da]', note: 'bg-[#fafbfc]', context: 'bg-[#fafbfc]' };
const lineSign: Record<string, string> = { add: 'text-[#1a7f4b]', del: 'text-[#b3303c]', note: 'text-[#8a94a6]', context: 'text-[#8a94a6]' };
const lineCode: Record<string, string> = { add: '', del: '', note: 'text-muted-strong italic', context: '' };
const numCell = 'w-[1%] min-w-[42px] border-r border-[#eef0f4] px-2 py-0 text-right align-top text-[#8a94a6] select-none';
const counts = 'inline-flex gap-1.5 text-ui-xs';
const countAdd = 'font-bold text-[#1a7f4b]';
const countDel = 'font-bold text-[#b3303c]';
const pathText = 'min-w-0 flex-1 overflow-hidden font-code text-[11.5px] leading-[normal] font-semibold text-ellipsis whitespace-nowrap text-left';
const COLLAPSE_LINES = 300;
const PAGE_LINES = 400;

function fileLineCount(file: FileDiff) {
  return file.hunks.reduce((total, hunk) => total + hunk.lines.length + 1, 0);
}

function FileBlock({ file, open, onToggle }: { file: FileDiff; open: boolean; onToggle: () => void }) {
  const [limit, setLimit] = useState(PAGE_LINES);
  const total = fileLineCount(file);
  let shown = 0;
  return <section className="mt-2 overflow-hidden rounded-ui-sm border border-line">
    <button type="button" className="sticky top-0 flex w-full items-center gap-2 bg-[#f6f7fb] px-2.5 py-2 text-left hover:bg-[#eef0ff]" aria-expanded={open} onClick={onToggle}>
      <IconChevron size={13} className={open ? undefined : '-rotate-90'} />
      <span className={`${statusBase} ${statusTone[file.status]}`}>{statusLabels[file.status]}</span>
      <span className={pathText} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>{file.oldPath ? <><s className="text-muted-strong">{file.oldPath}</s> → {file.path}</> : file.path}</span>
      <span className={counts}><b className={countAdd}>+{file.additions}</b><b className={countDel}>−{file.deletions}</b></span>
    </button>
    {open && (file.binary ? <p className="px-3 py-2.5 text-ui-xs text-muted-strong">Arquivo binário: o conteúdo não é exibido.</p>
      : file.hunks.length === 0 ? <p className="px-3 py-2.5 text-ui-xs text-muted-strong">{file.status === 'renamed' ? 'Arquivo renomeado sem alterações de conteúdo.' : 'Sem alterações de conteúdo neste arquivo.'}</p>
        : <div className="overflow-x-auto bg-white"><table className="w-full border-collapse font-code text-[12px] leading-[1.5]"><tbody>
          {file.hunks.map((hunk, hunkIndex) => {
            if (shown >= limit) return null;
            return [
              <tr key={`h${hunkIndex}`}><td className="bg-[#eef2ff] px-2.5 py-[3px] align-top text-[11px] text-[#4a56a8]" colSpan={3}>{hunk.header}</td></tr>,
              ...hunk.lines.map((line, lineIndex) => {
                shown++;
                if (shown > limit) return null;
                return <tr className={lineRow[line.kind]} key={`${hunkIndex}-${lineIndex}`}>
                  <td className={`${numCell} ${lineNum[line.kind]}`} aria-hidden="true">{line.oldNumber ?? ''}</td>
                  <td className={`${numCell} ${lineNum[line.kind]}`} aria-hidden="true">{line.newNumber ?? ''}</td>
                  <td className={`px-2 py-0 align-top whitespace-pre ${lineCode[line.kind]}`}><span className={`inline-block w-[1.2em] select-none ${lineSign[line.kind]}`} aria-label={line.kind === 'add' ? 'adicionada' : line.kind === 'del' ? 'removida' : undefined}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>{line.text || ' '}</td>
                </tr>;
              })
            ];
          })}
        </tbody></table>{total > limit && <button type="button" className="block w-full bg-[#f6f7fb] p-2 text-[11px] font-semibold text-[#5c6bd5] hover:text-[#3748bf]" onClick={() => setLimit(current => current + PAGE_LINES * 2)}>Mostrar mais ({total - limit} linhas restantes)</button>}</div>)}
  </section>;
}

function DiffDetail({ token, nonce, projectId, taskId, summary }: { token: string; nonce: string; projectId: string; taskId: string; summary: TaskDiffSummary }) {
  const detail = useQuery({
    queryKey: ['task-diff', nonce, projectId, taskId, summary._id],
    queryFn: () => query<TaskDiffFull>(token, 'get_task_diff', { projectId, taskId, id: summary._id })
  });
  const [filter, setFilter] = useState('');
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const patch = detail.data?.patch ?? '';
  const files = useMemo(() => parsePatch(patch), [patch]);
  const totals = diffTotals(files);
  const listed = detail.data?.files ?? summary.files ?? [];
  const parsedPaths = new Set(files.flatMap(file => [file.path, file.oldPath ?? '']));
  const missing = listed.filter(path => !parsedPaths.has(path));
  const needle = filter.trim().toLocaleLowerCase('pt-BR');
  const visible = files.filter(file => !needle || file.path.toLocaleLowerCase('pt-BR').includes(needle) || (file.oldPath ?? '').toLocaleLowerCase('pt-BR').includes(needle));
  const isOpen = (file: FileDiff) => openFiles[file.path] ?? (files.length === 1 || fileLineCount(file) <= COLLAPSE_LINES && files.length <= 8);

  function setAll(open: boolean) {
    setOpenFiles(Object.fromEntries(files.map(file => [file.path, open])));
  }

  async function copyPatch() {
    if (await copyToClipboard(patch)) { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
  }

  function downloadPatch() {
    const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-diff' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(summary.commit ?? summary._id).slice(0, 8)}.patch`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (detail.isPending) return <Skeleton rows={4} label="Carregando diff completo…" />;
  if (detail.isError) return <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} title="Não foi possível carregar o diff" />;
  return <div className="grid gap-3 border-t border-line px-4 pt-3 pb-4">
    {(detail.data?.truncated || summary.truncated) && <p className={notice.info} role="note">O patch foi truncado ao ser publicado (limite de 100 KB). Alguns arquivos podem aparecer incompletos ou ausentes.</p>}
    {!patch ? <p className={emptyInline}>Este diff foi publicado sem o patch; só a lista de arquivos está disponível.</p> : <>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto text-ui-sm text-ink-2">{plural(files.length, 'arquivo', 'arquivos')} · <span className={countAdd}>+{totals.additions}</span> <span className={countDel}>−{totals.deletions}</span></strong>
        <input className="min-h-[30px] w-[170px] rounded-ui-sm border border-line-strong px-2 py-0 text-ui-xs" type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filtrar arquivos" aria-label="Filtrar arquivos do diff" />
        <button type="button" className={buttonSecondarySmall} onClick={() => setAll(true)}>Expandir tudo</button>
        <button type="button" className={buttonSecondarySmall} onClick={() => setAll(false)}>Recolher tudo</button>
        <button type="button" className={buttonSecondarySmall} onClick={() => void copyPatch()}><IconCopy size={12} /> {copied ? 'Copiado' : 'Copiar patch'}</button>
        <button type="button" className={buttonSecondarySmall} onClick={downloadPatch}>Baixar .patch</button>
      </div>
      {files.length > 1 && <ul className="m-0 grid max-h-[190px] list-none gap-0.5 overflow-y-auto rounded-ui-sm border border-line bg-[#fafbfd] p-1.5" aria-label="Arquivos alterados">{visible.map(file => <li key={file.path}><a className="flex items-center gap-2 rounded-[4px] px-1.5 py-1 text-ui-xs text-ink-2 no-underline hover:bg-[#eef0ff]" href={`#diff-${summary._id}-${encodeURIComponent(file.path)}`} onClick={event => { event.preventDefault(); setOpenFiles(current => ({ ...current, [file.path]: true })); window.requestAnimationFrame(() => document.getElementById(`diff-${summary._id}-${encodeURIComponent(file.path)}`)?.scrollIntoView({ block: 'start' })); }}><span className={`${statusBase} ${statusTone[file.status]}`}>{statusLabels[file.status]}</span><span className={pathText}>{file.path}</span><span className={counts}><b className={countAdd}>+{file.additions}</b><b className={countDel}>−{file.deletions}</b></span></a></li>)}</ul>}
      {visible.length ? visible.map(file => <div id={`diff-${summary._id}-${encodeURIComponent(file.path)}`} key={file.path}><FileBlock file={file} open={isOpen(file)} onToggle={() => setOpenFiles(current => ({ ...current, [file.path]: !isOpen(file) }))} /></div>) : <p className={emptyInline}>Nenhum arquivo corresponde ao filtro.</p>}
    </>}
    {missing.length > 0 && <details className="text-ui-xs text-muted-strong"><summary className="cursor-pointer font-bold">{plural(missing.length, 'arquivo listado sem conteúdo no patch', 'arquivos listados sem conteúdo no patch')}</summary><ul className="mt-1.5 pl-[18px]">{missing.map(path => <li key={path}><code>{path}</code></li>)}</ul></details>}
  </div>;
}

export function TaskDiffsPanel({ token, nonce, projectId, taskId, items, isPending, isError, error, onRetry }: {
  token: string; nonce: string; projectId: string; taskId: string; items: TaskDiffSummary[]; isPending: boolean; isError: boolean; error: unknown; onRetry: () => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  if (isPending) return <Skeleton rows={3} label="Carregando diffs…" />;
  if (isError) return <ErrorNotice error={error} onRetry={onRetry} />;
  if (!items.length) return <p className={emptyInline}>Nenhum diff Git publicado para esta tarefa.</p>;
  const isOpen = (id: string) => openIds.has(id) || items.length === 1;
  return <div className="grid gap-3">{items.map(item => {
    const open = isOpen(item._id);
    return <article className="overflow-hidden rounded-ui-md border border-line bg-white" key={item._id}>
      <button type="button" className="flex w-full items-center gap-2 bg-[#fbfcff] px-3.5 py-2.5 text-left hover:bg-[#f3f5ff]" aria-expanded={open} onClick={() => setOpenIds(current => { const next = new Set(current); if (next.has(item._id)) next.delete(item._id); else next.add(item._id); return next; })}>
        <IconChevron size={14} className={open ? undefined : '-rotate-90'} />
        <span className="grid min-w-0 flex-1 gap-0.5"><strong className="overflow-hidden text-ui-sm text-ellipsis whitespace-nowrap text-ink">{item.branch || 'Commit ' + (item.commit ?? '').slice(0, 8)}</strong><small className="text-ui-xs text-muted-strong">{plural((item.files ?? []).length, 'arquivo', 'arquivos')} · <time dateTime={item.at ?? item.createdAt} title={formatDate(item.at ?? item.createdAt)}>{relativeTime(item.at ?? item.createdAt)}</time>{item.agent ? ` · ${item.agent}` : ''}</small></span>
        {item.commit && <Badge title={item.baseCommit ? `${item.baseCommit.slice(0, 8)}..${item.commit.slice(0, 8)}` : item.commit}>{item.commit.slice(0, 7)}</Badge>}
      </button>
      {open && <DiffDetail token={token} nonce={nonce} projectId={projectId} taskId={taskId} summary={item} />}
    </article>;
  })}</div>;
}
