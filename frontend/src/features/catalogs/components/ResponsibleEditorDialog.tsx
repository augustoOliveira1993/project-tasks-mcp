import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminCredentials, operationId, request } from '../../../api';
import type { AdminCredential, ResponsibleProfile } from '../../../api';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { ErrorNotice } from '../../../components/ui/ErrorNotice';
import { SkeletonRows } from '../../../components/ui/skeleton';
import { formatDate, errorMessage } from '../../../lib/format';
import { notice, buttonSecondary } from '../../../components/ui/classes';

type PreparedAvatar = { contentType: ResponsibleProfile['contentType']; data: string };

const avatarLimit = 96 * 1024;
const acceptedImageTypes = ['image/png', 'image/jpeg', 'image/webp'];

function readBlobAsBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível preparar a imagem.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') return reject(new Error('Não foi possível ler a imagem.'));
      const comma = reader.result.indexOf(',');
      if (comma < 0) return reject(new Error('Formato de imagem inválido.'));
      resolve(reader.result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function prepareAvatar(file: File): Promise<PreparedAvatar> {
  if (!acceptedImageTypes.includes(file.type)) throw new Error('Escolha uma imagem PNG, JPEG ou WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('A imagem original deve ter até 10 MiB.');

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('O arquivo não pôde ser aberto como imagem.'));
      element.src = imageUrl;
    });
    const square = Math.min(image.naturalWidth, image.naturalHeight);
    if (!square) throw new Error('A imagem não possui dimensões válidas.');
    const left = (image.naturalWidth - square) / 2;
    const top = (image.naturalHeight - square) / 2;

    for (const size of [256, 192, 128, 96]) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Este navegador não conseguiu preparar a imagem.');
      context.drawImage(image, left, top, square, square, 0, 0, size, size);

      for (const quality of [0.84, 0.72, 0.6]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || !acceptedImageTypes.includes(blob.type)) continue;
        if (blob.size <= avatarLimit) return { contentType: blob.type as ResponsibleProfile['contentType'], data: await readBlobAsBase64(blob) };
      }
    }
    throw new Error('A imagem ainda excede 96 KiB depois da redução. Escolha outra imagem.');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function loadCredentials(token: string, email: string) {
  const items: AdminCredential[] = [];
  let after: string | undefined;
  do {
    const page = await listAdminCredentials(token, { email, limit: 100, ...(after ? { after } : {}) });
    items.push(...page.items.filter(item => item.email.toLowerCase() === email.toLowerCase()));
    after = page.next ?? undefined;
  } while (after);
  return items;
}

export function ResponsibleEditorDialog({ open, token, nonce, email, avatarUrl, onOpenChange, onChanged, notify }: {
  open: boolean;
  token: string;
  nonce: string;
  email: string;
  avatarUrl?: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void | Promise<unknown>;
  notify: (message: string, kind?: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedCredential, setSelectedCredential] = useState<AdminCredential | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [preparingAvatar, setPreparingAvatar] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState<PreparedAvatar | null>(null);
  const [removedAvatar, setRemovedAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const credentials = useQuery({
    queryKey: ['admin-credentials', 'responsible-editor', nonce, email.toLowerCase()],
    queryFn: () => loadCredentials(token, email),
    enabled: open && Boolean(token && email),
    staleTime: 0,
    retry: false
  });
  const previewUrl = pendingAvatar ? `data:${pendingAvatar.contentType};base64,${pendingAvatar.data}` : removedAvatar ? undefined : avatarUrl;
  const matchingCredentials = credentials.data ?? [];

  async function confirmRevoke() {
    if (!selectedCredential) return;
    setRevoking(true);
    try {
      await request(token, '/admin', { body: { action: 'revoke', operationId: operationId(), credentialId: selectedCredential.credentialId } });
      setSelectedCredential(null);
      notify('Credencial revogada. O inventário foi atualizado.', 'success');
      await Promise.all([credentials.refetch(), queryClient.invalidateQueries({ queryKey: ['responsibles'] }), onChanged()]);
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setRevoking(false);
    }
  }

  async function chooseAvatar(file?: File) {
    if (!file) return;
    setAvatarError('');
    setPreparingAvatar(true);
    try {
      setPendingAvatar(await prepareAvatar(file));
      setRemovedAvatar(false);
    } catch (error) {
      setAvatarError(errorMessage(error));
    } finally {
      setPreparingAvatar(false);
    }
  }

  async function saveAvatar() {
    if (!pendingAvatar) return;
    setSavingAvatar(true);
    setAvatarError('');
    try {
      await request(token, '/admin', { body: { action: 'set_responsible_avatar', operationId: operationId(), userId: email, ...pendingAvatar } });
      setPendingAvatar(null);
      setRemovedAvatar(false);
      notify('Foto do responsável atualizada.', 'success');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['responsibles'] }), onChanged()]);
    } catch (error) {
      setAvatarError(errorMessage(error));
    } finally {
      setSavingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (pendingAvatar) {
      setPendingAvatar(null);
      setAvatarError('');
      return;
    }
    if (!avatarUrl || removedAvatar) return;
    setSavingAvatar(true);
    setAvatarError('');
    try {
      await request(token, '/admin', { body: { action: 'remove_responsible_avatar', operationId: operationId(), userId: email } });
      setRemovedAvatar(true);
      notify('Foto removida.', 'success');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['responsibles'] }), onChanged()]);
    } catch (error) {
      setAvatarError(errorMessage(error));
    } finally {
      setSavingAvatar(false);
    }
  }

  return <>
    <Dialog open={open} onOpenChange={next => { if (!revoking && !savingAvatar && !preparingAvatar) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[min(90dvh,820px)] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Responsável · administração</p>
          <DialogTitle className="mt-1 break-all">Editar responsável</DialogTitle>
          <DialogDescription className="break-all">{email} · tokens individuais e foto de perfil</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <section aria-labelledby="responsible-avatar-title" className="grid gap-3">
            <div><h3 id="responsible-avatar-title" className="text-sm font-semibold text-foreground">Foto de perfil</h3><p className="mt-1 text-xs text-muted-foreground">PNG, JPEG ou WebP. A imagem é recortada em quadrado e reduzida para até 96 KiB.</p></div>
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/20 p-3">
              <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-lg font-semibold text-muted-foreground" role="img" aria-label={previewUrl ? `Prévia da foto de ${email}` : 'Sem foto de perfil'}>
                {previewUrl ? <img src={previewUrl} alt="" className="size-full object-cover" onError={event => { event.currentTarget.hidden = true; }} /> : email.slice(0, 1).toLocaleUpperCase('pt-BR')}
              </span>
              <div className="grid min-w-0 flex-1 gap-2">
                <label className="grid gap-1.5 text-xs font-medium text-foreground" htmlFor="responsible-avatar-file">Escolher imagem
                  <input id="responsible-avatar-file" className="block w-full max-w-md cursor-pointer rounded-md border border-input bg-background text-xs text-muted-foreground file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs file:font-semibold file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="file" accept="image/png,image/jpeg,image/webp" disabled={preparingAvatar || savingAvatar} onChange={event => { void chooseAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
                </label>
                {preparingAvatar && <p className="text-xs text-muted-foreground" role="status">Preparando prévia…</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={!pendingAvatar || savingAvatar || preparingAvatar} onClick={() => void saveAvatar()}>{savingAvatar ? 'Salvando…' : 'Salvar foto'}</Button>
                  <Button type="button" variant="outline" size="sm" className={buttonSecondary} disabled={(!previewUrl && !pendingAvatar) || savingAvatar || preparingAvatar} onClick={() => void removeAvatar()}>{pendingAvatar ? 'Descartar alteração' : 'Remover foto'}</Button>
                </div>
              </div>
            </div>
            {avatarError && <p className={notice.error} role="alert">{avatarError}</p>}
          </section>

          <section aria-labelledby="responsible-credentials-title" className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 id="responsible-credentials-title" className="text-sm font-semibold text-foreground">Credenciais</h3><p className="mt-1 text-xs text-muted-foreground">Revogar um token invalida somente a credencial selecionada.</p></div><Button type="button" variant="outline" size="sm" onClick={() => void credentials.refetch()} disabled={credentials.isFetching}>{credentials.isFetching ? 'Atualizando…' : 'Atualizar lista'}</Button></div>
            {credentials.isPending ? <SkeletonRows rows={3} label="Carregando credenciais…" /> : credentials.isError ? <ErrorNotice error={credentials.error} onRetry={() => void credentials.refetch()} title="Não foi possível carregar as credenciais" /> : matchingCredentials.length ? <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2.5 font-semibold">Tipo / escopo</th><th className="px-3 py-2.5 font-semibold">Estado</th><th className="px-3 py-2.5 font-semibold">Acesso</th><th className="px-3 py-2.5 font-semibold">Criada</th><th className="px-3 py-2.5 font-semibold">ID da credencial</th><th className="px-3 py-2.5"><span className="sr-only">Ações</span></th></tr></thead>
                <tbody className="divide-y divide-border">{matchingCredentials.map(credential => <tr key={credential.credentialId}>
                  <td className="px-3 py-3"><Badge variant={credential.scope === 'agent' ? 'info' : 'success'}>{credential.scope === 'agent' ? 'Agente' : 'Pessoa'}</Badge>{credential.systemAdmin && <span className="mt-1 block text-[10px] text-muted-foreground">Admin do sistema</span>}</td>
                  <td className="px-3 py-3"><Badge variant={credential.state === 'active' ? 'success' : 'secondary'}>{credential.state === 'active' ? 'Ativa' : 'Revogada'}</Badge></td>
                  <td className="max-w-[180px] px-3 py-3 text-muted-foreground">{credential.scope === 'agent' ? 'Global · automações' : credential.projects?.length ? credential.projects.map(project => project.projectName ?? 'Projeto').join(', ') : 'Sem projeto associado'}</td>
                  <td className="px-3 py-3 text-muted-foreground"><time dateTime={credential.createdAt ?? undefined}>{formatDate(credential.createdAt ?? undefined)}</time></td>
                  <td className="max-w-[180px] break-all px-3 py-3 font-mono text-[10px] text-muted-foreground">{credential.credentialId}</td>
                  <td className="px-3 py-3 text-right">{credential.state === 'active' ? <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={revoking} onClick={() => setSelectedCredential(credential)}>Revogar</Button> : <span className="text-muted-foreground">—</span>}</td>
                </tr>)}</tbody>
              </table>
            </div> : <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center"><p className="text-sm font-medium text-foreground">Nenhuma credencial encontrada</p><p className="mt-1 text-xs text-muted-foreground">Este responsável pode não ter tokens registrados.</p></div>}
          </section>
        </div>
        <DialogFooter className="shrink-0 border-t border-border bg-muted/20 px-5 py-3 sm:px-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={revoking || savingAvatar || preparingAvatar}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={Boolean(selectedCredential)} title="Revogar esta credencial?" description={selectedCredential ? `${selectedCredential.scope === 'agent' ? 'Token de agente' : 'Token de pessoa'} · ${selectedCredential.email} · ID ${selectedCredential.credentialId}. Somente este token será invalidado.` : ''} confirmLabel="Revogar token" pendingLabel="Revogando…" pending={revoking} onOpenChange={open => { if (!open && !revoking) setSelectedCredential(null); }} onConfirm={() => void confirmRevoke()} />
  </>;
}
