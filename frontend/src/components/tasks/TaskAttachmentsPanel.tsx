import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteTaskAttachment, downloadTaskAttachment, listTaskAttachments, MAX_TASK_ATTACHMENT_BYTES, renameTaskAttachment, uploadTaskAttachment, type TaskAttachment } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { plural } from '../../lib/labels';
import { ErrorNotice } from '../ui/ErrorNotice';
import { buttonBase, buttonSecondarySmall, notice } from '../ui/classes';

const buttonPrimarySmall = `${buttonBase} min-h-[29px] border-transparent bg-accent px-2.5 text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const buttonPlainSmall = `${buttonBase} min-h-[29px] border-transparent px-2.5`;
const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const previewBox = 'max-w-full rounded-ui-sm border border-line bg-[#f8f9fc] p-[7px]';
const sheetCell = 'max-w-[280px] border-r border-b border-[#e7eaf0] px-[9px] py-1.5 text-left align-top wrap-anywhere';

const MAX_SPREADSHEET_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 100;
const MAX_PREVIEW_COLUMNS = 20;
type PreviewKind = 'image' | 'pdf' | 'spreadsheet';
type SpreadsheetPreview = { sheetName: string; rows: unknown[][]; truncated: boolean };

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string) {
  return name.split('.').at(-1)?.toLocaleLowerCase() ?? '';
}

function previewKind(attachment: TaskAttachment): PreviewKind | null {
  const extension = extensionOf(attachment.name);
  if (/^image\/(avif|bmp|gif|jpeg|png|webp)$/i.test(attachment.contentType) || ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension)) return 'image';
  if (attachment.contentType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (['csv', 'xls', 'xlsx'].includes(extension) || ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(attachment.contentType)) return 'spreadsheet';
  return null;
}

function fileBadge(attachment: TaskAttachment) {
  const kind = previewKind(attachment);
  if (kind === 'image') return 'IMG';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'spreadsheet') return 'XLS';
  const extension = extensionOf(attachment.name).replace(/[^a-z0-9]/g, '').slice(0, 4);
  return extension ? extension.toUpperCase() : 'ARQ';
}

function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function cellText(cell: unknown) {
  return cell === null || cell === undefined ? '' : String(cell);
}

function AttachmentRow({ token, projectId, taskId, attachment, onRename, onDelete }: {
  token: string;
  projectId: string;
  taskId: string;
  attachment: TaskAttachment;
  onRename: (attachmentId: string, fileName: string) => Promise<void>;
  onDelete: (attachment: TaskAttachment) => Promise<void>;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'download' | 'rename' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nextName, setNextName] = useState(attachment.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const kind = previewKind(attachment);
  const hasPreview = kind !== null;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function togglePreview() {
    setError('');
    setStatus('');
    if (previewUrl || spreadsheet) { setPreviewUrl(null); setSpreadsheet(null); return; }
    if (!kind) return;
    if (kind === 'spreadsheet' && attachment.size > MAX_SPREADSHEET_PREVIEW_BYTES) {
      setError(`A prévia de planilhas está limitada a ${formatFileSize(MAX_SPREADSHEET_PREVIEW_BYTES)}. Baixe o arquivo para abrir a versão completa.`);
      return;
    }
    setBusy('preview');
    try {
      const original = await downloadTaskAttachment(token, projectId, taskId, attachment.id);
      if (kind === 'spreadsheet') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await original.arrayBuffer(), { type: 'array', sheetRows: MAX_PREVIEW_ROWS + 1 });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
        if (!sheet || !sheetName) throw new Error('A planilha não contém uma aba que possa ser visualizada.');
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
        const truncated = rows.length > MAX_PREVIEW_ROWS || rows.some(row => row.length > MAX_PREVIEW_COLUMNS);
        setSpreadsheet({
          sheetName,
          rows: rows.slice(0, MAX_PREVIEW_ROWS).map(row => row.slice(0, MAX_PREVIEW_COLUMNS)),
          truncated
        });
      } else {
        const contentType = kind === 'pdf' ? 'application/pdf' : attachment.contentType;
        setPreviewUrl(URL.createObjectURL(new Blob([original], { type: contentType })));
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  async function download() {
    setError('');
    setStatus('');
    setBusy('download');
    try { saveFile(await downloadTaskAttachment(token, projectId, taskId, attachment.id), attachment.name); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fileName = nextName.trim();
    if (!fileName) { setError('Informe um nome para o arquivo.'); return; }
    if (new TextEncoder().encode(fileName).length > 255) { setError('O nome deve ter no máximo 255 bytes.'); return; }
    setError('');
    setBusy('rename');
    try {
      await onRename(attachment.id, fileName);
      setEditingName(false);
      setStatus('Nome atualizado.');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  async function confirmDelete() {
    setError('');
    setStatus('');
    setBusy('delete');
    try { await onDelete(attachment); }
    catch (cause) { setError(errorMessage(cause)); setConfirmingDelete(false); }
    finally { setBusy(null); }
  }

  return <li className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-3 rounded-ui-md border border-line bg-white p-3 max-[720px]:grid-cols-[36px_minmax(0,1fr)]" aria-busy={busy !== null}>
    <div className="grid h-[42px] w-[42px] place-items-center rounded-ui-sm bg-tone-blue-bg text-[9px] font-extrabold text-tone-blue max-[720px]:h-9 max-[720px]:w-9" aria-hidden="true">{fileBadge(attachment)}</div>
    <div className="grid min-w-0 gap-1">
      <strong className="text-ui-sm text-ink-2 wrap-anywhere" title={attachment.name}>{attachment.name}</strong>
      <small className="text-ui-xs text-muted-strong wrap-anywhere">{formatFileSize(attachment.size)} · {attachment.contentType} · {formatDate(attachment.createdAt)}</small>
      {error && <span className="text-ui-xs text-tone-red wrap-anywhere" role="alert">{error}</span>}
      {status && <span className="text-ui-xs text-tone-green" role="status">{status}</span>}
      {previewUrl && kind === 'image' && <div className={previewBox}><img className="block max-h-[360px] w-auto max-w-[min(100%,480px)] object-contain" src={previewUrl} alt={`Prévia de ${attachment.name}`} /></div>}
      {previewUrl && kind === 'pdf' && <div className={`${previewBox} grid gap-[7px]`}><iframe className="block h-[min(70vh,620px)] min-h-[320px] w-[min(100%,760px)] rounded-[5px] bg-white max-[720px]:min-h-[260px]" src={previewUrl} title={`Prévia de ${attachment.name}`} />
        <p className="text-ui-xs text-muted-strong">Se o PDF não aparecer no navegador, use Baixar para abri-lo.</p></div>}
      {spreadsheet && <div className={`${previewBox} grid gap-[7px] overflow-hidden`}>
        <strong className="text-ui-xs text-ink-2">{spreadsheet.sheetName}</strong>
        {spreadsheet.rows.length ? <div className="max-w-full overflow-auto rounded-ui-sm border border-line bg-white"><table className="w-max min-w-full border-collapse text-ui-xs"><tbody>{spreadsheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => {
          const value = cellText(cell);
          return rowIndex === 0
            ? <th className={`${sheetCell} sticky top-0 bg-[#f0f2f8] font-bold text-ink-2`} key={columnIndex} scope="col">{value || `Coluna ${columnIndex + 1}`}</th>
            : <td className={sheetCell} key={columnIndex}>{value}</td>;
        })}</tr>)}</tbody></table></div> : <p className={emptyInline}>A planilha está vazia.</p>}
        {spreadsheet.truncated && <small className="text-ui-xs text-muted-strong">Prévia limitada às primeiras {MAX_PREVIEW_ROWS} linhas e {MAX_PREVIEW_COLUMNS} colunas.</small>}
      </div>}
      {editingName && <form className="grid gap-[7px] rounded-ui-sm border border-line bg-[#fafbfe] p-2.5" onSubmit={event => void saveName(event)}>
        <label className="text-ui-xs font-bold text-ink-2" htmlFor={`attachment-name-${attachment.id}`}>Novo nome do arquivo</label>
        <input className="min-h-[38px] w-full rounded-[7px] border border-line-strong bg-white px-2.5 text-ui-sm" id={`attachment-name-${attachment.id}`} value={nextName} maxLength={255} onChange={event => setNextName(event.currentTarget.value)} disabled={busy !== null} autoFocus />
        <div className="flex flex-wrap gap-1.5"><button type="submit" className={buttonPrimarySmall} disabled={busy !== null}>{busy === 'rename' ? 'Salvando…' : 'Salvar nome'}</button>
          <button type="button" className={buttonSecondarySmall} disabled={busy !== null} onClick={() => { setEditingName(false); setNextName(attachment.name); setError(''); }}>Cancelar</button></div>
      </form>}
      {confirmingDelete && <div className="flex flex-wrap items-center gap-[7px] rounded-ui-sm border border-[#efd7d9] bg-[#fffafa] px-2.5 py-[9px]" role="group" aria-label={`Confirmação para excluir ${attachment.name}`}>
        <p className="flex-[1_1_100%] text-ui-xs font-semibold text-tone-red">Excluir permanentemente “{attachment.name}”?</p>
        <button type="button" className={buttonPlainSmall} disabled={busy !== null} onClick={() => void confirmDelete()}>{busy === 'delete' ? 'Excluindo…' : 'Confirmar exclusão'}</button>
        <button type="button" className={buttonSecondarySmall} disabled={busy !== null} onClick={() => setConfirmingDelete(false)}>Cancelar</button>
      </div>}
    </div>
    <div className="flex flex-wrap justify-end gap-1.5 max-[720px]:col-span-full max-[720px]:justify-start">
      {hasPreview && <button type="button" className={buttonSecondarySmall} aria-label={`${previewUrl || spreadsheet ? 'Ocultar prévia de' : 'Visualizar'} ${attachment.name}`} disabled={busy !== null} onClick={() => void togglePreview()}>{busy === 'preview' ? 'Carregando…' : previewUrl || spreadsheet ? 'Ocultar prévia' : 'Visualizar'}</button>}
      <button type="button" className={buttonSecondarySmall} disabled={busy !== null} onClick={() => void download()}>{busy === 'download' ? 'Baixando…' : 'Baixar'}</button>
      <button type="button" className={buttonSecondarySmall} aria-label={`Renomear ${attachment.name}`} disabled={busy !== null || editingName || confirmingDelete} onClick={() => { setNextName(attachment.name); setEditingName(true); setError(''); }}>Renomear</button>
      <button type="button" className={buttonSecondarySmall} aria-label={`Excluir ${attachment.name}`} disabled={busy !== null || editingName || confirmingDelete} onClick={() => { setConfirmingDelete(true); setError(''); }}>Excluir</button>
    </div>
  </li>;
}

export function TaskAttachmentsPanel({ token, nonce, projectId, taskId }: { token: string; nonce: string; projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['task-attachments', nonce, projectId, taskId];
  const attachments = useQuery({ queryKey, queryFn: () => listTaskAttachments(token, projectId, taskId) });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState('');

  async function addFiles(files: File[]) {
    if (!files.length || isUploading) return;
    setIsUploading(true);
    setUploadMessage('');
    setUploadErrors([]);
    let uploaded = 0;
    const errors: string[] = [];
    for (const file of files) {
      if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
        errors.push(`${file.name}: o arquivo deve ter no máximo 25 MiB.`);
        continue;
      }
      setUploadingName(file.name);
      setUploadProgress(0);
      try {
        await uploadTaskAttachment(token, projectId, taskId, file, setUploadProgress);
        uploaded++;
      } catch (cause) { errors.push(`${file.name}: ${errorMessage(cause)}`); }
    }
    setUploadingName('');
    setUploadProgress(null);
    setIsUploading(false);
    setUploadErrors(errors);
    if (uploaded) {
      setUploadMessage(`${uploaded} ${plural(uploaded, 'arquivo enviado', 'arquivos enviados')}.`);
      await queryClient.invalidateQueries({ queryKey });
    }
  }

  async function rename(attachmentId: string, fileName: string) {
    await renameTaskAttachment(token, projectId, taskId, attachmentId, fileName);
    setActionMessage('Nome do arquivo atualizado.');
    await queryClient.invalidateQueries({ queryKey });
  }

  async function remove(attachment: TaskAttachment) {
    await deleteTaskAttachment(token, projectId, taskId, attachment.id);
    setActionMessage(`Arquivo ${attachment.name} excluído.`);
    await queryClient.invalidateQueries({ queryKey });
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void addFiles(files);
  }

  return <section className="grid gap-3" aria-label="Arquivos anexados">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="grid gap-1"><h3 className="font-display text-[13px] leading-[normal] font-bold text-ink normal-case">Arquivos anexados</h3><p className={emptyInline}>Envie fotos e outros arquivos para mantê-los disponíveis nesta tarefa.</p></div></div>
    <label className="grid gap-[7px] rounded-ui-md border border-dashed border-line-strong bg-[#fbfcff] p-4 text-ui-sm font-bold text-ink-2">
      <span>Adicionar arquivos</span>
      <input className="max-w-full min-w-0 text-ui-xs text-muted-strong" type="file" multiple disabled={isUploading} onChange={onFilesSelected} aria-describedby="task-attachment-help" />
      <small className="text-ui-xs leading-[1.5] font-normal text-muted-strong" id="task-attachment-help">Até 25 MiB por arquivo. Há prévia para imagens, PDF, Excel e CSV; outros formatos mostram o tipo e podem ser baixados.</small>
    </label>
    {uploadingName && <div className="grid gap-1.5 text-ui-xs text-muted-strong" role="status" aria-live="polite">
      <span>Enviando {uploadingName}{uploadProgress === null ? '…' : ` · ${uploadProgress}%`}</span>
      <progress className="h-2 w-full accent-focus" max={100} aria-label={`Progresso do envio de ${uploadingName}`} {...(uploadProgress === null ? {} : { value: uploadProgress })} />
    </div>}
    {uploadMessage && <p className={notice.success} role="status">{uploadMessage}</p>}
    {actionMessage && <p className={notice.success} role="status" aria-live="polite">{actionMessage}</p>}
    {uploadErrors.length > 0 && <ul className="m-0 grid gap-[5px] rounded-ui-sm border border-[#efd7d9] bg-[#fffafa] py-2.5 pr-3 pl-7 text-ui-xs text-tone-red wrap-anywhere" role="alert">{uploadErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    {attachments.isPending ? <p className={emptyInline} role="status">Carregando arquivos…</p>
      : attachments.isError ? <ErrorNotice error={attachments.error} onRetry={() => void attachments.refetch()} retrying={attachments.isFetching} title="Não foi possível carregar os arquivos" />
        : attachments.data?.length ? <ul className="m-0 grid list-none gap-2 p-0">{attachments.data.map(attachment => <AttachmentRow key={attachment.id} token={token} projectId={projectId} taskId={taskId} attachment={attachment} onRename={rename} onDelete={remove} />)}</ul>
          : <p className={emptyInline}>Nenhum arquivo anexado ainda.</p>}
  </section>;
}
