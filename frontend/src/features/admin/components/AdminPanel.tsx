import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminCredentials, operationId, request } from '../../../api';
import type { AdminCredential, Project } from '../../../api';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { notice } from '../../../components/ui/classes';
import { copyToClipboard } from '../../../lib/clipboard';
import { errorMessage } from '../../../lib/format';
import { makeToken } from '../../../lib/token';
import { ProjectExportPanel } from './ProjectExportPanel';
import { RepositoryGitBinding } from './RepositoryGitBinding';
import { ProjectImportPanel } from './ProjectImportPanel';
import { ProjectAreasManager } from '../../projects/components/ProjectAreasManager';

const adminPanelTabs = [
  { id: 'areas', label: 'Áreas do projeto' },
  { id: 'tools', label: 'Ferramentas administrativas' },
  { id: 'credentials', label: 'Credenciais' },
  { id: 'export', label: 'Exportar/Importar Projeto' },
  { id: 'danger', label: 'Zona de perigo' }
] as const;

const tabBase = 'h-10 cursor-pointer rounded-none border-b-[3px] border-b-transparent bg-transparent px-3 py-2 text-xs text-[#596579] shadow-none data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:shadow-none focus-visible:rounded-[4px] max-[600px]:px-2';
const tabDefault = `${tabBase} data-[state=active]:border-b-[#5969dc] data-[state=active]:text-[#4655be]`;
const tabDanger = `${tabBase} ml-auto data-[state=active]:border-b-[#c4545c] data-[state=active]:text-tone-red`;

const panelCard = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const wideCard = 'col-span-full max-[760px]:col-auto';
const headingTitle = 'mb-1 font-display leading-[normal] font-bold tracking-[-.02em] text-[#273245]';
const headingEyebrow = 'font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]';
const mutedText = 'text-[10px] leading-[1.6] text-muted-strong';

const fieldBase = 'rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[#344054]';
const emailInput = `h-10 w-full text-xs ${fieldBase}`;
const filterField = 'h-10 w-full min-w-0 rounded-[7px] border border-[#e1e5ed] bg-white px-[9px] py-[7px] text-xs text-[#344054]';
const filterSelect = `${filterField} disabled:bg-[#f5f6f9] disabled:text-[#9aa3b1]`;
const filterLabel = 'grid gap-[5px] text-[11px] font-[650] text-[#566275]';
const issueLabel = 'grid gap-[7px] text-[11px] font-semibold text-[#465368]';
const issueButton = 'justify-self-start max-[760px]:w-full';
const issueCard = 'min-w-0 rounded-ui-md border border-[#edf0f5] bg-white p-4 max-[760px]:p-3.5';
const issueCardHeading = 'mb-[9px] flex items-center justify-between gap-3.5';
const issueCardTitle = 'text-[12px] font-bold text-[#344156]';

const issuedBox = 'mt-4 grid gap-[11px] rounded-[9px] border border-[#d8e9e1] bg-[#f7fcf9] p-3';
const issuedMono = 'font-[family-name:ui-monospace,monospace] leading-[normal] font-normal';

const thCell = 'border-y border-[#edf0f5] bg-[#f8f9fc] px-3 py-2.5 text-[11px] font-bold tracking-[.05em] text-[#697589] uppercase';
const tdCell = 'border-b border-[#edf0f5] px-3 py-[9px] align-middle text-[12px] text-[#596576]';
const credentialMeta = 'mt-1 block text-[11px] text-[#6f7b8c]';

const actionButton = 'h-auto min-h-[34px] min-w-0 w-full justify-center px-2 text-[11px] leading-[1.2] font-bold whitespace-normal';
const actionSecondary = `${actionButton} border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`;
const actionDanger = `${actionButton} border-[#b3404a] bg-[#b3404a] text-white enabled:hover:border-[#922f38] enabled:hover:bg-[#922f38] disabled:cursor-not-allowed disabled:opacity-55`;
const actionSelect = 'col-span-full h-9 w-full min-w-0 rounded-[7px] border border-[#e1e5ed] bg-white px-[7px] py-[5px] text-[11px] text-[#344054] disabled:bg-[#f5f6f9] disabled:text-[#9aa3b1]';

const emptyState = 'grid justify-items-center gap-2 px-3.5 py-[30px] text-center';
const emptyTitle = 'font-display text-[13px] leading-[normal] font-bold text-[#394558]';
const emptyText = 'mb-2 text-[11px] text-[#8993a3]';

type AdminConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<void>;
};

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
  const [confirmation, setConfirmation] = useState<AdminConfirmation | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [agentEmail, setAgentEmail] = useState('');
  const [agentIssueConfirmed, setAgentIssueConfirmed] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [issued, setIssued] = useState<{ token: string; id: string; email: string; scope: string; projectName?: string } | null>(null);
  const [credentialEmail, setCredentialEmail] = useState('');
  const [credentialScope, setCredentialScope] = useState<'all' | 'human' | 'agent'>('all');
  const [credentialStatus, setCredentialStatus] = useState<'all' | 'active' | 'revoked'>('all');
  const [credentialProjectId, setCredentialProjectId] = useState(systemAdmin ? '' : project._id);
  const [credentialLimit, setCredentialLimit] = useState(25);
  const [credentialCursors, setCredentialCursors] = useState<Array<string | undefined>>([undefined]);
  const [grantSelectRevision, setGrantSelectRevision] = useState(0);
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

  async function confirmAction() {
    if (!confirmation || confirmationPending) return;
    setConfirmationPending(true);
    try {
      await confirmation.action();
      setConfirmation(null);
    } finally {
      setConfirmationPending(false);
    }
  }

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
    setConfirmation({
      title: 'Gerar novo token?',
      description: `Gerar um novo token para ${credential.email} (${scopeLabel})? O token anterior continuará ativo.`,
      confirmLabel: 'Gerar novo token',
      action: async () => {
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
    });
  }

  async function grantProject(credential: AdminCredential, projectId: string) {
    const target = projects.find(item => item._id === projectId);
    if (!target || credential.state !== 'active' || credential.scope !== 'human') return;
    setConfirmation({
      title: 'Conceder acesso ao projeto?',
      description: `Conceder a ${credential.email} acesso ao projeto ${target.name}? As credenciais desse e-mail também passarão a acessar o projeto.`,
      confirmLabel: 'Conceder acesso',
      action: async () => {
        try {
          const result = await grantMutation.mutateAsync({ action: 'grant_credential_project', operationId: operationId(), projectId: target._id, version: target.version, credentialId: credential.credentialId });
          notify(result.alreadyGranted ? `${credential.email} já tinha acesso a ${target.name}.` : `Acesso a ${target.name} adicionado à credencial existente de ${credential.email}.`, result.alreadyGranted ? 'info' : 'success');
          await queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
          await onChanged();
        } catch (error) { notify(errorMessage(error), 'error'); }
      }
    });
  }

  async function revokeCredential(credential: AdminCredential) {
    if (!systemAdmin || credential.state !== 'active') return;
    setConfirmation({
      title: 'Revogar credencial?',
      description: `Revogar a credencial ${credential.credentialId} de ${credential.email}? Somente esta credencial será revogada. Outras credenciais ativas do mesmo e-mail continuarão válidas.`,
      confirmLabel: 'Revogar credencial',
      action: async () => {
        try {
          await revokeMutation.mutateAsync({ action: 'revoke', operationId: operationId(), credentialId: credential.credentialId });
          notify('Credencial revogada. Outras credenciais ativas deste e-mail continuam válidas.', 'success');
          await queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
        } catch (error) { notify(errorMessage(error), 'error'); }
      }
    });
  }

  async function bindRepository(repositoryId: string, remoteUrl: string, rootCommit: string): Promise<boolean> {
    try {
      await bindingMutation.mutateAsync({ action: 'bind_repository_git', operationId: operationId(), projectId: project._id, version: project.version, repositoryId, canonicalRemoteUrl: remoteUrl, rootCommit });
      notify('Vínculo Git salvo.', 'success');
      await onChanged();
      return true;
    } catch (error) { notify(errorMessage(error), 'error'); return false; }
  }

  async function copyIssued() {
    if (!issued) return;
    if (await copyToClipboard(issued.token)) notify('Token copiado.', 'success');
    else notify('Não foi possível copiar automaticamente. Selecione e copie o token.', 'error');
  }

  return <><Tabs value={activePanel} onValueChange={value => setActivePanel(value as typeof activePanel)} className="grid min-w-0 gap-4">
    <TabsList aria-label="Administração do projeto" className="h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">
      {adminPanelTabs.map(tab => <TabsTrigger key={tab.id} value={tab.id} className={tab.id === 'danger' ? tabDanger : tabDefault}>{tab.label}</TabsTrigger>)}
    </TabsList>
      {activePanel === 'credentials' && issued && <div className={issuedBox}><div className="grid gap-[3px] text-[10px] text-[#354e43]"><strong>Nova credencial · {issued.email}</strong><small className={`${issuedMono} text-[9px] text-[#718279]`}>ID {issued.id}{issued.projectName ? ` · ${issued.projectName}` : ` · ${issued.scope === 'agent' ? 'agente' : 'pessoa'}`}</small></div><label className="grid gap-1.5 text-sm font-medium">Token — copie agora, ele só estará disponível nesta sessão<Textarea className={`w-full wrap-anywhere ${issuedMono} text-xs`} readOnly value={issued.token} rows={3} onFocus={event => event.currentTarget.select()} /></label><div className="flex items-center gap-2"><Button type="button" variant="outline" onClick={() => void copyIssued()}>Copiar</Button><Button type="button" variant="ghost" onClick={() => setIssued(null)}>Limpar</Button></div></div>}

    <TabsContent value="areas">
      <ProjectAreasManager token={token} project={project} onChanged={onChanged} notify={notify} />
    </TabsContent>
    <TabsContent value="tools">
      <RepositoryGitBinding project={project} busy={busy} onSave={bindRepository} />
    </TabsContent>
    <TabsContent value="credentials">
    <section className={`${panelCard} ${wideCard} mb-3.5 p-5 max-[760px]:p-[15px]`} aria-labelledby="credential-issuance-title">
      <div className="mb-3.5 flex items-center justify-between gap-3.5"><div><p className={headingEyebrow}>GERAÇÃO DE CREDENCIAIS</p><h2 className={`${headingTitle} text-[14px]`} id="credential-issuance-title">Emitir novo acesso</h2></div></div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3 max-[760px]:grid-cols-[minmax(0,1fr)]">
        {systemAdmin && <section className={issueCard} aria-labelledby="agent-credential-title">
          <div className={issueCardHeading}><div><h3 className={issueCardTitle} id="agent-credential-title">Credencial de agente</h3></div></div>
          <p className={`mb-3 ${mutedText}`}>Acesso global para automações. O token é criado no navegador e mostrado uma única vez.</p>
          <form className="grid gap-[13px]" autoComplete="off" onSubmit={event => { event.preventDefault(); void issue('agent'); }}>
            <label className={issueLabel} htmlFor="agent-credential-email">E-mail do agente<Input className={emailInput} id="agent-credential-email" type="email" value={agentEmail} onChange={event => setAgentEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
            <label className="flex items-start gap-2 text-xs leading-relaxed font-medium text-[#566275]"><Checkbox className="mt-0.5" checked={agentIssueConfirmed} onChange={event => setAgentIssueConfirmed(event.target.checked)} required />Confirmo a emissão de uma nova credencial de agente para este endereço.</label>
            <Button type="submit" className={issueButton} disabled={issueMutation.isPending}>{issueMutation.isPending ? 'Emitindo…' : 'Emitir credencial de agente'}</Button>
          </form>
        </section>}
        <section className={issueCard} aria-labelledby="project-credential-title">
          <div className={issueCardHeading}><div><h3 className={issueCardTitle} id="project-credential-title">Acesso individual ao projeto</h3></div></div>
          <p className={`mb-3 ${mutedText}`}>Emite um token para uma pessoa colaborar no projeto <strong>{project.name}</strong>.</p>
          <form className="grid gap-[13px]" autoComplete="off" onSubmit={event => { event.preventDefault(); setConfirmation({ title: 'Emitir acesso ao projeto?', description: `Emitir acesso ao projeto ${project.name} para ${memberEmail}?`, confirmLabel: 'Emitir acesso', action: () => issue('project') }); }}>
            <label className={issueLabel} htmlFor="project-credential-email">E-mail da pessoa<Input className={emailInput} id="project-credential-email" type="email" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
            <Button type="submit" variant="outline" className={issueButton} disabled={issueMutation.isPending}>{issueMutation.isPending ? 'Emitindo…' : 'Emitir acesso ao projeto'}</Button>
          </form>
        </section>
      </div>
    </section>
    <section className={`${panelCard} ${wideCard} min-w-0 p-5 max-[760px]:p-3`} aria-labelledby="credential-inventory-title">
      <div className="mb-[11px] flex items-center justify-between gap-3.5"><div><p className={headingEyebrow}>CREDENCIAIS EMITIDAS</p><h2 className={`${headingTitle} text-[14px]`} id="credential-inventory-title">Inventário por e-mail</h2></div><Button type="button" variant="outline" size="sm" onClick={() => void credentialsQuery.refetch()} disabled={credentialsQuery.isFetching}>Atualizar</Button></div>
      <p className="text-[12px] leading-[1.55] text-muted-strong">O acesso aos projetos é concedido por e-mail e compartilhado entre as credenciais ativas do mesmo endereço. Segredos antigos não podem ser recuperados; emitir outro não revoga os anteriores.</p>
      <div className="mt-[15px] mb-2.5 grid grid-cols-[minmax(180px,1.7fr)_repeat(4,minmax(115px,1fr))] gap-[9px] max-[760px]:grid-cols-[repeat(2,minmax(0,1fr))]" role="search" aria-label="Filtros de credenciais">
        <label className={`${filterLabel} max-[760px]:col-span-full`}>Buscar por e-mail<Input className={filterField} type="search" value={credentialEmail} onChange={event => { setCredentialEmail(event.target.value); setCredentialCursors([undefined]); }} placeholder="nome@empresa.com" /></label>
        <label className={filterLabel}>Projeto<Select value={credentialProjectId || 'all'} disabled={credentialScope === 'agent'} onValueChange={value => { setCredentialProjectId(value === 'all' ? '' : value); setCredentialCursors([undefined]); }}><SelectTrigger className={filterSelect} aria-label="Filtrar credenciais por projeto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all" disabled={!systemAdmin}>Todos os projetos</SelectItem>{projects.map(item => <SelectItem value={item._id} key={item._id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
        <label className={filterLabel}>Escopo<Select value={credentialScope} onValueChange={value => { setCredentialScope(value as typeof credentialScope); setCredentialCursors([undefined]); }}><SelectTrigger className={filterSelect} aria-label="Filtrar credenciais por escopo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="human">Pessoas</SelectItem><SelectItem value="agent" disabled={!systemAdmin}>Agentes</SelectItem></SelectContent></Select></label>
        <label className={filterLabel}>Estado<Select value={credentialStatus} onValueChange={value => { setCredentialStatus(value as typeof credentialStatus); setCredentialCursors([undefined]); }}><SelectTrigger className={filterSelect} aria-label="Filtrar credenciais por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="active">Ativas</SelectItem><SelectItem value="revoked">Revogadas</SelectItem></SelectContent></Select></label>
        <label className={filterLabel}>Por página<Select value={String(credentialLimit)} onValueChange={value => { setCredentialLimit(Number(value)); setCredentialCursors([undefined]); }}><SelectTrigger className={filterSelect} aria-label="Quantidade de credenciais por página"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select></label>
      </div>
      {credentialScope === 'agent' && <p className="mb-2.5 text-[11px] text-[#758093]" role="note">A consulta de agentes é global e exige credencial de administrador do sistema.</p>}
      {credentialsQuery.isPending ? <div className="px-[18px] py-7 text-center text-[11px] text-[#8792a2]" role="status">Carregando credenciais…</div> : credentialsQuery.isError ? <div className={notice.error} role="alert">{errorMessage(credentialsQuery.error)}</div> : credentialsQuery.data?.items.length ? <Table className="min-w-[900px] border-collapse text-left"><TableHeader><TableRow><TableHead className={thCell}>E-mail</TableHead><TableHead className={thCell}>ID da credencial</TableHead><TableHead className={thCell}>Escopo</TableHead><TableHead className={thCell}>Estado</TableHead><TableHead className={thCell}>Projeto / emissão</TableHead><TableHead className={thCell}>Ação</TableHead></TableRow></TableHeader><TableBody>{credentialsQuery.data.items.map(credential => {
        const targetProject = credential.projectId ? projects.find(item => item._id === credential.projectId) : undefined;
        const linkedProjectIds = new Set((credential.projects ?? []).map(item => item.projectId));
        const availableProjects = projects.filter(item => !linkedProjectIds.has(item._id));
        const canReissue = credential.scope === 'agent' || Boolean(targetProject);
        return <TableRow key={credential.credentialId}>
          <TableCell className={`${tdCell} whitespace-normal`}><strong className="text-[12px] font-[650] text-[#394558] wrap-anywhere">{credential.email}</strong></TableCell>
          <TableCell className={`${tdCell} whitespace-normal`}><code className="block max-w-[220px] text-[11px] text-[#657184] wrap-anywhere">{credential.credentialId}</code></TableCell>
          <TableCell className={tdCell}><span>{credential.scope === 'agent' ? 'Agente' : 'Pessoa'}</span>{credential.systemAdmin && <small className={credentialMeta}>Administrador do sistema</small>}{credential.role && <small className={credentialMeta}>{credential.role}</small>}</TableCell>
          <TableCell className={tdCell}><Badge tone={credential.state === 'active' ? 'green' : 'muted'} size="lg">{credential.state === 'active' ? 'Ativa' : 'Revogada'}</Badge></TableCell>
          <TableCell className={`${tdCell} whitespace-normal`}><span className="block max-w-[280px] wrap-anywhere">{credential.projects?.length ? credential.projects.map(item => `${item.projectName ?? 'Projeto'}${item.role ? ` · ${item.role}` : ''}`).join(', ') : credential.projectName ?? (credential.scope === 'agent' ? 'Global' : 'Sem projeto')}</span><small className={credentialMeta}>{credential.createdAt ? new Date(credential.createdAt).toLocaleString('pt-BR') : 'Data indisponível'}</small></TableCell>
          <TableCell className={tdCell}><div className="grid min-w-[210px] grid-cols-2 gap-1.5">{systemAdmin && credential.scope === 'human' && credential.state === 'active' && <Select key={`${credential.credentialId}-${grantSelectRevision}`} disabled={grantMutation.isPending || availableProjects.length === 0} onValueChange={projectId => { void grantProject(credential, projectId); setGrantSelectRevision(value => value + 1); }}><SelectTrigger className={actionSelect} aria-label={`Adicionar projeto à credencial de ${credential.email}`}><SelectValue placeholder={availableProjects.length ? 'Adicionar projeto…' : 'Todos já vinculados'} /></SelectTrigger><SelectContent>{availableProjects.map(item => <SelectItem value={item._id} key={item._id}>{item.name}</SelectItem>)}</SelectContent></Select>}<Button type="button" variant="outline" className={actionSecondary} onClick={() => void reissue(credential)} disabled={issueMutation.isPending || !canReissue} title={!canReissue ? 'Não há projeto autorizado associado para emitir acesso.' : undefined}>Gerar novo token</Button>{systemAdmin && credential.state === 'active' && <Button type="button" variant="destructive" className={actionDanger} onClick={() => void revokeCredential(credential)} disabled={revokeMutation.isPending} aria-label={`Revogar credencial ${credential.credentialId}`}>Revogar credencial</Button>}</div></TableCell>
        </TableRow>;
      })}</TableBody></Table> : <div className={emptyState}><h3 className={emptyTitle}>Nenhuma credencial encontrada</h3><p className={emptyText}>Ajuste os filtros ou emita a primeira credencial para este escopo.</p></div>}
      <div className="flex items-center justify-between gap-2.5 pt-3 text-[11px] text-[#687487] max-[760px]:flex-col max-[760px]:items-start"><span>Página {credentialCursors.length}{credentialsQuery.data?.items.length ? ` · ${credentialsQuery.data.items.length} registro(s)` : ''}</span><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setCredentialCursors(values => values.slice(0, -1))} disabled={credentialCursors.length <= 1 || credentialsQuery.isFetching}>Anterior</Button><Button type="button" variant="outline" size="sm" onClick={() => { if (credentialsQuery.data?.next) setCredentialCursors(values => [...values, credentialsQuery.data!.next!]); }} disabled={!credentialsQuery.data?.next || credentialsQuery.isFetching}>Próxima</Button></div></div>
    </section>
    </TabsContent>
    <TabsContent value="danger">
      <p className="mb-3 rounded-ui-md border border-[#f1cfd2] bg-[#fff7f7] px-4 py-3 text-ui-sm text-[#7a3a41]" role="note">Ações desta aba afetam o projeto inteiro. Arquivar é reversível; a exclusão permanente não pode ser desfeita e exige digitar o nome do projeto para confirmar.</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <section className={`rounded-xl border border-[#eadfbe] bg-[#fffefa] shadow-sm ${wideCard} p-5`}><div className="mb-3.5 flex items-start justify-between gap-3.5"><div><p className={headingEyebrow}>ARQUIVAMENTO REVERSÍVEL</p><h2 className={`${headingTitle} text-[13px]`}>Arquivar projeto</h2></div><Badge tone="amber">Preserva histórico</Badge></div><p className={mutedText}>O projeto sai da lista ativa, mas pode ser restaurado depois. O servidor verifica se ainda há tarefas ativas e valida sua permissão de administrador do projeto.</p><Button type="button" variant="outline" disabled={actionPending} onClick={onArchiveProject}>{actionPending ? 'Arquivando…' : 'Arquivar projeto'}</Button></section>
        {canHardDelete && <section className={`rounded-xl border-2 border-[#e7b3b8] bg-[#fffafa] shadow-sm ${wideCard} p-5`} aria-labelledby="project-delete-title"><div className="mb-3.5 flex items-start justify-between gap-3.5"><div><p className={headingEyebrow}>EXCLUSÃO PERMANENTE</p><h2 className={`${headingTitle} text-[13px]`} id="project-delete-title">Excluir projeto e dados relacionados</h2></div><Badge tone="red">Administrador do sistema</Badge></div><p className={`mb-[13px] ${mutedText}`}>Remove permanentemente o projeto, repositórios exclusivos, funcionalidades, tarefas, histórico, documentos, eventos e dados de automação. Credenciais humanas compartilhadas com outros projetos são preservadas. Execuções ou automações ativas fazem o servidor recusar a exclusão sem remover dados.</p><Button type="button" variant="destructive" onClick={() => onRequestHardDeleteProject(project)}>Excluir projeto definitivamente</Button></section>}
      </div>
    </TabsContent>
    <TabsContent value="export">
      <div className="grid grid-cols-2 items-stretch gap-5 max-[1100px]:grid-cols-[minmax(0,1fr)]">
        <ProjectExportPanel key={project._id + token} project={project} token={token} />
        <ProjectImportPanel key={token} token={token} canImport={canHardDelete} onImported={onChanged} />
      </div>
    </TabsContent>
  </Tabs><ConfirmDialog
    open={Boolean(confirmation)}
    title={confirmation?.title ?? 'Confirmar ação'}
    description={confirmation?.description ?? ''}
    confirmLabel={confirmation?.confirmLabel ?? 'Confirmar'}
    pending={confirmationPending}
    onOpenChange={open => { if (!open && !confirmationPending) setConfirmation(null); }}
    onConfirm={() => void confirmAction()}
  /></>;
}
