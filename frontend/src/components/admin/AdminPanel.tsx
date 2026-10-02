import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminCredentials, operationId, request } from '../../api';
import type { AdminCredential, Project } from '../../api';
import { Badge } from '../ui/Badge';
import { ProjectAreasManager } from '../projects/ProjectAreasManager';
import { errorMessage } from '../../lib/format';
import { makeToken } from '../../lib/token';
import { ProjectExportPanel } from './ProjectExportPanel';
import { ProjectImportPanel } from './ProjectImportPanel';
import './admin-panels.css';

export function repositoryGitFields(project: Project, repositoryId: string) {
  const repository = project.repositories?.find(item => item.id === repositoryId);
  return {
    remoteUrl: repository?.git?.canonicalRemoteUrl ?? '',
    rootCommit: repository?.git?.rootCommit ?? ''
  };
}

export function AdminPanel({ project, projects, onChanged, notify, token, canHardDelete, actionPending, onRequestHardDeleteProject, onArchiveProject }: { token: string; project: Project; projects: Project[]; onChanged: () => void; notify: (message: string, kind?: string) => void; canHardDelete: boolean; actionPending: boolean; onRequestHardDeleteProject: (project: Project) => void; onArchiveProject: () => void }) {
  const queryClient = useQueryClient();
  const [activePanel, setActivePanel] = useState<'tools' | 'export'>('tools');
  const [agentEmail, setAgentEmail] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [repositoryId, setRepositoryId] = useState(project.repositories?.[0]?.id ?? '');
  const [remoteUrl, setRemoteUrl] = useState(() => repositoryGitFields(project, project.repositories?.[0]?.id ?? '').remoteUrl);
  const [rootCommit, setRootCommit] = useState(() => repositoryGitFields(project, project.repositories?.[0]?.id ?? '').rootCommit);
  const [issued, setIssued] = useState<{ token: string; id: string; email: string; scope: string; projectName?: string } | null>(null);
  const [credentialEmail, setCredentialEmail] = useState('');
  const [credentialScope, setCredentialScope] = useState<'all' | 'human' | 'agent'>('all');
  const [credentialStatus, setCredentialStatus] = useState<'all' | 'active' | 'revoked'>('all');
  const [credentialProjectId, setCredentialProjectId] = useState(project._id);
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
    setCredentialProjectId(project._id);
    setCredentialCursors([undefined]);
  }, [project._id]);
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
  const issueMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<{ credentialId: string }>(token, '/admin', { body })
  });
  const bindingMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<Project>(token, '/admin', { body })
  });
  const busy = issueMutation.isPending || bindingMutation.isPending;

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
    try { await navigator.clipboard.writeText(issued.token); notify('Token copiado.', 'success'); }
    catch { notify('Não foi possível copiar automaticamente. Selecione e copie o token.', 'error'); }
  }

  return <div className="admin-panels">
    <div className="admin-panel-tabs" role="tablist" aria-label="Administração do projeto">
      {([{ id: 'tools', label: 'Ferramentas administrativas' }, { id: 'export', label: 'Exportar/Importar Projeto' }] as const).map(tab => <button
        key={tab.id} id={`admin-tab-${tab.id}`} type="button" role="tab" aria-selected={activePanel === tab.id}
        aria-controls={`admin-panel-${tab.id}`} tabIndex={activePanel === tab.id ? 0 : -1}
        onClick={() => setActivePanel(tab.id)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'tools' : event.key === 'End' ? 'export' : activePanel === 'tools' ? 'export' : 'tools';
          setActivePanel(next);
          document.getElementById(`admin-tab-${next}`)?.focus();
        }}>{tab.label}</button>)}
    </div>
    <div id="admin-panel-tools" role="tabpanel" aria-labelledby="admin-tab-tools" hidden={activePanel !== 'tools'} tabIndex={0}>
    <div className="admin-disclosure-content"><div className="admin-grid">
    <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">CREDENCIAIS</p><h2>Emitir credencial de agente</h2></div><span className="lock-mark">⌑</span></div><p className="muted-text">O token é gerado no navegador e mostrado uma única vez após a emissão.</p><form className="stack-form" onSubmit={event => { event.preventDefault(); void issue('agent'); }}><label>E-mail do agente<input type="email" value={agentEmail} onChange={event => setAgentEmail(event.target.value)} required placeholder="pessoa@empresa.com" /></label><label className="confirm-line"><input type="checkbox" required />Confirmo a emissão da credencial de agente para este endereço.</label><button className="button primary" disabled={busy}>Emitir credencial</button></form>
    </section>
    <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">ACESSO AO PROJETO</p><h2>Conceder acesso individual</h2></div><span className="lock-mark">⌑</span></div><p className="muted-text">Emite token de acesso para uma pessoa neste projeto.</p><form className="stack-form" onSubmit={event => { event.preventDefault(); if (confirm('Emitir acesso ao projeto ' + project.name + ' para ' + memberEmail + '?')) void issue('project'); }}><label>E-mail<input type="email" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} required placeholder="pessoa@empresa.com" /></label><button className="button secondary" disabled={busy}>Emitir acesso</button></form>
    </section>
    <ProjectAreasManager token={token} project={project} onChanged={onChanged} notify={notify} />
    <section className="panel-card wide-card credential-inventory" aria-labelledby="credential-inventory-title">
      <div className="section-heading"><div><p className="eyebrow">CREDENCIAIS EMITIDAS</p><h2 id="credential-inventory-title">Inventário por e-mail</h2></div><button type="button" className="button secondary small-button" onClick={() => void credentialsQuery.refetch()} disabled={credentialsQuery.isFetching}>↻ Atualizar</button></div>
      <p className="muted-text">Consulte os metadados de cada token. Segredos antigos não podem ser recuperados; emitir outro não revoga os anteriores.</p>
      <div className="credential-filters" role="search" aria-label="Filtros de credenciais">
        <label className="credential-search">Buscar por e-mail<input type="search" value={credentialEmail} onChange={event => { setCredentialEmail(event.target.value); setCredentialCursors([undefined]); }} placeholder="nome@empresa.com" /></label>
        <label>Projeto<select value={credentialProjectId} disabled={credentialScope === 'agent'} onChange={event => { setCredentialProjectId(event.target.value); setCredentialCursors([undefined]); }}><option value="">Todos os projetos</option>{projects.map(item => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>
        <label>Escopo<select value={credentialScope} onChange={event => { setCredentialScope(event.target.value as typeof credentialScope); setCredentialCursors([undefined]); }}><option value="all">Todos</option><option value="human">Pessoas</option><option value="agent">Agentes</option></select></label>
        <label>Estado<select value={credentialStatus} onChange={event => { setCredentialStatus(event.target.value as typeof credentialStatus); setCredentialCursors([undefined]); }}><option value="all">Todos</option><option value="active">Ativas</option><option value="revoked">Revogadas</option></select></label>
        <label>Por página<select value={credentialLimit} onChange={event => { setCredentialLimit(Number(event.target.value)); setCredentialCursors([undefined]); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
      {credentialScope === 'agent' && <p className="credential-hint" role="note">A consulta de agentes é global e exige credencial de administrador do sistema.</p>}
      {credentialsQuery.isPending ? <div className="loading" role="status">Carregando credenciais…</div> : credentialsQuery.isError ? <div className="notice error" role="alert">{errorMessage(credentialsQuery.error)}</div> : credentialsQuery.data?.items.length ? <div className="table-scroll"><table className="credential-table"><thead><tr><th>E-mail</th><th>ID da credencial</th><th>Escopo</th><th>Estado</th><th>Projeto / emissão</th><th>Ação</th></tr></thead><tbody>{credentialsQuery.data.items.map(credential => {
        const targetProject = credential.projectId ? projects.find(item => item._id === credential.projectId) : undefined;
        const canReissue = credential.scope === 'agent' || Boolean(targetProject);
        return <tr key={credential.credentialId}>
          <td><strong className="credential-email">{credential.email}</strong></td>
          <td><code className="credential-id">{credential.credentialId}</code></td>
          <td><span>{credential.scope === 'agent' ? 'Agente' : 'Pessoa'}</span>{credential.systemAdmin && <small className="credential-role">Administrador do sistema</small>}{credential.role && <small className="credential-role">{credential.role}</small>}</td>
          <td><Badge tone={credential.state === 'active' ? 'green' : 'muted'}>{credential.state === 'active' ? 'Ativa' : 'Revogada'}</Badge></td>
          <td><span>{credential.projectName ?? (credential.scope === 'agent' ? 'Global' : '—')}</span><small className="credential-date">{credential.createdAt ? new Date(credential.createdAt).toLocaleString('pt-BR') : 'Data indisponível'}</small></td>
          <td><button type="button" className="button secondary small-button" onClick={() => void reissue(credential)} disabled={issueMutation.isPending || !canReissue} title={!canReissue ? 'Não há projeto autorizado associado para emitir acesso.' : undefined}>Gerar novo token</button></td>
        </tr>;
      })}</tbody></table></div> : <div className="empty-state compact"><h3>Nenhuma credencial encontrada</h3><p>Ajuste os filtros ou emita a primeira credencial para este escopo.</p></div>}
      <div className="credential-pagination"><span>Página {credentialCursors.length}{credentialsQuery.data?.items.length ? ` · ${credentialsQuery.data.items.length} registro(s)` : ''}</span><div className="button-row"><button type="button" className="button secondary small-button" onClick={() => setCredentialCursors(values => values.slice(0, -1))} disabled={credentialCursors.length <= 1 || credentialsQuery.isFetching}>Anterior</button><button type="button" className="button secondary small-button" onClick={() => { if (credentialsQuery.data?.next) setCredentialCursors(values => [...values, credentialsQuery.data!.next!]); }} disabled={!credentialsQuery.data?.next || credentialsQuery.isFetching}>Próxima</button></div></div>
      {issued && <div className="issued-token"><div><strong>Nova credencial · {issued.email}</strong><small>ID {issued.id}{issued.projectName ? ` · ${issued.projectName}` : ` · ${issued.scope === 'agent' ? 'agente' : 'pessoa'}`}</small></div><label>Token — copie agora, ele só estará disponível nesta sessão<textarea readOnly value={issued.token} rows={3} onFocus={event => event.currentTarget.select()} /></label><div className="button-row"><button type="button" className="button secondary" onClick={() => void copyIssued()}>Copiar</button><button type="button" className="button ghost" onClick={() => setIssued(null)}>Limpar</button></div></div>}
    </section>
    <section className="panel-card wide-card archive-panel"><div className="section-heading"><div><p className="eyebrow">ARQUIVAMENTO REVERSÍVEL</p><h2>Arquivar projeto</h2></div><Badge tone="amber">Preserva histórico</Badge></div><p className="muted-text">O projeto sai da lista ativa, mas pode ser restaurado depois. O servidor verifica se ainda há tarefas ativas e valida sua permissão de administrador do projeto.</p><button type="button" className="button secondary" disabled={actionPending} onClick={onArchiveProject}>{actionPending ? 'Arquivando…' : 'Arquivar projeto'}</button></section>
    {canHardDelete && <section className="panel-card wide-card danger-zone" aria-labelledby="project-delete-title"><div className="section-heading"><div><p className="eyebrow">EXCLUSÃO PERMANENTE</p><h2 id="project-delete-title">Excluir projeto e dados relacionados</h2></div><Badge tone="red">Administrador do sistema</Badge></div><p className="muted-text">Remove permanentemente o projeto, repositórios exclusivos, funcionalidades, tarefas, histórico, documentos, eventos e dados de automação. Credenciais humanas compartilhadas com outros projetos são preservadas. Execuções ou automações ativas fazem o servidor recusar a exclusão sem remover dados.</p><button type="button" className="button danger-button" onClick={() => onRequestHardDeleteProject(project)}>Excluir projeto definitivamente</button></section>}
    <section className="panel-card wide-card"><div className="section-heading"><div><p className="eyebrow">REPOSITÓRIOS</p><h2>Vincular repositório Git</h2></div><span className="lock-mark">⌑</span></div><p className="muted-text">O vínculo identifica o repositório; as permissões continuam sendo controladas pelo projeto.</p><form className="admin-form-grid" onSubmit={bindRepository}><label>Repositório<select value={repositoryId} onChange={event => { const nextId = event.target.value; setRepositoryId(nextId); const fields = repositoryGitFields(project, nextId); setRemoteUrl(fields.remoteUrl); setRootCommit(fields.rootCommit); }} required><option value="">Selecione</option>{(project.repositories ?? []).map(repository => <option value={repository.id} key={repository.id}>{repository.name}</option>)}</select></label><label>URL Git canônica<input value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} required placeholder="https://github.com/org/repo.git" /></label><label>Commit raiz<input value={rootCommit} onChange={event => setRootCommit(event.target.value)} required minLength={40} maxLength={40} placeholder="40 caracteres hexadecimais" /><small className="git-root-help" role="note"><span>Para localizar o commit raiz, execute na pasta do repositório:</span><code>git rev-list --max-parents=0 HEAD</code><span>Copie o hash de 40 caracteres retornado.</span></small></label><button className="button secondary" disabled={busy || !repositoryId}>Salvar vínculo</button></form>
      <div className="repository-list">{(project.repositories ?? []).map(repository => <div className="resource-row static-row" key={repository.id}><span><strong>{repository.name}</strong><small>{repository.git?.canonicalRemoteUrl ?? repository.url}</small></span><Badge>{repository.git ? 'vinculado' : 'sem vínculo'}</Badge></div>)}</div>
    </section>
    </div></div>
    </div>
    <div id="admin-panel-export" role="tabpanel" aria-labelledby="admin-tab-export" hidden={activePanel !== 'export'} tabIndex={0}>
      <div className="project-transfer-grid">
        <ProjectExportPanel key={project._id + token} project={project} token={token} />
        <ProjectImportPanel key={token} token={token} canImport={canHardDelete} onImported={onChanged} />
      </div>
    </div>
  </div>;
}
