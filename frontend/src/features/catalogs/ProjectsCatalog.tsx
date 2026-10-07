import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationId, query, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { AvatarStack } from '../../components/ui/AvatarStack';
import { useProjectMembers, type ProjectMember } from '../projects/members';
import { ProjectCreateForm } from './ProjectCreateForm';
import { buttonPrimary, buttonSecondary, eyebrow, notice } from '../../components/ui/classes';
import {
  badgeInUse, badgePrivate, badgeShared, buttonPrimaryCompact, buttonSecondaryCompact, dangerTextCompact, detailGrid, detailItem, detailSection, detailSectionTitle, detailTerm,
  detailValue, dialogFooter, dialogHeader, dialogHeaderFixed, dialogNotice, dialogSubtitle, dialogTitle, emptyState, emptyText, emptyTitle, iconButton, loading, projectDialog,
  projectName, projectTitle, recordBody, recordDialog, repositoryCount, repositoryCountValue, repositoryDetail, repositoryDetailName, repositoryDetailUrl, rowActionsProjects,
  rowHover, rowIdProjects, rowSelected, screen, screenAction, screenDescription, screenHeading, screenTitle, sectionDescription, sectionHeading, sectionTitle,
  tableCard, tableProjects, tableScrollVisible, tdCellProjects, thCellProjects
} from './catalogClasses';

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

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Projetos</h2><p className={screenDescription}>Cadastre e administre os workspaces disponíveis para esta credencial.</p></div><button className={`${buttonPrimary} ${screenAction}`} type="button" onClick={() => setShowCreate(true)}>Novo projeto</button></div>
    <section className={tableCard}><div className={sectionHeading}><div><h3 className={sectionTitle}>Projetos cadastrados</h3><p className={sectionDescription}>{projects.length} {projects.length === 1 ? 'projeto cadastrado' : 'projetos cadastrados'}</p></div></div>
      {projects.length ? <div className={tableScrollVisible}><table className={tableProjects}><thead><tr><th className={thCellProjects}>Projeto</th><th className={thCellProjects}>Visibilidade</th><th className={thCellProjects}>Responsáveis</th><th className={thCellProjects}>Repositórios</th><th className={thCellProjects}>Atualizado</th><th className={thCellProjects}>Ações</th></tr></thead><tbody>
        {projects.map(project => {
          const inUse = project._id === activeProjectId;
          const repositoryTotal = project.repositories?.length ?? 0;
          return <tr key={project._id} className={inUse ? rowSelected : rowHover}>
            <td className={tdCellProjects}><div className={projectTitle}><strong className={projectName}>{project.name}</strong>{inUse && <span className={badgeInUse}>Em uso</span>}</div><small className={rowIdProjects} title={project._id}>{project._id}</small></td>
            <td className={tdCellProjects}><span className={project.visibility === 'private' ? badgePrivate : badgeShared}>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</span></td>
            <td className={tdCellProjects}>{(() => { const state = membersByProject.get(project._id); return state?.isPending ? <span className="text-muted-strong">Carregando…</span> : state?.isError ? <span className="text-muted-strong" title="Não foi possível listar as credenciais deste projeto">Indisponível</span> : <AvatarStack label={'Responsáveis de ' + project.name} people={(state?.members ?? []).map(memberPerson)} />; })()}</td>
            <td className={tdCellProjects}><span className={repositoryCount}><strong className={repositoryCountValue}>{repositoryTotal}</strong>{repositoryTotal === 1 ? 'repositório' : 'repositórios'}</span></td>
            <td className={tdCellProjects}><time className="whitespace-nowrap" dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time></td>
            <td className={tdCellProjects}><div className={rowActionsProjects} role="group" aria-label={`Ações do projeto ${project.name}`}><button className={buttonPrimaryCompact} type="button" onClick={() => onSelectProject(project._id)}>Usar</button><button className={buttonSecondaryCompact} type="button" onClick={() => setSelected(project)}>Ver</button><button className={buttonSecondaryCompact} type="button" onClick={() => setEditing(project)}>Editar</button><button className={dangerTextCompact} type="button" disabled={archive.isPending} onClick={() => { if (window.confirm(`Arquivar o projeto “${project.name}”?`)) archive.mutate(project); }}>Arquivar</button></div></td>
        </tr>;
        })}
      </tbody></table></div> : <div className={emptyState}><h3 className={emptyTitle}>Nenhum projeto</h3><p className={emptyText}>Use “Novo projeto” para cadastrar o primeiro.</p></div>}
      {archive.isError && <p className={notice.error} role="alert">{errorMessage(archive.error)}</p>}
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

  return <dialog ref={dialogRef} className={projectDialog} aria-labelledby="create-project-dialog-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }} onClick={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <header className={dialogHeaderFixed}><div><p className={eyebrow}>PROJETO</p><h2 id="create-project-dialog-title" className={dialogTitle}>Cadastrar projeto</h2><p className={dialogSubtitle}>Reúna as informações, os repositórios e as regras de trabalho do seu projeto.</p></div><button type="button" className={iconButton} onClick={close} disabled={saving} aria-label="Fechar">×</button></header>
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
  return <dialog ref={dialogRef} className={mode === 'edit' ? projectDialog : recordDialog} aria-labelledby="project-record-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }} onClick={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <header className={mode === 'edit' ? dialogHeaderFixed : dialogHeader}><div><p className={eyebrow}>PROJETO · {mode === 'view' ? 'DETALHE' : 'EDIÇÃO'}</p><h2 id="project-record-title" className={dialogTitle}>{mode === 'view' ? record.name : 'Editar projeto'}</h2><p className={dialogSubtitle}>{mode === 'view' ? project._id : 'Atualize as informações, os repositórios e as regras de trabalho do seu projeto.'}</p></div><button className={iconButton} type="button" onClick={close} disabled={saving} aria-label="Fechar">×</button></header>
    {fullProject.isPending ? <div className={loading}>Carregando projeto…</div> : fullProject.isError ? <p className={dialogNotice} role="alert">{errorMessage(fullProject.error)}</p> : mode === 'view' ? <div className={recordBody}>
      <dl className={detailGrid}><div className={detailItem}><dt className={detailTerm}>Visibilidade</dt><dd className={detailValue}>{record.visibility === 'private' ? 'Privado' : 'Compartilhado'}</dd></div><div className={detailItem}><dt className={detailTerm}>Áreas</dt><dd className={detailValue}>{record.areas?.join(', ') || '—'}</dd></div></dl>
      <section className={detailSection}><h3 className={detailSectionTitle}>Descrição</h3><MarkdownView content={record.description ?? ''} /></section>
      <section className={detailSection}><h3 className={detailSectionTitle}>Instruções</h3><MarkdownView content={record.instructions ?? ''} /></section>
      <section className={detailSection}><h3 className={detailSectionTitle}>Repositórios</h3>{(record.repositories ?? []).map(repository => <article className={repositoryDetail} key={repository.id}><strong className={repositoryDetailName}>{repository.name}</strong><span className={repositoryDetailUrl}>{repository.url}</span><MarkdownView content={repository.instructions ?? ''} /></article>)}</section>
    </div> : <ProjectCreateForm token={token} nonce={nonce} project={record} notify={notify ?? (() => undefined)} inDialog dialogTitleId="project-record-title" onCancel={close} onSavingChange={setSaving} onSaved={() => onSaved?.()} />}
    {mode === 'view' && <footer className={dialogFooter}><button className={buttonSecondary} onClick={close}>Fechar</button></footer>}
  </dialog>;
}
