import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, query, request } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { CreateFeatureDialog } from '../tasks/CreateFeatureDialog';
import { CatalogRecordDialog } from './components/CatalogRecordDialog';
import { buttonPrimary, buttonSecondary, eyebrow, notice } from '../../components/ui/classes';
import {
  acceptanceItem, acceptanceList, cellStrong, dangerTextButton, detailSection, detailSectionTitle, dialogHeader, dialogNotice, dialogSubtitle, dialogTitle,
  editField, editForm, editHint, editLabel, emptyState, emptyText, emptyTitle, iconButton, loading, recordDialog, rowActions, rowHover, rowId, screen,
  screenAction, screenDescription, screenHeading, screenTitle, sectionDescription, sectionHeading, sectionTitle, table, tableCard, tableScroll, tdCell, textButtonNowrap, thCell
} from './catalogClasses';

type FeatureRecord = { _id: string; version: number; name: string; objective: string; context: string; acceptance: string[]; archived?: boolean; updatedAt?: string; markdownCount?: number };
type FeatureMarkdown = { _id: string; name: string; summary: string; revision: number };

export function FeaturesCatalog({ token, nonce, projectId, notify, onChanged }: {
  token: string; nonce: string; projectId: string; notify: (message: string, kind?: string) => void; onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FeatureRecord | null>(null);
  const [editing, setEditing] = useState<FeatureRecord | null>(null);
  const [archiving, setArchiving] = useState<FeatureRecord | null>(null);
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
      setArchiving(null);
      onChanged();
    },
    onError: error => notify(errorMessage(error), 'error')
  });

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Features</h2><p className={screenDescription}>Organize tarefas por objetivo dentro do projeto selecionado.</p></div><Button className={`${buttonPrimary} ${screenAction}`} disabled={!projectId} onClick={() => setCreating(true)}>Nova feature</Button></div>
    {!projectId ? <p className={notice.info}>Selecione um projeto para consultar as features.</p> : features.isPending ? <div className={loading} role="status" aria-live="polite">Carregando features…</div> : features.isError ? <p className={notice.error} role="alert">{errorMessage(features.error)}</p> : <section className={tableCard}><div className={sectionHeading}><div><h3 className={sectionTitle}>Features cadastradas</h3><p className={sectionDescription}>{features.data?.length ?? 0} feature(s)</p></div></div>
      {features.data?.length ? <div className={tableScroll}><Table className={table}><TableHeader><TableRow><TableHead className={thCell}>Feature</TableHead><TableHead className={thCell}>Critérios</TableHead><TableHead className={thCell}>Docs SDD</TableHead><TableHead className={thCell}>Atualizada</TableHead><TableHead className={thCell}>Ações</TableHead></TableRow></TableHeader><TableBody>
        {features.data.map(feature => <TableRow key={feature._id} className={rowHover}><TableCell className={tdCell}><strong className={cellStrong}>{feature.name}</strong><small className={rowId}>{feature._id}</small></TableCell><TableCell className={tdCell}>{feature.acceptance?.length ?? 0}</TableCell><TableCell className={tdCell}>{feature.markdownCount ?? 0}</TableCell><TableCell className={tdCell}>{formatDate(feature.updatedAt)}</TableCell><TableCell className={tdCell}><div className={rowActions}><Button variant="link" className={textButtonNowrap} onClick={() => setSelected(feature)}>Ver</Button><Button variant="link" className={textButtonNowrap} onClick={() => setEditing(feature)}>Editar</Button><Button variant="link" className={dangerTextButton} disabled={archive.isPending} onClick={() => setArchiving(feature)}>Arquivar</Button></div></TableCell></TableRow>)}
      </TableBody></Table></div> : <div className={emptyState}><h3 className={emptyTitle}>Nenhuma feature</h3><p className={emptyText}>Cadastre a primeira feature deste projeto.</p></div>}
      {archive.isError && <p className={notice.error} role="alert">{errorMessage(archive.error)}</p>}
    </section>}
    {creating && <CreateFeatureDialog key={projectId} token={token} nonce={nonce} projectId={projectId} close={() => setCreating(false)} onCreated={feature => { setCreating(false); notify(`Feature “${feature.name}” criada.`, 'success'); void features.refetch(); }} />}
    {selected && <CatalogRecordDialog title={selected.name} subtitle="Detalhes da feature" close={() => setSelected(null)}><div className={detailSection}><h3 className={detailSectionTitle}>Objetivo</h3><MarkdownView content={selected.objective} /></div><div className={detailSection}><h3 className={detailSectionTitle}>Contexto</h3><MarkdownView content={selected.context} /></div><div className={detailSection}><h3 className={detailSectionTitle}>Critérios de aceite</h3><ul className={acceptanceList}>{selected.acceptance.map((criterion, index) => <li key={index} className={acceptanceItem}><MarkdownView content={criterion} /></li>)}</ul></div><FeatureDocuments token={token} nonce={nonce} projectId={projectId} featureId={selected._id} /></CatalogRecordDialog>}
    {editing && <FeatureEditor token={token} nonce={nonce} projectId={projectId} feature={editing} close={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} notify={notify} />}
    <ConfirmDialog open={Boolean(archiving)} title="Arquivar feature" description={archiving ? `Arquivar a feature “${archiving.name}”?` : ''} confirmLabel="Arquivar feature" pendingLabel="Arquivando…" pending={archive.isPending} onOpenChange={open => { if (!open) setArchiving(null); }} onConfirm={() => { if (archiving) archive.mutate(archiving); }} />
  </section>;
}
function FeatureDocuments({ token, nonce, projectId, featureId }: { token: string; nonce: string; projectId: string; featureId: string }) {
  const [selectedDocument, setSelectedDocument] = useState<FeatureMarkdown | null>(null);
  const documents = useQuery({
    queryKey: ['feature-markdowns', nonce, projectId, featureId],
    queryFn: async () => {
      const items: FeatureMarkdown[] = [];
      let after: string | undefined;
      do {
        const page = await query<{ items: FeatureMarkdown[]; next?: string | null }>(token, 'list_markdowns', {
          projectId, targetKind: 'feature', targetId: featureId, limit: 100, ...(after ? { after } : {})
        });
        items.push(...page.items);
        after = page.next ?? undefined;
      } while (after);
      return items;
    }
  });
  const markdown = useQuery({
    queryKey: ['feature-markdown-content', nonce, projectId, featureId, selectedDocument?._id, selectedDocument?.revision],
    enabled: Boolean(selectedDocument),
    queryFn: async () => {
      const document = selectedDocument;
      if (!document) return '';
      const pages: string[] = [];
      let line: number | undefined = 1;
      while (line) {
        const page: { content: string; nextLine: number | null } = await query<{ content: string; nextLine: number | null }>(token, 'get_markdown', {
          projectId, id: document._id, revision: document.revision, line, limit: 200
        });
        pages.push(page.content);
        line = page.nextLine ?? undefined;
      }
      return pages.join('\n');
    }
  });

  return <section className={detailSection}>
    <h3 className={detailSectionTitle}>Documentos e especificações</h3>
    {documents.isPending ? <p className="text-sm text-slate-500">Carregando documentos…</p>
      : documents.isError ? <p className="text-sm text-rose-700" role="alert">{errorMessage(documents.error)}</p>
        : !documents.data.length ? <p className="text-sm text-slate-500">Nenhum documento vinculado a esta feature.</p>
          : <ul className="grid gap-2">{documents.data.map(document => <li key={document._id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div className="min-w-0"><p className="break-all text-sm font-semibold text-slate-800">{document.name}<span className="ml-2 text-xs font-normal text-slate-500">rev. {document.revision}</span></p><p className="mt-1 text-sm text-slate-600">{document.summary}</p></div>
            <Button type="button" variant="link" className={textButtonNowrap} onClick={() => setSelectedDocument(document)} aria-pressed={selectedDocument?._id === document._id}>Abrir</Button>
          </li>)}</ul>}
    {selectedDocument && <div className="mt-4 rounded-lg border border-slate-200 p-4" aria-live="polite">
      <div className="mb-3 flex items-start justify-between gap-3"><h4 className="break-all text-sm font-semibold text-slate-900">{selectedDocument.name} · rev. {selectedDocument.revision}</h4><Button type="button" variant="link" className={textButtonNowrap} onClick={() => setSelectedDocument(null)}>Fechar documento</Button></div>
      {markdown.isPending ? <p className="text-sm text-slate-500">Carregando conteúdo…</p>
        : markdown.isError ? <p className="text-sm text-rose-700" role="alert">{errorMessage(markdown.error)}</p>
          : <MarkdownView content={markdown.data ?? ''} />}
    </div>}
  </section>;
}

function FeatureEditor({ token, nonce, projectId, feature, close, onSaved, notify }: {
  token: string; nonce: string; projectId: string; feature: FeatureRecord; close: () => void; onSaved: () => void; notify: (message: string, kind?: string) => void;
}) {
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const acceptance = String(form.get('acceptance') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
    if (!acceptance.length) return notify('Informe pelo menos um critério de aceite.', 'error');
    mutation.mutate({ name: String(form.get('name') ?? '').trim(), objective: String(form.get('objective') ?? '').trim(), context: String(form.get('context') ?? '').trim(), acceptance });
  }
  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) close(); }}>
    <DialogContent className={`${recordDialog} gap-0`} showCloseButton={false}>
    <DialogHeader className={dialogHeader}><div><p className={eyebrow}>FEATURE · EDIÇÃO</p><DialogTitle id="edit-feature-title" className={dialogTitle}>Editar feature</DialogTitle><DialogDescription className={dialogSubtitle}>{feature._id} · versão {feature.version}</DialogDescription></div><Button variant="ghost" className={iconButton} type="button" onClick={close} disabled={mutation.isPending} aria-label="Fechar">×</Button></DialogHeader>
    {mutation.isError && <p className={dialogNotice} role="alert">{errorMessage(mutation.error)}</p>}
    <form className={editForm} onSubmit={submit}>
      <label className={editLabel}>Nome<Input className={editField} name="name" required maxLength={20000} defaultValue={feature.name} /></label>
      <label className={editLabel}>Objetivo<Textarea className={editField} name="objective" required maxLength={20000} rows={3} defaultValue={feature.objective} /></label>
      <label className={editLabel}>Contexto<Textarea className={editField} name="context" required maxLength={20000} rows={4} defaultValue={feature.context} /></label>
      <label className={editLabel}>Critérios de aceite<Textarea className={editField} name="acceptance" required rows={6} defaultValue={feature.acceptance.join('\n')} /><small className={editHint}>Um critério por linha.</small></label>
      <DialogFooter className="mt-1"><Button type="button" variant="outline" className={buttonSecondary} onClick={close} disabled={mutation.isPending}>Cancelar</Button><Button type="submit" className={buttonPrimary} disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar feature'}</Button></DialogFooter>
    </form>
    </DialogContent>
  </Dialog>;
}
