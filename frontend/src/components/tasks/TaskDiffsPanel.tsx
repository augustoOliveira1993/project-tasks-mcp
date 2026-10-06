import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { Badge } from '../ui/Badge';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconChevron, IconCopy } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { copyToClipboard } from '../../lib/clipboard';
import { formatDate } from '../../lib/format';
import { plural, relativeTime } from '../../lib/labels';
import { diffTotals, parsePatch, statusLabels, type FileDiff } from '../../lib/patch';

export type TaskDiffSummary = { _id: string; commit?: string; baseCommit?: string; branch?: string; files?: string[]; at?: string; createdAt?: string; truncated?: boolean; agent?: string };
type TaskDiffFull = TaskDiffSummary & { patch?: string };

const COLLAPSE_LINES = 300;
const PAGE_LINES = 400;

function fileLineCount(file: FileDiff) {
  return file.hunks.reduce((total, hunk) => total + hunk.lines.length + 1, 0);
}

function FileBlock({ file, open, onToggle }: { file: FileDiff; open: boolean; onToggle: () => void }) {
  const [limit, setLimit] = useState(PAGE_LINES);
  const total = fileLineCount(file);
  let shown = 0;
  return <section className={`diff-file diff-file-${file.status}`}>
    <button type="button" className="diff-file-head" aria-expanded={open} onClick={onToggle}>
      <IconChevron size={13} className={open ? undefined : 'diff-chevron-closed'} />
      <span className={`diff-status diff-status-${file.status}`}>{statusLabels[file.status]}</span>
      <span className="diff-path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>{file.oldPath ? <><s>{file.oldPath}</s> → {file.path}</> : file.path}</span>
      <span className="diff-counts"><b className="diff-add">+{file.additions}</b><b className="diff-del">−{file.deletions}</b></span>
    </button>
    {open && (file.binary ? <p className="diff-note">Arquivo binário: o conteúdo não é exibido.</p>
      : file.hunks.length === 0 ? <p className="diff-note">{file.status === 'renamed' ? 'Arquivo renomeado sem alterações de conteúdo.' : 'Sem alterações de conteúdo neste arquivo.'}</p>
        : <div className="diff-scroll"><table className="diff-table"><tbody>
          {file.hunks.map((hunk, hunkIndex) => {
            if (shown >= limit) return null;
            return [
              <tr className="diff-hunk" key={`h${hunkIndex}`}><td colSpan={3}>{hunk.header}</td></tr>,
              ...hunk.lines.map((line, lineIndex) => {
                shown++;
                if (shown > limit) return null;
                return <tr className={`diff-line diff-${line.kind}`} key={`${hunkIndex}-${lineIndex}`}>
                  <td className="diff-num" aria-hidden="true">{line.oldNumber ?? ''}</td>
                  <td className="diff-num" aria-hidden="true">{line.newNumber ?? ''}</td>
                  <td className="diff-code"><span className="diff-sign" aria-label={line.kind === 'add' ? 'adicionada' : line.kind === 'del' ? 'removida' : undefined}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>{line.text || ' '}</td>
                </tr>;
              })
            ];
          })}
        </tbody></table>{total > limit && <button type="button" className="text-button diff-more" onClick={() => setLimit(current => current + PAGE_LINES * 2)}>Mostrar mais ({total - limit} linhas restantes)</button>}</div>)}
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
  return <div className="diff-detail">
    {(detail.data?.truncated || summary.truncated) && <p className="notice" role="note">O patch foi truncado ao ser publicado (limite de 100 KB). Alguns arquivos podem aparecer incompletos ou ausentes.</p>}
    {!patch ? <p className="empty-inline">Este diff foi publicado sem o patch; só a lista de arquivos está disponível.</p> : <>
      <div className="diff-toolbar">
        <strong>{plural(files.length, 'arquivo', 'arquivos')} · <span className="diff-add">+{totals.additions}</span> <span className="diff-del">−{totals.deletions}</span></strong>
        <input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filtrar arquivos" aria-label="Filtrar arquivos do diff" />
        <button type="button" className="button secondary small-button" onClick={() => setAll(true)}>Expandir tudo</button>
        <button type="button" className="button secondary small-button" onClick={() => setAll(false)}>Recolher tudo</button>
        <button type="button" className="button secondary small-button" onClick={() => void copyPatch()}><IconCopy size={12} /> {copied ? 'Copiado' : 'Copiar patch'}</button>
        <button type="button" className="button secondary small-button" onClick={downloadPatch}>Baixar .patch</button>
      </div>
      {files.length > 1 && <ul className="diff-index" aria-label="Arquivos alterados">{visible.map(file => <li key={file.path}><a href={`#diff-${summary._id}-${encodeURIComponent(file.path)}`} onClick={event => { event.preventDefault(); setOpenFiles(current => ({ ...current, [file.path]: true })); window.requestAnimationFrame(() => document.getElementById(`diff-${summary._id}-${encodeURIComponent(file.path)}`)?.scrollIntoView({ block: 'start' })); }}><span className={`diff-status diff-status-${file.status}`}>{statusLabels[file.status]}</span><span className="diff-path">{file.path}</span><span className="diff-counts"><b className="diff-add">+{file.additions}</b><b className="diff-del">−{file.deletions}</b></span></a></li>)}</ul>}
      {visible.length ? visible.map(file => <div id={`diff-${summary._id}-${encodeURIComponent(file.path)}`} key={file.path}><FileBlock file={file} open={isOpen(file)} onToggle={() => setOpenFiles(current => ({ ...current, [file.path]: !isOpen(file) }))} /></div>) : <p className="empty-inline">Nenhum arquivo corresponde ao filtro.</p>}
    </>}
    {missing.length > 0 && <details className="diff-missing"><summary>{plural(missing.length, 'arquivo listado sem conteúdo no patch', 'arquivos listados sem conteúdo no patch')}</summary><ul>{missing.map(path => <li key={path}><code>{path}</code></li>)}</ul></details>}
  </div>;
}

export function TaskDiffsPanel({ token, nonce, projectId, taskId, items, isPending, isError, error, onRetry }: {
  token: string; nonce: string; projectId: string; taskId: string; items: TaskDiffSummary[]; isPending: boolean; isError: boolean; error: unknown; onRetry: () => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  if (isPending) return <Skeleton rows={3} label="Carregando diffs…" />;
  if (isError) return <ErrorNotice error={error} onRetry={onRetry} />;
  if (!items.length) return <p className="empty-inline">Nenhum diff Git publicado para esta tarefa.</p>;
  const isOpen = (id: string) => openIds.has(id) || items.length === 1;
  return <div className="diff-commits">{items.map(item => {
    const open = isOpen(item._id);
    return <article className="diff-commit" key={item._id}>
      <button type="button" className="diff-commit-head" aria-expanded={open} onClick={() => setOpenIds(current => { const next = new Set(current); if (next.has(item._id)) next.delete(item._id); else next.add(item._id); return next; })}>
        <IconChevron size={14} className={open ? undefined : 'diff-chevron-closed'} />
        <span className="diff-commit-title"><strong>{item.branch || 'Commit ' + (item.commit ?? '').slice(0, 8)}</strong><small>{plural((item.files ?? []).length, 'arquivo', 'arquivos')} · <time dateTime={item.at ?? item.createdAt} title={formatDate(item.at ?? item.createdAt)}>{relativeTime(item.at ?? item.createdAt)}</time>{item.agent ? ` · ${item.agent}` : ''}</small></span>
        {item.commit && <Badge title={item.baseCommit ? `${item.baseCommit.slice(0, 8)}..${item.commit.slice(0, 8)}` : item.commit}>{item.commit.slice(0, 7)}</Badge>}
      </button>
      {open && <DiffDetail token={token} nonce={nonce} projectId={projectId} taskId={taskId} summary={item} />}
    </article>;
  })}</div>;
}
