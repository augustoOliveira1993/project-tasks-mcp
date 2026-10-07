import { useEffect, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { downloadTaskAttachment, listTaskAttachments, MAX_TASK_ATTACHMENT_BYTES, uploadTaskAttachment, type TaskAttachment } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { plural } from '../../lib/labels';
import { ErrorNotice } from '../ui/ErrorNotice';

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewableImage(attachment: TaskAttachment) {
  return /^image\/(avif|bmp|gif|jpeg|png|webp)$/i.test(attachment.contentType);
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

function AttachmentRow({ token, projectId, taskId, attachment }: { token: string; projectId: string; taskId: string; attachment: TaskAttachment }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [error, setError] = useState('');
  const image = isPreviewableImage(attachment);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function togglePreview() {
    setError('');
    if (previewUrl) { setPreviewUrl(null); return; }
    setBusy('preview');
    try {
      const original = await downloadTaskAttachment(token, projectId, taskId, attachment.id);
      setPreviewUrl(URL.createObjectURL(new Blob([original], { type: attachment.contentType })));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  async function download() {
    setError('');
    setBusy('download');
    try { saveFile(await downloadTaskAttachment(token, projectId, taskId, attachment.id), attachment.name); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  return <li className="task-attachment-card" aria-busy={busy !== null}>
    <div className="task-attachment-file-icon" aria-hidden="true">{image ? 'IMG' : 'ARQ'}</div>
    <div className="task-attachment-info">
      <strong title={attachment.name}>{attachment.name}</strong>
      <small>{formatFileSize(attachment.size)} · {attachment.contentType} · {formatDate(attachment.createdAt)}</small>
      {error && <span className="task-attachment-error" role="alert">{error}</span>}
      {previewUrl && <div className="task-attachment-preview"><img src={previewUrl} alt={`Prévia de ${attachment.name}`} /></div>}
    </div>
    <div className="task-attachment-actions">
      {image && <button type="button" className="button secondary small-button" disabled={busy !== null} onClick={() => void togglePreview()}>{busy === 'preview' ? 'Carregando…' : previewUrl ? 'Ocultar prévia' : 'Visualizar'}</button>}
      <button type="button" className="button secondary small-button" disabled={busy !== null} onClick={() => void download()}>{busy === 'download' ? 'Baixando…' : 'Baixar'}</button>
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

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void addFiles(files);
  }

  return <section className="drawer-section task-attachments-panel" aria-label="Arquivos anexados">
    <div className="drawer-section-head"><div><h3>Arquivos anexados</h3><p className="empty-inline">Envie fotos e outros arquivos para mantê-los disponíveis nesta tarefa.</p></div></div>
    <label className="task-attachment-upload">
      <span>Adicionar arquivos</span>
      <input type="file" multiple disabled={isUploading} onChange={onFilesSelected} aria-describedby="task-attachment-help" />
      <small id="task-attachment-help">Até 25 MiB por arquivo. Imagens PNG, JPEG, GIF, WebP, BMP e AVIF podem ser visualizadas.</small>
    </label>
    {uploadingName && <div className="task-attachment-progress" role="status" aria-live="polite">
      <span>Enviando {uploadingName}{uploadProgress === null ? '…' : ` · ${uploadProgress}%`}</span>
      <progress max={100} aria-label={`Progresso do envio de ${uploadingName}`} {...(uploadProgress === null ? {} : { value: uploadProgress })} />
    </div>}
    {uploadMessage && <p className="notice success" role="status">{uploadMessage}</p>}
    {uploadErrors.length > 0 && <ul className="task-attachment-errors" role="alert">{uploadErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    {attachments.isPending ? <p className="empty-inline" role="status">Carregando arquivos…</p>
      : attachments.isError ? <ErrorNotice error={attachments.error} onRetry={() => void attachments.refetch()} retrying={attachments.isFetching} title="Não foi possível carregar os arquivos" />
        : attachments.data?.length ? <ul className="task-attachment-list">{attachments.data.map(attachment => <AttachmentRow key={attachment.id} token={token} projectId={projectId} taskId={taskId} attachment={attachment} />)}</ul>
          : <p className="empty-inline">Nenhum arquivo anexado ainda.</p>}
  </section>;
}
