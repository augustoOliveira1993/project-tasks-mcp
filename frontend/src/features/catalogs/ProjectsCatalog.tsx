import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationId, query, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { AvatarStack } from '../../components/ui/AvatarStack';
import { useProjectMembers, type ProjectMember } from '../projects/members';
import { ProjectCreateForm } from './ProjectCreateForm';

const roleLabels: Record<string, string> = { administrador: 'Administrador do projeto', admin: 'Administrador do projeto', colaborador: 'Colaborador' };

function memberPerson(member: ProjectMember) {
  return {
    email: member.email,
    title: member.systemAdmin ? 'Administrador do sistema' : undefined,
    lines: [
      member.roles.length ? 'Papel: ' + member.roles.map(role => roleLabels[role] ?? role).join(', ') : 'Acesso por token do projeto',
      member.credentials === 1 ? '1 token ativo' : member.credentials + ' tokens ativos',
      member.since ? 'Acesso desde ' + formatDate(member.since) : '',
      member.otherProjects.length ? 'Também em: ' + member.otherProjects.join(', ') : ''
    ]
  };
}

export function ProjectsCatalog({ token, nonce, projects, activeProjectId, notify, onChanged, onProjectCreated, onSelectProject }: {
  token: string; nonce: string; projects: Project[]; activeProjectId: string; notify: (message: string, kind?: string) => void;
  onChanged: () => void; onProjectCreated: (project: Project) => void; onSelectProject: (projectId: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const queryClient = useQueryClient();
  const membersByProject = useProjectMembers(token, nonce, projects.map(project => project._id));
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
    <div className="catalog-screen-heading"><div><h2>Projetos</h2><p className="muted-text">Cadastre e administre os workspaces disponíveis para esta credencial.</p></div><button className="button primary" type="button" onClick={() => setShowCreate(true)}>Novo projeto</button></div>
    <section className="panel-card catalog-table-card"><div className="section-heading"><div><h3>Projetos cadastrados</h3><p className="muted-text">{projects.length} {projects.length === 1 ? 'projeto cadastrado' : 'projetos cadastrados'}</p></div></div>
      {projects.length ? <div className="table-scroll"><table className="catalog-table project-catalog-table"><thead><tr><th>Projeto</th><th>Visibilidade</th><th>Responsáveis</th><th>Repositórios</th><th>Atualizado</th><th>Ações</th></tr></thead><tbody>
        {projects.map(project => {
          const inUse = project._id === activeProjectId;
          const repositoryCount = project.repositories?.length ?? 0;
          return <tr key={project._id} className={inUse ? 'selected-row project-in-use' : undefined}>
            <td><div className="project-catalog-title"><strong>{project.name}</strong>{inUse && <span className="badge badge-blue project-in-use-badge">Em uso</span>}</div><small className="catalog-row-id" title={project._id}>{project._id}</small></td>
            <td><span className={`badge ${project.visibility === 'private' ? 'badge-amber' : 'badge-green'}`}>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</span></td>
            <td className="project-members-cell">{(() => { const state = membersByProject.get(project._id); return state?.isPending ? <span className="muted-text">Carregando…</span> : state?.isError ? <span className="muted-text" title="Não foi possível listar as credenciais deste projeto">Indisponível</span> : <AvatarStack label={'Responsáveis de ' + project.name} people={(state?.members ?? []).map(memberPerson)} />; })()}</td>
            <td><span className="project-catalog-repository-count"><strong>{repositoryCount}</strong>{repositoryCount === 1 ? 'repositório' : 'repositórios'}</span></td>
            <td><time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time></td>
            <td><div className="catalog-row-actions project-catalog-actions" role="group" aria-label={`Ações do projeto ${project.name}`}><button className="button primary small-button" type="button" onClick={() => onSelectProject(project._id)}>Usar</button><button className="button secondary small-button" type="button" onClick={() => setSelected(project)}>Ver</button><button className="button secondary small-button" type="button" onClick={() => setEditing(project)}>Editar</button><button className="text-button danger-text" type="button" disabled={archive.isPending} onClick={() => { if (window.confirm(`Arquivar o projeto “${project.name}”?`)) archive.mutate(project); }}>Arquivar</button></div></td>
        </tr>;
        })}
      </tbody></table></div> : <div className="empty-state compact"><h3>Nenhum projeto</h3><p>Use “Novo projeto” para cadastrar o primeiro.</p></div>}
      {archive.isError && <p className="notice error" role="alert">{errorMessage(archive.error)}</p>}
    </section>
    {selected && <ProjectRecordDialog token={token} nonce={nonce} project={selected} mode="view" close={() => setSelected(null)} />}
    {editing && <ProjectRecordDialog token={token} nonce={nonce} project={editing} mode="edit" close={() => setEditing(null)} notify={notify} onSaved={() => { setEditing(null); onChanged(); }} />}
    {showCreate && <ProjectCreateDialog token={token} nonce={nonce} notify={notify} close={() => setShowCreate(false)} onCreated={project => { setShowCreate(false); onProjectCreated(project); }} />}
  </section>;
}

function ProjectCreateDialog({ token, nonce, notify, close, onCreated }: {
  token: string; nonce: string; notify: (message: string, kind?: string) => void;
  close: () => void; onCreated: (project: Project) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="dialog create-task-dialog catalog-project-dialog" aria-labelledby="create-project-dialog-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }} onClick={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">PROJETO</p><h2 id="create-project-dialog-title">Cadastrar projeto</h2><p className="muted-text">Reúna as informações, os repositórios e as regras de trabalho do seu projeto.</p></div><button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="Fechar">×</button></header>
    <ProjectCreateForm token={token} nonce={nonce} notify={notify} inDialog onCancel={close} onSavingChange={setSaving} onSaved={onCreated} />
  </dialog>;
}

function ProjectRecordDialog({ token, nonce, project, mode, close, notify, onSaved }: {
  token: string; nonce: string; project: Project; mode: 'view' | 'edit'; close: () => void;
  notify?: (message: string, kind?: string) => void; onSaved?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const fullProject = useQuery({
    queryKey: ['catalog-project-record', nonce, project._id],
    queryFn: () => query<Project>(token, 'get_record', { projectId: project._id, kind: 'project', id: project._id })
  });
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  const record = fullProject.data ?? project;
  return <dialog ref={dialogRef} className={`dialog create-task-dialog ${mode === 'edit' ? 'catalog-project-dialog' : 'catalog-record-dialog'}`} aria-labelledby="project-record-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }} onClick={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">PROJETO · {mode === 'view' ? 'DETALHE' : 'EDIÇÃO'}</p><h2 id="project-record-title">{mode === 'view' ? record.name : 'Editar projeto'}</h2><p className="muted-text">{mode === 'view' ? project._id : 'Atualize as informações, os repositórios e as regras de trabalho do seu projeto.'}</p></div><button className="icon-button" type="button" onClick={close} disabled={saving} aria-label="Fechar">×</button></header>
    {fullProject.isPending ? <div className="loading">Carregando projeto…</div> : fullProject.isError ? <p className="notice error" role="alert">{errorMessage(fullProject.error)}</p> : mode === 'view' ? <div className="catalog-record-body">
      <dl className="catalog-detail-grid"><div><dt>Visibilidade</dt><dd>{record.visibility === 'private' ? 'Privado' : 'Compartilhado'}</dd></div><div><dt>Áreas</dt><dd>{record.areas?.join(', ') || '—'}</dd></div></dl>
      <section className="catalog-detail-section"><h3>Descrição</h3><MarkdownView content={record.description ?? ''} /></section>
      <section className="catalog-detail-section"><h3>Instruções</h3><MarkdownView content={record.instructions ?? ''} /></section>
      <section className="catalog-detail-section"><h3>Repositórios</h3>{(record.repositories ?? []).map(repository => <article className="catalog-repository-detail" key={repository.id}><strong>{repository.name}</strong><span>{repository.url}</span><MarkdownView content={repository.instructions ?? ''} /></article>)}</section>
    </div> : <ProjectCreateForm token={token} nonce={nonce} project={record} notify={notify ?? (() => undefined)} inDialog dialogTitleId="project-record-title" onCancel={close} onSavingChange={setSaving} onSaved={() => onSaved?.()} />}
    {mode === 'view' && <footer className="dialog-footer"><button className="button secondary" onClick={close}>Fechar</button></footer>}
  </dialog>;
}
