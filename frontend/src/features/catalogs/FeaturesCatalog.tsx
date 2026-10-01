import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { CreateFeatureDialog } from '../tasks/CreateFeatureDialog';

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

  return <section className="catalog-record-screen">
    <div className="catalog-screen-heading"><div><h2>Features</h2><p className="muted-text">Organize tarefas por objetivo dentro do projeto selecionado.</p></div><button className="button primary" type="button" disabled={!projectId} onClick={() => setCreating(true)}>Nova feature</button></div>
    {!projectId ? <p className="notice">Selecione um projeto para consultar as features.</p> : features.isPending ? <div className="loading">Carregando features…</div> : features.isError ? <p className="notice error" role="alert">{errorMessage(features.error)}</p> : <section className="panel-card catalog-table-card"><div className="section-heading"><div><h3>Features cadastradas</h3><p className="muted-text">{features.data?.length ?? 0} feature(s)</p></div></div>
      {features.data?.length ? <div className="table-scroll"><table className="catalog-table"><thead><tr><th>Feature</th><th>Critérios</th><th>Atualizada</th><th>Ações</th></tr></thead><tbody>
        {features.data.map(feature => <tr key={feature._id}><td><strong>{feature.name}</strong><small className="catalog-row-id">{feature._id}</small></td><td>{feature.acceptance?.length ?? 0}</td><td>{formatDate(feature.updatedAt)}</td><td><div className="catalog-row-actions"><button className="text-button" type="button" onClick={() => setSelected(feature)}>Ver</button><button className="text-button" type="button" onClick={() => setEditing(feature)}>Editar</button><button className="text-button danger-text" type="button" disabled={archive.isPending} onClick={() => { if (window.confirm(`Arquivar a feature “${feature.name}”?`)) archive.mutate(feature); }}>Arquivar</button></div></td></tr>)}
      </tbody></table></div> : <div className="empty-state compact"><h3>Nenhuma feature</h3><p>Cadastre a primeira feature deste projeto.</p></div>}
      {archive.isError && <p className="notice error" role="alert">{errorMessage(archive.error)}</p>}
    </section>}
    {creating && <CreateFeatureDialog key={projectId} token={token} nonce={nonce} projectId={projectId} close={() => setCreating(false)} onCreated={feature => { setCreating(false); notify(`Feature “${feature.name}” criada.`, 'success'); void features.refetch(); }} />}
    {selected && <CatalogRecordDialog title={selected.name} subtitle="Detalhes da feature" close={() => setSelected(null)}><div className="catalog-detail-section"><h3>Objetivo</h3><MarkdownView content={selected.objective} /></div><div className="catalog-detail-section"><h3>Contexto</h3><MarkdownView content={selected.context} /></div><div className="catalog-detail-section"><h3>Critérios de aceite</h3><ul className="catalog-acceptance-list">{selected.acceptance.map((criterion, index) => <li key={index}><MarkdownView content={criterion} /></li>)}</ul></div></CatalogRecordDialog>}
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
  return <dialog ref={ref} className="dialog create-task-dialog catalog-record-dialog" aria-labelledby="edit-feature-title" onCancel={event => { event.preventDefault(); if (!mutation.isPending) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">FEATURE · EDIÇÃO</p><h2 id="edit-feature-title">Editar feature</h2><p className="muted-text">{feature._id} · versão {feature.version}</p></div><button className="icon-button" type="button" onClick={close} disabled={mutation.isPending} aria-label="Fechar">×</button></header>
    {mutation.isError && <p className="notice error" role="alert">{errorMessage(mutation.error)}</p>}
    <form className="stack-form create-task-form catalog-edit-form" onSubmit={submit}>
      <label>Nome<input name="name" required maxLength={20000} defaultValue={feature.name} /></label>
      <label>Objetivo<textarea name="objective" required maxLength={20000} rows={3} defaultValue={feature.objective} /></label>
      <label>Contexto<textarea name="context" required maxLength={20000} rows={4} defaultValue={feature.context} /></label>
      <label>Critérios de aceite<textarea name="acceptance" required rows={6} defaultValue={feature.acceptance.join('\n')} /><small>Um critério por linha.</small></label>
      <div className="button-row end-row"><button type="button" className="button secondary" onClick={close} disabled={mutation.isPending}>Cancelar</button><button className="button primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar feature'}</button></div>
    </form>
  </dialog>;
}

export function CatalogRecordDialog({ title, subtitle, children, close }: { title: string; subtitle: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={ref} className="dialog create-task-dialog catalog-record-dialog" aria-labelledby="catalog-record-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">CADASTRO · DETALHE</p><h2 id="catalog-record-title">{title}</h2><p className="muted-text">{subtitle}</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fechar">×</button></header>
    <div className="catalog-record-body">{children}</div><footer className="dialog-footer"><button className="button secondary" type="button" onClick={close}>Fechar</button></footer>
  </dialog>;
}
