import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { CreateFeatureDialog } from '../tasks/CreateFeatureDialog';
import { buttonPrimary, buttonSecondary, eyebrow, notice } from '../../components/ui/classes';
import {
  acceptanceItem, acceptanceList, cellStrong, dangerTextButton, detailSection, detailSectionTitle, dialogFooter, dialogHeader, dialogNotice, dialogSubtitle, dialogTitle,
  editField, editForm, editHint, editLabel, emptyState, emptyText, emptyTitle, iconButton, loading, recordBody, recordDialog, rowActions, rowHover, rowId, screen,
  screenAction, screenDescription, screenHeading, screenTitle, sectionDescription, sectionHeading, sectionTitle, table, tableCard, tableScroll, tdCell, textButtonNowrap, thCell
} from './catalogClasses';

type FeatureRecord = { _id: string; version: number; name: string; objective: string; context: string; acceptance: string[]; archived?: boolean; updatedAt?: string };

export function FeaturesCatalog({ token, nonce, projectId, notify, onChanged }: {
  token: string; nonce: string; projectId: string; notify: (message: string, kind?: string) => void; onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FeatureRecord | null>(null);
  const [editing, setEditing] = useState<FeatureRecord | null>(null);
  const client = useQueryClient();
  const features = useQuery({
    queryKey: ['project-features', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => allRecords<FeatureRecord>(token, { kind: 'feature', projectId, archived: false })
  });
  const archive = useMutation({
    mutationFn: (feature: FeatureRecord) => request(token, '/admin/archive', { body: { operationId: operationId(), projectId, kind: 'feature', id: feature._id, version: feature.version } }),
    onSuccess: async (_result, feature) => {
      await client.invalidateQueries({ queryKey: ['project-features', nonce, projectId] });
      await client.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      notify(`Feature “${feature.name}” arquivada.`, 'success');
      onChanged();
    },
    onError: error => notify(errorMessage(error), 'error')
  });

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Features</h2><p className={screenDescription}>Organize tarefas por objetivo dentro do projeto selecionado.</p></div><button className={`${buttonPrimary} ${screenAction}`} type="button" disabled={!projectId} onClick={() => setCreating(true)}>Nova feature</button></div>
    {!projectId ? <p className={notice.info}>Selecione um projeto para consultar as features.</p> : features.isPending ? <div className={loading}>Carregando features…</div> : features.isError ? <p className={notice.error} role="alert">{errorMessage(features.error)}</p> : <section className={tableCard}><div className={sectionHeading}><div><h3 className={sectionTitle}>Features cadastradas</h3><p className={sectionDescription}>{features.data?.length ?? 0} feature(s)</p></div></div>
      {features.data?.length ? <div className={tableScroll}><table className={table}><thead><tr><th className={thCell}>Feature</th><th className={thCell}>Critérios</th><th className={thCell}>Atualizada</th><th className={thCell}>Ações</th></tr></thead><tbody>
        {features.data.map(feature => <tr key={feature._id} className={rowHover}><td className={tdCell}><strong className={cellStrong}>{feature.name}</strong><small className={rowId}>{feature._id}</small></td><td className={tdCell}>{feature.acceptance?.length ?? 0}</td><td className={tdCell}>{formatDate(feature.updatedAt)}</td><td className={tdCell}><div className={rowActions}><button className={textButtonNowrap} type="button" onClick={() => setSelected(feature)}>Ver</button><button className={textButtonNowrap} type="button" onClick={() => setEditing(feature)}>Editar</button><button className={dangerTextButton} type="button" disabled={archive.isPending} onClick={() => { if (window.confirm(`Arquivar a feature “${feature.name}”?`)) archive.mutate(feature); }}>Arquivar</button></div></td></tr>)}
      </tbody></table></div> : <div className={emptyState}><h3 className={emptyTitle}>Nenhuma feature</h3><p className={emptyText}>Cadastre a primeira feature deste projeto.</p></div>}
      {archive.isError && <p className={notice.error} role="alert">{errorMessage(archive.error)}</p>}
    </section>}
    {creating && <CreateFeatureDialog key={projectId} token={token} nonce={nonce} projectId={projectId} close={() => setCreating(false)} onCreated={feature => { setCreating(false); notify(`Feature “${feature.name}” criada.`, 'success'); void features.refetch(); }} />}
    {selected && <CatalogRecordDialog title={selected.name} subtitle="Detalhes da feature" close={() => setSelected(null)}><div className={detailSection}><h3 className={detailSectionTitle}>Objetivo</h3><MarkdownView content={selected.objective} /></div><div className={detailSection}><h3 className={detailSectionTitle}>Contexto</h3><MarkdownView content={selected.context} /></div><div className={detailSection}><h3 className={detailSectionTitle}>Critérios de aceite</h3><ul className={acceptanceList}>{selected.acceptance.map((criterion, index) => <li key={index} className={acceptanceItem}><MarkdownView content={criterion} /></li>)}</ul></div></CatalogRecordDialog>}
    {editing && <FeatureEditor token={token} nonce={nonce} projectId={projectId} feature={editing} close={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} notify={notify} />}
  </section>;
}

function FeatureEditor({ token, nonce, projectId, feature, close, onSaved, notify }: {
  token: string; nonce: string; projectId: string; feature: FeatureRecord; close: () => void; onSaved: () => void; notify: (message: string, kind?: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => request<FeatureRecord>(token, '/admin/records/edit', { body: { operationId: operationId(), projectId, kind: 'feature', id: feature._id, version: feature.version, data } }),
    onSuccess: async result => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project-features', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['admin-projects', nonce] })
      ]);
      notify(`Feature “${result.name}” atualizada.`, 'success');
      onSaved();
    }
  });
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const acceptance = String(form.get('acceptance') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
    if (!acceptance.length) return notify('Informe pelo menos um critério de aceite.', 'error');
    mutation.mutate({ name: String(form.get('name') ?? '').trim(), objective: String(form.get('objective') ?? '').trim(), context: String(form.get('context') ?? '').trim(), acceptance });
  }
  return <dialog ref={ref} className={recordDialog} aria-labelledby="edit-feature-title" onCancel={event => { event.preventDefault(); if (!mutation.isPending) close(); }}>
    <header className={dialogHeader}><div><p className={eyebrow}>FEATURE · EDIÇÃO</p><h2 id="edit-feature-title" className={dialogTitle}>Editar feature</h2><p className={dialogSubtitle}>{feature._id} · versão {feature.version}</p></div><button className={iconButton} type="button" onClick={close} disabled={mutation.isPending} aria-label="Fechar">×</button></header>
    {mutation.isError && <p className={dialogNotice} role="alert">{errorMessage(mutation.error)}</p>}
    <form className={editForm} onSubmit={submit}>
      <label className={editLabel}>Nome<input className={editField} name="name" required maxLength={20000} defaultValue={feature.name} /></label>
      <label className={editLabel}>Objetivo<textarea className={editField} name="objective" required maxLength={20000} rows={3} defaultValue={feature.objective} /></label>
      <label className={editLabel}>Contexto<textarea className={editField} name="context" required maxLength={20000} rows={4} defaultValue={feature.context} /></label>
      <label className={editLabel}>Critérios de aceite<textarea className={editField} name="acceptance" required rows={6} defaultValue={feature.acceptance.join('\n')} /><small className={editHint}>Um critério por linha.</small></label>
      <div className="mt-1 flex items-center justify-end gap-2"><button type="button" className={buttonSecondary} onClick={close} disabled={mutation.isPending}>Cancelar</button><button className={buttonPrimary} disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar feature'}</button></div>
    </form>
  </dialog>;
}

export function CatalogRecordDialog({ title, subtitle, children, close }: { title: string; subtitle: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={ref} className={recordDialog} aria-labelledby="catalog-record-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className={dialogHeader}><div><p className={eyebrow}>CADASTRO · DETALHE</p><h2 id="catalog-record-title" className={dialogTitle}>{title}</h2><p className={dialogSubtitle}>{subtitle}</p></div><button className={iconButton} type="button" onClick={close} aria-label="Fechar">×</button></header>
    <div className={recordBody}>{children}</div><footer className={dialogFooter}><button className={buttonSecondary} type="button" onClick={close}>Fechar</button></footer>
  </dialog>;
}
