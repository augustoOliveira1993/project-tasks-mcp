import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationId, query, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { AvatarStack } from '../../components/ui/AvatarStack';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
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

export function ProjectsCatalog({ token, nonce, projects, projectsPending, projectsError, activeProjectId, notify, onChanged, onProjectCreated, onSelectProject }: {
  token: string; nonce: string; projects: Project[]; activeProjectId: string; notify: (message: string, kind?: string) => void;
  projectsPending: boolean; projectsError: boolean;
  onChanged: () => void; onProjectCreated: (project: Project) => void; onSelectProject: (projectId: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const queryClient = useQueryClient();
  const membersByProject = useProjectMembers(token, nonce, projects.map(project => project._id));
  const archive = useMutation({
    mutationFn: (project: Project) => request(token, '/admin/archive', { body: { operationId: operationId(), projectId: project._id, kind: 'project', id: project._id, version: project.version } }),
    onSuccess: async (_result, project) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      if (project._id === activeProjectId) onSelectProject('');
      notify(`Projeto “${project.name}” arquivado.`, 'success');
      setArchiving(null);
      onChanged();
    },
    onError: error => notify(errorMessage(error), 'error')
  });

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Projetos</h2><p className={screenDescription}>Cadastre e administre os workspaces disponíveis para esta credencial.</p></div><Button className={`${buttonPrimary} ${screenAction}`} onClick={() => setShowCreate(true)}>Novo projeto</Button></div>
    <section className={tableCard}><div className={sectionHeading}><div><h3 className={sectionTitle}>Projetos cadastrados</h3><p className={sectionDescription}>{projects.length} {projects.length === 1 ? 'projeto cadastrado' : 'projetos cadastrados'}</p></div></div>
      {projectsPending ? <div className={loading} role="status" aria-live="polite">Carregando projetos…</div> : projects.length ? <div className={tableScrollVisible}><Table className={tableProjects}><TableHeader><TableRow><TableHead className={thCellProjects}>Projeto</TableHead><TableHead className={thCellProjects}>Visibilidade</TableHead><TableHead className={thCellProjects}>Responsáveis</TableHead><TableHead className={thCellProjects}>Repositórios</TableHead><TableHead className={thCellProjects}>Atualizado</TableHead><TableHead className={thCellProjects}>Ações</TableHead></TableRow></TableHeader><TableBody>
        {projects.map(project => {
          const inUse = project._id === activeProjectId;
          const repositoryTotal = project.repositories?.length ?? 0;
          return <TableRow key={project._id} className={inUse ? rowSelected : rowHover}>
            <TableCell className={tdCellProjects}><div className={projectTitle}><strong className={projectName}>{project.name}</strong>{inUse && <span className={badgeInUse}>Em uso</span>}</div><small className={rowIdProjects} title={project._id}>{project._id}</small></TableCell>
            <TableCell className={tdCellProjects}><span className={project.visibility === 'private' ? badgePrivate : badgeShared}>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</span></TableCell>
            <TableCell className={tdCellProjects}>{(() => { const state = membersByProject.get(project._id); return state?.isPending ? <span className="text-muted-strong">Carregando…</span> : state?.isError ? <span className="text-muted-strong" title="Não foi possível listar as credenciais deste projeto">Indisponível</span> : <AvatarStack label={'Responsáveis de ' + project.name} people={(state?.members ?? []).map(memberPerson)} />; })()}</TableCell>
            <TableCell className={tdCellProjects}><span className={repositoryCount}><strong className={repositoryCountValue}>{repositoryTotal}</strong>{repositoryTotal === 1 ? 'repositório' : 'repositórios'}</span></TableCell>
            <TableCell className={tdCellProjects}><time className="whitespace-nowrap" dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time></TableCell>
            <TableCell className={tdCellProjects}><div className={rowActionsProjects} role="group" aria-label={`Ações do projeto ${project.name}`}><Button className={buttonPrimaryCompact} onClick={() => onSelectProject(project._id)}>Usar</Button><Button variant="outline" className={buttonSecondaryCompact} onClick={() => setSelected(project)}>Ver</Button><Button variant="outline" className={buttonSecondaryCompact} onClick={() => setEditing(project)}>Editar</Button><Button variant="ghost" className={dangerTextCompact} disabled={archive.isPending} onClick={() => setArchiving(project)}>Arquivar</Button></div></TableCell>
          </TableRow>;
        })}
      </TableBody></Table></div> : projectsError ? <div className={emptyState}><h3 className={emptyTitle}>Não foi possível carregar os projetos</h3><p className={emptyText}>Tente novamente para atualizar a lista.</p><Button variant="outline" className={buttonSecondary} onClick={onChanged}>Tentar novamente</Button></div> : <div className={emptyState}><h3 className={emptyTitle}>Nenhum projeto</h3><p className={emptyText}>Use “Novo projeto” para cadastrar o primeiro.</p></div>}
      {archive.isError && <p className={notice.error} role="alert">{errorMessage(archive.error)}</p>}
    </section>
    {selected && <ProjectRecordDialog token={token} nonce={nonce} project={selected} mode="view" close={() => setSelected(null)} />}
    {editing && <ProjectRecordDialog token={token} nonce={nonce} project={editing} mode="edit" close={() => setEditing(null)} notify={notify} onSaved={() => { setEditing(null); onChanged(); }} />}
    {showCreate && <ProjectCreateDialog token={token} nonce={nonce} notify={notify} close={() => setShowCreate(false)} onCreated={project => { setShowCreate(false); onProjectCreated(project); }} />}
    <ConfirmDialog open={Boolean(archiving)} title="Arquivar projeto" description={archiving ? `Arquivar o projeto “${archiving.name}”?` : ''} confirmLabel="Arquivar projeto" pendingLabel="Arquivando…" pending={archive.isPending} onOpenChange={open => { if (!open) setArchiving(null); }} onConfirm={() => { if (archiving) archive.mutate(archiving); }} />
  </section>;
}

function ProjectCreateDialog({ token, nonce, notify, close, onCreated }: {
  token: string; nonce: string; notify: (message: string, kind?: string) => void;
  close: () => void; onCreated: (project: Project) => void;
}) {
  const [saving, setSaving] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !saving) close(); }}>
    <DialogContent className={projectDialog} showCloseButton={false}>
    <DialogHeader className={dialogHeaderFixed}><div><p className={eyebrow}>PROJETO</p><DialogTitle id="create-project-dialog-title" className={dialogTitle}>Cadastrar projeto</DialogTitle><DialogDescription className={dialogSubtitle}>Reúna as informações, os repositórios e as regras de trabalho do seu projeto.</DialogDescription></div><Button type="button" variant="ghost" className={iconButton} onClick={close} disabled={saving} aria-label="Fechar">×</Button></DialogHeader>
    <ProjectCreateForm token={token} nonce={nonce} notify={notify} inDialog onCancel={close} onSavingChange={setSaving} onSaved={onCreated} />
    </DialogContent>
  </Dialog>;
}

function ProjectRecordDialog({ token, nonce, project, mode, close, notify, onSaved }: {
  token: string; nonce: string; project: Project; mode: 'view' | 'edit'; close: () => void;
  notify?: (message: string, kind?: string) => void; onSaved?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const fullProject = useQuery({
    queryKey: ['catalog-project-record', nonce, project._id],
    queryFn: () => query<Project>(token, 'get_record', { projectId: project._id, kind: 'project', id: project._id }),
    ...(mode === 'edit' ? { refetchOnMount: 'always' as const } : {})
  });
  const record = fullProject.data ?? project;
  return <Dialog open onOpenChange={open => { if (!open && !saving) close(); }}>
    <DialogContent className={mode === 'edit' ? projectDialog : recordDialog} showCloseButton={false}>
    <DialogHeader className={mode === 'edit' ? dialogHeaderFixed : dialogHeader}><div><p className={eyebrow}>PROJETO · {mode === 'view' ? 'DETALHE' : 'EDIÇÃO'}</p><DialogTitle id="project-record-title" className={dialogTitle}>{mode === 'view' ? record.name : 'Editar projeto'}</DialogTitle><DialogDescription className={dialogSubtitle}>{mode === 'view' ? project._id : 'Atualize as informações, os repositórios e as regras de trabalho do seu projeto.'}</DialogDescription></div><Button variant="ghost" className={iconButton} type="button" onClick={close} disabled={saving} aria-label="Fechar">×</Button></DialogHeader>
     {fullProject.isPending || (mode === 'edit' && fullProject.isFetching) ? <div className={loading} role="status" aria-live="polite">Carregando dados atuais do projeto…</div> : fullProject.isError ? <div className={dialogNotice} role="alert"><p>{errorMessage(fullProject.error)}</p><Button variant="outline" className={buttonSecondary} type="button" onClick={() => void fullProject.refetch()}>Tentar novamente</Button></div> : mode === 'view' ? <div className={recordBody}>
      <dl className={detailGrid}><div className={detailItem}><dt className={detailTerm}>Visibilidade</dt><dd className={detailValue}>{record.visibility === 'private' ? 'Privado' : 'Compartilhado'}</dd></div><div className={detailItem}><dt className={detailTerm}>Áreas</dt><dd className={detailValue}>{record.areas?.join(', ') || '—'}</dd></div></dl>
      <section className={detailSection}><h3 className={detailSectionTitle}>Descrição</h3><MarkdownView content={record.description ?? ''} /></section>
      <section className={detailSection}><h3 className={detailSectionTitle}>Instruções</h3><MarkdownView content={record.instructions ?? ''} /></section>
      <section className={detailSection}><h3 className={detailSectionTitle}>Repositórios</h3>{(record.repositories ?? []).map(repository => <article className={repositoryDetail} key={repository.id}><strong className={repositoryDetailName}>{repository.name}</strong><span className={repositoryDetailUrl}>{repository.url}</span><MarkdownView content={repository.instructions ?? ''} /></article>)}</section>
    </div> : <ProjectCreateForm token={token} nonce={nonce} project={record} notify={notify ?? (() => undefined)} inDialog dialogTitleId="project-record-title" onCancel={close} onSavingChange={setSaving} onSaved={() => onSaved?.()} />}
    {mode === 'view' && <DialogFooter className={dialogFooter}><Button variant="outline" className={buttonSecondary} onClick={close}>Fechar</Button></DialogFooter>}
    </DialogContent>
  </Dialog>;
}
