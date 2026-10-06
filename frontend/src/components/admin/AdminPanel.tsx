import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminCredentials, operationId, request } from '../../api';
import type { AdminCredential, Project } from '../../api';
import { Badge } from '../ui/Badge';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';
import { makeToken } from '../../lib/token';
import { ProjectExportPanel } from './ProjectExportPanel';
import { ResponsibleRegistration } from './ResponsibleRegistration';
import { fetchAssignees } from '../../features/tasks/assignees';
import { ProjectImportPanel } from './ProjectImportPanel';
import './admin-panels.css';

const adminPanelTabs = [
  { id: 'tools', label: 'Ferramentas administrativas' },
  { id: 'credentials', label: 'Credenciais' },
  { id: 'responsibles', label: 'Responsáveis' },
  { id: 'export', label: 'Exportar/Importar Projeto' },
  { id: 'danger', label: 'Zona de perigo' }
] as const;

export function repositoryGitFields(project: Project, repositoryId: string) {
  const repository = project.repositories?.find(item => item.id === repositoryId);
  return {
    remoteUrl: repository?.git?.canonicalRemoteUrl ?? '',
    rootCommit: repository?.git?.rootCommit ?? ''
  };
}

export function AdminPanel({ project, projects, onChanged, notify, token, canHardDelete, systemAdmin, actionPending, onRequestHardDeleteProject, onArchiveProject }: { token: string; project: Project; projects: Project[]; onChanged: () => void | Promise<unknown>; notify: (message: string, kind?: string) => void; canHardDelete: boolean; systemAdmin: boolean; actionPending: boolean; onRequestHardDeleteProject: (project: Project) => void; onArchiveProject: () => void }) {
  const queryClient = useQueryClient();
  const [activePanel, setActivePanel] = useState<(typeof adminPanelTabs)[number]['id']>('tools');
  const [agentEmail, setAgentEmail] = useState('');
  const [agentIssueConfirmed, setAgentIssueConfirmed] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [repositoryId, setRepositoryId] = useState(project.repositories?.[0]?.id ?? '');
  const [remoteUrl, setRemoteUrl] = useState(() => repositoryGitFields(project, project.repositories?.[0]?.id ?? '').remoteUrl);
  const [rootCommit, setRootCommit] = useState(() => repositoryGitFields(project, project.repositories?.[0]?.id ?? '').rootCommit);
  const [issued, setIssued] = useState<{ token: string; id: string; email: string; scope: string; projectName?: string } | null>(null);
  const [credentialEmail, setCredentialEmail] = useState('');
  const [credentialScope, setCredentialScope] = useState<'all' | 'human' | 'agent'>('all');
  const [credentialStatus, setCredentialStatus] = useState<'all' | 'active' | 'revoked'>('all');
  const [credentialProjectId, setCredentialProjectId] = useState(systemAdmin ? '' : project._id);
  const [credentialLimit, setCredentialLimit] = useState(25);
  const [credentialCursors, setCredentialCursors] = useState<Array<string | undefined>>([undefined]);
  useEffect(() => {
    const repository = project.repositories?.find(item => item.id === repositoryId) ?? project.repositories?.[0];
    const selectedId = repository?.id ?? '';
    if (selectedId !== repositoryId) setRepositoryId(selectedId);
    const fields = repositoryGitFields(project, selectedId);
    setRemoteUrl(fields.remoteUrl);
    setRootCommit(fields.rootCommit);
  }, [project._id, project.repositories, repositoryId]);
  useEffect(() => {
    setCredentialProjectId(systemAdmin ? '' : project._id);
    setCredentialCursors([undefined]);
  }, [project._id, systemAdmin]);
  const currentCursor = credentialCursors[credentialCursors.length - 1];
  const credentialsQuery = useQuery({
    queryKey: ['admin-credentials', token, credentialEmail.trim(), credentialScope, credentialStatus, credentialProjectId, credentialLimit, currentCursor],
    queryFn: () => listAdminCredentials(token, {
      ...(credentialScope === 'agent' ? {} : credentialProjectId ? { projectId: credentialProjectId } : {}),
      ...(credentialScope !== 'all' ? { scope: credentialScope } : {}),
      ...(credentialStatus !== 'all' ? { status: credentialStatus } : {}),
      ...(credentialEmail.trim() ? { email: credentialEmail.trim() } : {}),
      ...(currentCursor ? { after: currentCursor } : {}),
      limit: credentialLimit
    }),
    retry: false
  });
  const assigneesQuery = useQuery({ queryKey: ['assignees', 'admin', token, project._id, systemAdmin], staleTime: 30_000, retry: false, queryFn: () => fetchAssignees(token, project._id, systemAdmin) });
  const issueMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<{ credentialId: string }>(token, '/admin', { body })
  });
  const bindingMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<Project>(token, '/admin', { body })
  });
  const grantMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<{ credentialId: string; projectId: string; role: string; version: number; alreadyGranted: boolean }>(token, '/admin', { body })
  });
  const revokeMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<{ credentialId: string }>(token, '/admin', { body })
  });
  const busy = issueMutation.isPending || bindingMutation.isPending || grantMutation.isPending;

  async function issue(scope: 'agent' | 'project') {
    const email = scope === 'agent' ? agentEmail.trim() : memberEmail.trim();
    if (!email) return notify('Informe o e-mail da pessoa.', 'error');
    setIssued(null);
    try {
      const secret = makeToken();
      const result = scope === 'agent'
        ? await issueMutation.mutateAsync({ action: 'issue', operationId: operationId(), userId: email, scope: 'agent', systemAdmin: false, token: secret })
        : await issueMutation.mutateAsync({ action: 'issue_project_member', operationId: operationId(), projectId: project._id, version: project.version, userId: email, token: secret });
      setIssued({ token: secret, id: result.credentialId, email, scope, ...(scope === 'project' ? { projectName: project.name } : {}) });
      if (scope === 'agent') {
        setAgentEmail('');
        setAgentIssueConfirmed(false);
      } else {
        setMemberEmail('');
      }
      notify('Credencial emitida. Copie o token agora; ele não será exibido novamente.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
      onChanged();
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function reissue(credential: AdminCredential) {
    const targetProject = credential.projectId ? projects.find(item => item._id === credential.projectId) : undefined;
    if (credential.scope === 'human' && !targetProject) {
      notify('Não foi possível identificar um projeto autorizado para esta credencial.', 'error');
      return;
    }
    const scopeLabel = credential.scope === 'agent' ? 'agente' : 'membro do projeto ' + (credential.projectName ?? targetProject?.name ?? '');
    if (!window.confirm(`Gerar um novo token para ${credential.email} (${scopeLabel})? O token anterior continuará ativo.`)) return;
    setIssued(null);
    try {
      const secret = makeToken();
      const result = credential.scope === 'agent'
        ? await issueMutation.mutateAsync({ action: 'issue', operationId: operationId(), userId: credential.email, scope: 'agent', systemAdmin: false, token: secret })
        : await issueMutation.mutateAsync({ action: 'issue_project_member', operationId: operationId(), projectId: targetProject!._id, version: targetProject!.version, userId: credential.email, token: secret });
      setIssued({ token: secret, id: result.credentialId, email: credential.email, scope: credential.scope, ...(targetProject ? { projectName: targetProject.name } : {}) });
      notify('Nova credencial emitida. Copie o token agora; ele não será exibido novamente.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
      onChanged();
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function grantProject(credential: AdminCredential, projectId: string) {
    const target = projects.find(item => item._id === projectId);
    if (!target || credential.state !== 'active' || credential.scope !== 'human') return;
    if (!window.confirm(`Conceder a ${credential.email} acesso ao projeto ${target.name}? As credenciais desse e-mail também passarão a acessar o projeto.`)) return;
    try {
      const result = await grantMutation.mutateAsync({ action: 'grant_credential_project', operationId: operationId(), projectId: target._id, version: target.version, credentialId: credential.credentialId });
      notify(result.alreadyGranted ? `${credential.email} já tinha acesso a ${target.name}.` : `Acesso a ${target.name} adicionado à credencial existente de ${credential.email}.`, result.alreadyGranted ? 'info' : 'success');
      await queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
      await onChanged();
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function revokeCredential(credential: AdminCredential) {
    if (!systemAdmin || credential.state !== 'active') return;
    const confirmed = window.confirm(`Revogar a credencial ${credential.credentialId} de ${credential.email}? Somente esta credencial será revogada. Outras credenciais ativas do mesmo e-mail continuarão válidas.`);
    if (!confirmed) return;
    try {
      await revokeMutation.mutateAsync({ action: 'revoke', operationId: operationId(), credentialId: credential.credentialId });
      notify('Credencial revogada. Outras credenciais ativas deste e-mail continuam válidas.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function bindRepository(event: FormEvent) {
    event.preventDefault();
    try {
      const updated = await bindingMutation.mutateAsync({ action: 'bind_repository_git', operationId: operationId(), projectId: project._id, version: project.version, repositoryId, canonicalRemoteUrl: remoteUrl.trim(), rootCommit: rootCommit.trim() });
      const fields = repositoryGitFields(updated, repositoryId);
      setRemoteUrl(fields.remoteUrl || remoteUrl.trim());
      setRootCommit(fields.rootCommit || rootCommit.trim().toLowerCase());
      notify('Vínculo Git salvo.', 'success');
      onChanged();
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function copyIssued() {
    if (!issued) return;
    if (await copyToClipboard(issued.token)) notify('Token copiado.', 'success');
    else notify('Não foi possível copiar automaticamente. Selecione e copie o token.', 'error');
  }

  return <div className="admin-panels">
    <div className="admin-panel-tabs" role="tablist" aria-label="Administração do projeto">
      {adminPanelTabs.map(tab => <button
        key={tab.id} id={`admin-tab-${tab.id}`} type="button" role="tab" aria-selected={activePanel === tab.id}
        aria-controls={`admin-panel-${tab.id}`} tabIndex={activePanel === tab.id ? 0 : -1}
        className={tab.id === 'danger' ? 'admin-tab-danger' : undefined} onClick={() => setActivePanel(tab.id)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const currentIndex = adminPanelTabs.findIndex(item => item.id === activePanel);
          const next = event.key === 'Home' ? adminPanelTabs[0].id : event.key === 'End' ? adminPanelTabs[adminPanelTabs.length - 1].id : adminPanelTabs[(currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + adminPanelTabs.length) % adminPanelTabs.length].id;
          setActivePanel(next);
          document.getElementById(`admin-tab-${next}`)?.focus();
        }}>{tab.label}</button>)}
    </div>
      {activePanel === 'credentials' && issued && <div className="issued-token"><div><strong>Nova credencial · {issued.email}</strong><small>ID {issued.id}{issued.projectName ? ` · ${issued.projectName}` : ` · ${issued.scope === 'agent' ? 'agente' : 'pessoa'}`}</small></div><label>Token — copie agora, ele só estará disponível nesta sessão<textarea readOnly value={issued.token} rows={3} onFocus={event => event.currentTarget.select()} /></label><div className="button-row"><button type="button" className="button secondary" onClick={() => void copyIssued()}>Copiar</button><button type="button" className="button ghost" onClick={() => setIssued(null)}>Limpar</button></div></div>}

    <div id="admin-panel-tools" role="tabpanel" aria-labelledby="admin-tab-tools" hidden={activePanel !== 'tools'} tabIndex={0}>
    <div className="admin-disclosure-content"><div className="admin-grid">
    <section className="panel-card wide-card"><div className="section-heading"><div><p className="eyebrow">REPOSITÓRIOS</p><h2>Vincular repositório Git</h2></div><span className="lock-mark">⌑</span></div><p className="muted-text">O vínculo identifica o repositório; as permissões continuam sendo controladas pelo projeto.</p><form className="admin-form-grid" onSubmit={bindRepository}><label>Repositório<select value={repositoryId} onChange={event => { const nextId = event.target.value; setRepositoryId(nextId); const fields = repositoryGitFields(project, nextId); setRemoteUrl(fields.remoteUrl); setRootCommit(fields.rootCommit); }} required><option value="">Selecione</option>{(project.repositories ?? []).map(repository => <option value={repository.id} key={repository.id}>{repository.name}</option>)}</select></label><label>URL Git canônica<input value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} required placeholder="https://github.com/org/repo.git" /></label><label>Commit raiz<input value={rootCommit} onChange={event => setRootCommit(event.target.value)} required minLength={40} maxLength={40} placeholder="40 caracteres hexadecimais" /><small className="git-root-help" role="note"><span>Para localizar o commit raiz, execute na pasta do repositório:</span><code>git rev-list --max-parents=0 HEAD</code><span>Copie o hash de 40 caracteres retornado.</span></small></label><button className="button secondary" disabled={busy || !repositoryId}>Salvar vínculo</button></form>
      <div className="repository-list">{(project.repositories ?? []).map(repository => <div className="resource-row static-row" key={repository.id}><span><strong>{repository.name}</strong><small>{repository.git?.canonicalRemoteUrl ?? repository.url}</small></span><Badge>{repository.git ? 'vinculado' : 'sem vínculo'}</Badge></div>)}</div>
    </section>
    </div></div>
    </div>
    <div id="admin-panel-credentials" role="tabpanel" aria-labelledby="admin-tab-credentials" hidden={activePanel !== 'credentials'} tabIndex={0}>
    <section className="panel-card wide-card credential-issuance" aria-labelledby="credential-issuance-title">
      <div className="section-heading"><div><p className="eyebrow">GERAÇÃO DE CREDENCIAIS</p><h2 id="credential-issuance-title">Emitir novo acesso</h2></div></div>
      <div className="credential-issue-grid">
        {systemAdmin && <section className="credential-issue-card" aria-labelledby="agent-credential-title">
          <div className="section-heading"><div><h3 id="agent-credential-title">Credencial de agente</h3></div></div>
          <p className="muted-text">Acesso global para automações. O token é criado no navegador e mostrado uma única vez.</p>
          <form className="stack-form" autoComplete="off" onSubmit={event => { event.preventDefault(); void issue('agent'); }}>
            <label htmlFor="agent-credential-email">E-mail do agente<input id="agent-credential-email" type="email" value={agentEmail} onChange={event => setAgentEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
            <label className="confirm-line"><input type="checkbox" checked={agentIssueConfirmed} onChange={event => setAgentIssueConfirmed(event.target.checked)} required />Confirmo a emissão de uma nova credencial de agente para este endereço.</label>
            <button className="button primary" disabled={issueMutation.isPending}>{issueMutation.isPending ? 'Emitindo…' : 'Emitir credencial de agente'}</button>
          </form>
        </section>}
        <section className="credential-issue-card" aria-labelledby="project-credential-title">
          <div className="section-heading"><div><h3 id="project-credential-title">Acesso individual ao projeto</h3></div></div>
          <p className="muted-text">Emite um token para uma pessoa colaborar no projeto <strong>{project.name}</strong>.</p>
          <form className="stack-form" autoComplete="off" onSubmit={event => { event.preventDefault(); if (confirm('Emitir acesso ao projeto ' + project.name + ' para ' + memberEmail + '?')) void issue('project'); }}>
            <label htmlFor="project-credential-email">E-mail da pessoa<input id="project-credential-email" type="email" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
            <button className="button secondary" disabled={issueMutation.isPending}>{issueMutation.isPending ? 'Emitindo…' : 'Emitir acesso ao projeto'}</button>
          </form>
        </section>
      </div>
    </section>
    <section className="panel-card wide-card credential-inventory" aria-labelledby="credential-inventory-title">
      <div className="section-heading"><div><p className="eyebrow">CREDENCIAIS EMITIDAS</p><h2 id="credential-inventory-title">Inventário por e-mail</h2></div><button type="button" className="button secondary small-button" onClick={() => void credentialsQuery.refetch()} disabled={credentialsQuery.isFetching}>↻ Atualizar</button></div>
      <p className="muted-text">O acesso aos projetos é concedido por e-mail e compartilhado entre as credenciais ativas do mesmo endereço. Segredos antigos não podem ser recuperados; emitir outro não revoga os anteriores.</p>
      <div className="credential-filters" role="search" aria-label="Filtros de credenciais">
        <label className="credential-search">Buscar por e-mail<input type="search" value={credentialEmail} onChange={event => { setCredentialEmail(event.target.value); setCredentialCursors([undefined]); }} placeholder="nome@empresa.com" /></label>
        <label>Projeto<select value={credentialProjectId} disabled={credentialScope === 'agent'} onChange={event => { setCredentialProjectId(event.target.value); setCredentialCursors([undefined]); }}><option value="" disabled={!systemAdmin}>Todos os projetos</option>{projects.map(item => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>
        <label>Escopo<select value={credentialScope} onChange={event => { setCredentialScope(event.target.value as typeof credentialScope); setCredentialCursors([undefined]); }}><option value="all">Todos</option><option value="human">Pessoas</option><option value="agent" disabled={!systemAdmin}>Agentes</option></select></label>
        <label>Estado<select value={credentialStatus} onChange={event => { setCredentialStatus(event.target.value as typeof credentialStatus); setCredentialCursors([undefined]); }}><option value="all">Todos</option><option value="active">Ativas</option><option value="revoked">Revogadas</option></select></label>
        <label>Por página<select value={credentialLimit} onChange={event => { setCredentialLimit(Number(event.target.value)); setCredentialCursors([undefined]); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
      {credentialScope === 'agent' && <p className="credential-hint" role="note">A consulta de agentes é global e exige credencial de administrador do sistema.</p>}
      {credentialsQuery.isPending ? <div className="loading" role="status">Carregando credenciais…</div> : credentialsQuery.isError ? <div className="notice error" role="alert">{errorMessage(credentialsQuery.error)}</div> : credentialsQuery.data?.items.length ? <div className="table-scroll"><table className="credential-table"><thead><tr><th>E-mail</th><th>ID da credencial</th><th>Escopo</th><th>Estado</th><th>Projeto / emissão</th><th>Ação</th></tr></thead><tbody>{credentialsQuery.data.items.map(credential => {
        const targetProject = credential.projectId ? projects.find(item => item._id === credential.projectId) : undefined;
        const linkedProjectIds = new Set((credential.projects ?? []).map(item => item.projectId));
        const availableProjects = projects.filter(item => !linkedProjectIds.has(item._id));
        const canReissue = credential.scope === 'agent' || Boolean(targetProject);
        return <tr key={credential.credentialId}>
          <td><strong className="credential-email">{credential.email}</strong></td>
          <td><code className="credential-id">{credential.credentialId}</code></td>
          <td><span>{credential.scope === 'agent' ? 'Agente' : 'Pessoa'}</span>{credential.systemAdmin && <small className="credential-role">Administrador do sistema</small>}{credential.role && <small className="credential-role">{credential.role}</small>}</td>
          <td><Badge tone={credential.state === 'active' ? 'green' : 'muted'}>{credential.state === 'active' ? 'Ativa' : 'Revogada'}</Badge></td>
          <td><span className="credential-project-list">{credential.projects?.length ? credential.projects.map(item => `${item.projectName ?? 'Projeto'}${item.role ? ` · ${item.role}` : ''}`).join(', ') : credential.projectName ?? (credential.scope === 'agent' ? 'Global' : 'Sem projeto')}</span><small className="credential-date">{credential.createdAt ? new Date(credential.createdAt).toLocaleString('pt-BR') : 'Data indisponível'}</small></td>
          <td><div className="credential-actions">{systemAdmin && credential.scope === 'human' && credential.state === 'active' && <select aria-label={`Adicionar projeto à credencial de ${credential.email}`} defaultValue="" disabled={grantMutation.isPending || availableProjects.length === 0} onChange={event => { const projectId = event.currentTarget.value; event.currentTarget.value = ''; if (projectId) void grantProject(credential, projectId); }}><option value="" disabled>{availableProjects.length ? 'Adicionar projeto…' : 'Todos já vinculados'}</option>{availableProjects.map(item => <option value={item._id} key={item._id}>{item.name}</option>)}</select>}<button type="button" className="button secondary small-button" onClick={() => void reissue(credential)} disabled={issueMutation.isPending || !canReissue} title={!canReissue ? 'Não há projeto autorizado associado para emitir acesso.' : undefined}>Gerar novo token</button>{systemAdmin && credential.state === 'active' && <button type="button" className="button danger-button small-button" onClick={() => void revokeCredential(credential)} disabled={revokeMutation.isPending} aria-label={`Revogar credencial ${credential.credentialId}`}>Revogar credencial</button>}</div></td>
        </tr>;
      })}</tbody></table></div> : <div className="empty-state compact"><h3>Nenhuma credencial encontrada</h3><p>Ajuste os filtros ou emita a primeira credencial para este escopo.</p></div>}
      <div className="credential-pagination"><span>Página {credentialCursors.length}{credentialsQuery.data?.items.length ? ` · ${credentialsQuery.data.items.length} registro(s)` : ''}</span><div className="button-row"><button type="button" className="button secondary small-button" onClick={() => setCredentialCursors(values => values.slice(0, -1))} disabled={credentialCursors.length <= 1 || credentialsQuery.isFetching}>Anterior</button><button type="button" className="button secondary small-button" onClick={() => { if (credentialsQuery.data?.next) setCredentialCursors(values => [...values, credentialsQuery.data!.next!]); }} disabled={!credentialsQuery.data?.next || credentialsQuery.isFetching}>Próxima</button></div></div>
    </section>
    </div>
    <div id="admin-panel-responsibles" role="tabpanel" aria-labelledby="admin-tab-responsibles" hidden={activePanel !== 'responsibles'} tabIndex={0}>
      <ResponsibleRegistration key={token} token={token} projects={projects} currentProjectId={project._id} systemAdmin={systemAdmin} knownEmails={(assigneesQuery.data ?? []).map(item => item.email)} notify={notify} onChanged={onChanged} />
    </div>
    <div id="admin-panel-danger" role="tabpanel" aria-labelledby="admin-tab-danger" hidden={activePanel !== 'danger'} tabIndex={0}>
      <p className="danger-intro" role="note">Ações desta aba afetam o projeto inteiro. Arquivar é reversível; a exclusão permanente não pode ser desfeita e exige digitar o nome do projeto para confirmar.</p>
      <div className="admin-grid danger-tab-grid">
  <section className="panel-card wide-card archive-panel"><div className="section-heading"><div><p className="eyebrow">ARQUIVAMENTO REVERSÍVEL</p><h2>Arquivar projeto</h2></div><Badge tone="amber">Preserva histórico</Badge></div><p className="muted-text">O projeto sai da lista ativa, mas pode ser restaurado depois. O servidor verifica se ainda há tarefas ativas e valida sua permissão de administrador do projeto.</p><button type="button" className="button secondary" disabled={actionPending} onClick={onArchiveProject}>{actionPending ? 'Arquivando…' : 'Arquivar projeto'}</button></section>
  {canHardDelete && <section className="panel-card wide-card danger-zone" aria-labelledby="project-delete-title"><div className="section-heading"><div><p className="eyebrow">EXCLUSÃO PERMANENTE</p><h2 id="project-delete-title">Excluir projeto e dados relacionados</h2></div><Badge tone="red">Administrador do sistema</Badge></div><p className="muted-text">Remove permanentemente o projeto, repositórios exclusivos, funcionalidades, tarefas, histórico, documentos, eventos e dados de automação. Credenciais humanas compartilhadas com outros projetos são preservadas. Execuções ou automações ativas fazem o servidor recusar a exclusão sem remover dados.</p><button type="button" className="button danger-button" onClick={() => onRequestHardDeleteProject(project)}>Excluir projeto definitivamente</button></section>}
      </div>
    </div>
    <div id="admin-panel-export" role="tabpanel" aria-labelledby="admin-tab-export" hidden={activePanel !== 'export'} tabIndex={0}>
      <div className="project-transfer-grid">
        <ProjectExportPanel key={project._id + token} project={project} token={token} />
        <ProjectImportPanel key={token} token={token} canImport={canHardDelete} onImported={onChanged} />
      </div>
    </div>
  </div>;
}
