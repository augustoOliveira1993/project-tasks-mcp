import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationId, query, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { ProjectCreateForm } from './ProjectCreateForm';

export function ProjectsCatalog({ token, nonce, projects, activeProjectId, notify, onChanged, onProjectCreated, onSelectProject }: {
  token: string; nonce: string; projects: Project[]; activeProjectId: string; notify: (message: string, kind?: string) => void;
  onChanged: () => void; onProjectCreated: (project: Project) => void; onSelectProject: (projectId: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const queryClient = useQueryClient();
  const archive = useMutation({
    mutationFn: (project: Project) => request(token, '/admin/archive', { body: { operationId: operationId(), projectId: project._id, kind: 'project', id: project._id, version: project.version } }),
    onSuccess: async (_result, project) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      if (project._id === activeProjectId) onSelectProject('');
      notify(`Projeto “${project.name}” arquivado.`, 'success');
      onChanged();
    },
    onError: error => notify(errorMessage(error), 'error')
  });

  return <section className="catalog-record-screen">
    <div className="catalog-screen-heading"><div><h2>Projetos</h2><p className="muted-text">Cadastre e administre os workspaces disponíveis para esta credencial.</p></div><button className="button primary" type="button" onClick={() => setShowCreate(value => !value)}>{showCreate ? 'Fechar cadastro' : 'Novo projeto'}</button></div>
    {showCreate && <ProjectCreateForm token={token} nonce={nonce} notify={notify} onCreated={project => { setShowCreate(false); onProjectCreated(project); }} />}
    <section className="panel-card catalog-table-card"><div className="section-heading"><div><h3>Projetos cadastrados</h3><p className="muted-text">{projects.length} projeto(s)</p></div></div>
      {projects.length ? <div className="table-scroll"><table className="catalog-table"><thead><tr><th>Projeto</th><th>Visibilidade</th><th>Repositórios</th><th>Atualizado</th><th>Ações</th></tr></thead><tbody>
        {projects.map(project => <tr key={project._id} className={project._id === activeProjectId ? 'selected-row' : undefined}>
          <td><strong>{project.name}</strong><small className="catalog-row-id">{project._id}</small></td><td>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</td><td>{project.repositories?.length ?? 0}</td><td>{formatDate(project.updatedAt)}</td>
          <td><div className="catalog-row-actions"><button className="text-button" type="button" onClick={() => onSelectProject(project._id)}>Usar</button><button className="text-button" type="button" onClick={() => setSelected(project)}>Ver</button><button className="text-button" type="button" onClick={() => setEditing(project)}>Editar</button><button className="text-button danger-text" type="button" disabled={archive.isPending} onClick={() => { if (window.confirm(`Arquivar o projeto “${project.name}”?`)) archive.mutate(project); }}>Arquivar</button></div></td>
        </tr>)}
      </tbody></table></div> : <div className="empty-state compact"><h3>Nenhum projeto</h3><p>Use “Novo projeto” para cadastrar o primeiro.</p></div>}
      {archive.isError && <p className="notice error" role="alert">{errorMessage(archive.error)}</p>}
    </section>
    {selected && <ProjectRecordDialog token={token} nonce={nonce} project={selected} mode="view" close={() => setSelected(null)} />}
    {editing && <ProjectRecordDialog token={token} nonce={nonce} project={editing} mode="edit" close={() => setEditing(null)} notify={notify} onSaved={() => { setEditing(null); onChanged(); }} />}
  </section>;
}

function ProjectRecordDialog({ token, nonce, project, mode, close, notify, onSaved }: {
  token: string; nonce: string; project: Project; mode: 'view' | 'edit'; close: () => void;
  notify?: (message: string, kind?: string) => void; onSaved?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fullProject = useQuery({
    queryKey: ['catalog-project-record', nonce, project._id],
    queryFn: () => query<Project>(token, 'get_record', { projectId: project._id, kind: 'project', id: project._id })
  });
  const queryClient = useQueryClient();
  const [repositories, setRepositories] = useState<NonNullable<Project['repositories']>>([]);
  const [visibility, setVisibility] = useState('public');
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  useEffect(() => {
    if (fullProject.data) { setRepositories(fullProject.data.repositories ?? []); setVisibility(fullProject.data.visibility ?? 'public'); }
  }, [fullProject.data]);
  const edit = useMutation({
    mutationFn: (data: Record<string, unknown>) => request<Project>(token, '/admin/records/edit', { body: { operationId: operationId(), projectId: project._id, kind: 'project', id: project._id, version: fullProject.data?.version ?? project.version, data } }),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      await queryClient.invalidateQueries({ queryKey: ['catalog-project-record', nonce, project._id] });
      notify?.(`Projeto “${result.name}” atualizado.`, 'success');
      onSaved?.();
    }
  });

  function updateRepository(index: number, key: 'name' | 'url' | 'instructions', value: string) {
    setRepositories(current => current.map((repository, position) => position !== index ? repository : {
      ...repository, [key]: value, ...(key === 'url' && repository.url !== value ? { git: undefined } : {})
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data: Record<string, unknown> = {
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(),
      instructions: String(form.get('instructions') ?? '').trim(),
      repositories
    };
    const initialVisibility = fullProject.data?.visibility ?? 'public';
    if (visibility !== initialVisibility) {
      data.visibility = visibility;
      if (visibility === 'private') data.accessToken = String(form.get('accessToken') ?? '');
    }
    edit.mutate(data);
  }

  const record = fullProject.data ?? project;
  const saving = edit.isPending;
  return <dialog ref={dialogRef} className="dialog create-task-dialog catalog-record-dialog" aria-labelledby="project-record-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">PROJETO · {mode === 'view' ? 'DETALHE' : 'EDIÇÃO'}</p><h2 id="project-record-title">{mode === 'view' ? record.name : 'Editar projeto'}</h2><p className="muted-text">{project._id}</p></div><button className="icon-button" type="button" onClick={close} disabled={saving} aria-label="Fechar">×</button></header>
    {fullProject.isPending ? <div className="loading">Carregando projeto…</div> : fullProject.isError ? <p className="notice error" role="alert">{errorMessage(fullProject.error)}</p> : mode === 'view' ? <div className="catalog-record-body">
      <dl className="catalog-detail-grid"><div><dt>Visibilidade</dt><dd>{record.visibility === 'private' ? 'Privado' : 'Compartilhado'}</dd></div><div><dt>Áreas</dt><dd>{record.areas?.join(', ') || '—'}</dd></div></dl>
      <section className="catalog-detail-section"><h3>Descrição</h3><MarkdownView content={record.description ?? ''} /></section>
      <section className="catalog-detail-section"><h3>Instruções</h3><MarkdownView content={record.instructions ?? ''} /></section>
      <section className="catalog-detail-section"><h3>Repositórios</h3>{(record.repositories ?? []).map(repository => <article className="catalog-repository-detail" key={repository.id}><strong>{repository.name}</strong><span>{repository.url}</span><MarkdownView content={repository.instructions ?? ''} /></article>)}</section>
    </div> : <>
      {edit.isError && <p className="notice error" role="alert">{errorMessage(edit.error)}</p>}
      <form className="stack-form create-task-form catalog-edit-form" onSubmit={submit}>
        <label>Nome<input name="name" required maxLength={20000} defaultValue={record.name} /></label>
        <label>Descrição<textarea name="description" required maxLength={20000} rows={3} defaultValue={record.description ?? ''} /></label>
        <label>Instruções<textarea name="instructions" required maxLength={20000} rows={4} defaultValue={record.instructions ?? ''} /></label>
        <label>Visibilidade<select value={visibility} onChange={event => setVisibility(event.target.value)}><option value="public">Compartilhado</option><option value="private">Privado</option></select></label>
        {visibility === 'private' && record.visibility !== 'private' && <label>Novo token privado<input name="accessToken" type="password" minLength={16} maxLength={512} required autoComplete="new-password" /><small>O servidor armazena somente o hash do token.</small></label>}
        <fieldset className="catalog-repository-editor"><legend>Repositórios</legend>
          {repositories.map((repository, index) => <div className="catalog-repository-edit-row" key={repository.id}><label>Nome<input required maxLength={20000} value={repository.name} onChange={event => updateRepository(index, 'name', event.target.value)} /></label><label>URL<input type="url" required maxLength={2048} value={repository.url} onChange={event => updateRepository(index, 'url', event.target.value)} /></label><label>Instruções<textarea required maxLength={20000} rows={2} value={repository.instructions ?? ''} onChange={event => updateRepository(index, 'instructions', event.target.value)} /></label><button type="button" className="text-button danger-text" disabled={saving || repositories.length <= 1} onClick={() => setRepositories(current => current.filter((_item, position) => position !== index))}>Remover repositório</button></div>)}
          <button type="button" className="button secondary small-button" disabled={saving || repositories.length >= 100} onClick={() => setRepositories(current => [...current, { id: operationId(), name: '', url: '', instructions: '' }])}>Adicionar repositório</button>
        </fieldset>
        <div className="button-row end-row"><button type="button" className="button secondary" onClick={close} disabled={saving}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar projeto'}</button></div>
      </form>
    </>}
    {mode === 'view' && <footer className="dialog-footer"><button className="button secondary" onClick={close}>Fechar</button></footer>}
  </dialog>;
}
