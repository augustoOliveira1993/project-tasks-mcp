import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, ApiRequestError, listProjects, operationId, query, request } from './api';
import type { AdminCapabilities, Project, ProjectSummary, Task } from './api';
import { ProjectPickerDialog } from './components/projects/ProjectPickerDialog';
import { Badge } from './components/ui/Badge';
import type { HardDeleteTarget } from './components/ui/HardDeleteDialog';
import { errorMessage, formatDate } from './lib/format';
import { catalogSectionForRoute, conversationIdFromSearch, isCatalogRoute, projectIdFromSearch, routeForCatalogSection, routeForTab, routeFromPath, routeUrl, tabForRoute, taskIdFromSearch, type AppRoute, type AppTab } from './route-state';

const AdminPanel = lazy(() => import('./components/admin/AdminPanel').then(module => ({ default: module.AdminPanel })));
const ProjectsPage = lazy(() => import('./components/projects/ProjectsPage').then(module => ({ default: module.ProjectsPage })));
const ProjectSummaryDialog = lazy(() => import('./components/projects/ProjectSummaryDialog').then(module => ({ default: module.ProjectSummaryDialog })));
const TaskStatusDialog = lazy(() => import('./components/tasks/TaskStatusDialog').then(module => ({ default: module.TaskStatusDialog })));
const TaskDetailsDialog = lazy(() => import('./components/tasks/TaskDetailsDialog').then(module => ({ default: module.TaskDetailsDialog })));
const HardDeleteDialog = lazy(() => import('./components/ui/HardDeleteDialog').then(module => ({ default: module.HardDeleteDialog })));
const TaskWorkspace = lazy(() => import('./features/tasks/TaskWorkspace').then(module => ({ default: module.TaskWorkspace })));
const TransferTaskDialog = lazy(() => import('./features/tasks/TransferTaskDialog').then(module => ({ default: module.TransferTaskDialog })));
const ConversationPanel = lazy(() => import('./components/conversations/ConversationPanel').then(module => ({ default: module.ConversationPanel })));
const HelpToolsPanel = lazy(() => import('./components/help/HelpToolsPanel').then(module => ({ default: module.HelpToolsPanel })));
const CatalogsPage = lazy(() => import('./features/catalogs/CatalogsPage').then(module => ({ default: module.CatalogsPage })));

const tokenKey = 'project-tasks.human-token';

function App() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => { try { return localStorage.getItem(tokenKey) ?? ''; } catch { return ''; } });
  const [nonce, setNonce] = useState(() => token ? 'saved-session' : '');
  const [activeProjectId, setActiveProjectId] = useState(() => projectIdFromSearch(window.location.search));
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));
  const activeTab = tabForRoute(activeRoute);
  const catalogScreen = isCatalogRoute(activeRoute);
  const [notice, setNotice] = useState<{ message: string; kind: string } | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [requestedTaskId, setRequestedTaskId] = useState(() => taskIdFromSearch(window.location.search));
  const [transferTask, setTransferTask] = useState<Task | null>(null);
  const [conversationToOpen, setConversationToOpen] = useState(() => conversationIdFromSearch(window.location.search));
  const [statusTask, setStatusTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [copiedProjectId, setCopiedProjectId] = useState(false);
  const [allProjectsSearch, setAllProjectsSearch] = useState('');
  const [projectPage, setProjectPage] = useState(1);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<HardDeleteTarget | null>(null);
  const [hardDeleteBusy, setHardDeleteBusy] = useState(false);
  const [hardDeleteError, setHardDeleteError] = useState('');
  const adminMutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => request(token, path, { body })
  });

  function navigateToRoute(route: AppRoute, projectId = activeProjectId, preserveQuery = true) {
    const params = new URLSearchParams(window.location.search);
    if (route !== 'tasks') params.delete('taskId');
    const nextUrl = routeUrl(route, params.toString(), projectId, preserveQuery);
    const currentUrl = window.location.pathname + window.location.search;
    if (nextUrl !== currentUrl) window.history.pushState({ route }, '', nextUrl);
    setActiveRoute(route);
    if (route !== 'tasks') {
      setRequestedTaskId('');
      setSelectedTask(null);
    }
    if (projectId !== activeProjectId) setRequestedTaskId('');
    if (projectId !== activeProjectId) setActiveProjectId(projectId);
  }

  function setActiveTab(tab: AppTab) {
    if (tab === 'chat') setConversationToOpen(conversationIdFromSearch(window.location.search));
    navigateToRoute(routeForTab(tab));
  }

  function selectProject(projectId: string) {
    const preserveQuery = projectId === activeProjectId;
    navigateToRoute('tasks', projectId, preserveQuery);
  }

  function openConversation(conversationId: string) {
    const params = new URLSearchParams(window.location.search);
    params.delete('taskId');
    params.set('conversationId', conversationId);
    const nextUrl = routeUrl('conversations', params.toString(), activeProjectId);
    const currentUrl = window.location.pathname + window.location.search;
    if (nextUrl !== currentUrl) window.history.pushState({ route: 'conversations' }, '', nextUrl);
    setActiveRoute('conversations');
    setConversationToOpen(conversationId);
    setSelectedTask(null);
    setRequestedTaskId('');
  }

  function openQuestionChat(conversationId: string | null) {
    if (conversationId) {
      openConversation(conversationId);
      return;
    }
    setConversationToOpen('');
    navigateToRoute('conversations', activeProjectId, false);
  }

  function openTaskFromConversation(taskId: string) {
    const task = tasks.find(item => item._id === taskId);
    if (!task) {
      notify('A tarefa vinculada não está disponível na listagem deste projeto.', 'error');
      return;
    }
    const params = new URLSearchParams();
    params.set('taskId', taskId);
    const nextUrl = routeUrl('tasks', params.toString(), activeProjectId);
    const currentUrl = window.location.pathname + window.location.search;
    if (nextUrl !== currentUrl) window.history.pushState({ route: 'tasks' }, '', nextUrl);
    setActiveRoute('tasks');
    setRequestedTaskId(taskId);
    setSelectedTask(task);
  }

  function closeTaskDetails() {
    setSelectedTask(null);
    setRequestedTaskId('');
    const params = new URLSearchParams(window.location.search);
    params.delete('taskId');
    const nextUrl = routeUrl(activeRoute, params.toString(), activeProjectId);
    window.history.replaceState({ route: activeRoute }, '', nextUrl);
  }

  function rememberConversation(conversationId: string) {
    const params = new URLSearchParams(window.location.search);
    if (activeProjectId) params.set('projectId', activeProjectId);
    if (conversationId) params.set('conversationId', conversationId);
    else params.delete('conversationId');
    const nextUrl = routeUrl('conversations', params.toString(), activeProjectId);
    window.history.replaceState({ route: 'conversations' }, '', nextUrl);
    setConversationToOpen('');
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeProjectId) params.set('projectId', activeProjectId);
    else params.delete('projectId');
    const query = params.toString();
    const nextUrl = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
    const currentUrl = window.location.pathname + window.location.search + window.location.hash;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl);
  }, [activeProjectId]);

  useEffect(() => {
    const restoreRouteFromUrl = () => {
      setActiveRoute(routeFromPath(window.location.pathname));
      setActiveProjectId(projectIdFromSearch(window.location.search));
      setConversationToOpen(conversationIdFromSearch(window.location.search));
      setRequestedTaskId(taskIdFromSearch(window.location.search));
      setSelectedTask(null);
    };
    window.addEventListener('popstate', restoreRouteFromUrl);
    return () => window.removeEventListener('popstate', restoreRouteFromUrl);
  }, []);

  function notify(message: string, kind = 'info') {
    setNotice({ message, kind });
    window.setTimeout(() => setNotice(current => current?.message === message ? null : current), 5000);
  }
  const projectsQuery = useQuery({
    queryKey: ['admin-projects', nonce],
    enabled: Boolean(token && nonce),
    queryFn: () => listProjects(token)
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['admin-capabilities', nonce],
    enabled: Boolean(token && nonce),
    queryFn: () => request<AdminCapabilities>(token, '/admin/capabilities'),
    retry: false
  });
  const canHardDelete = capabilitiesQuery.data?.scope === 'human' && capabilitiesQuery.data.systemAdmin === true && capabilitiesQuery.data.canHardDelete === true;
  const projects = projectsQuery.data ?? [];
  useEffect(() => {
    if (projects.length && !projects.some(item => item.project._id === activeProjectId)) setActiveProjectId(projects[0].project._id);
  }, [projects, activeProjectId]);
  const currentSummary = projects.find(item => item.project._id === activeProjectId);
  const project = currentSummary?.project;
  const tasksQuery = useQuery({
    queryKey: ['project-tasks', nonce, activeProjectId],
    enabled: Boolean(token && nonce && activeProjectId),
    queryFn: () => allRecords<Task>(token, { kind: 'task', projectId: activeProjectId, archived: false })
  });
  const tasks = tasksQuery.data ?? [];
  useEffect(() => {
    if (activeRoute !== 'tasks' || !requestedTaskId || tasksQuery.isPending) return;
    const task = tasks.find(item => item._id === requestedTaskId);
    if (task) setSelectedTask(current => current?._id === task._id ? current : task);
    else {
      setRequestedTaskId('');
      const params = new URLSearchParams(window.location.search);
      params.delete('taskId');
      window.history.replaceState(window.history.state, '', routeUrl('tasks', params.toString(), activeProjectId));
      notify('A tarefa deste link não está disponível na listagem do projeto.', 'error');
    }
  }, [activeRoute, requestedTaskId, tasks, tasksQuery.isPending]);
  const noveltiesQuery = useQuery({
    queryKey: ['project-novelties', nonce, activeProjectId],
    enabled: Boolean(token && nonce && activeProjectId && activeTab === 'activity'),
    queryFn: () => query<{ items: Array<{ _id?: string; kind?: string; summary?: string; action?: string; author?: string; at?: string }> }>(token, 'get_project_novelties', { projectId: activeProjectId, limit: 40 })
  });
  const projectSummaryQuery = useQuery({
    queryKey: ['project-area-summary', nonce, activeProjectId],
    enabled: Boolean(token && nonce && activeProjectId && summaryOpen),
    queryFn: () => query<{ markdown: string; taskCount: number }>(token, 'get_project_area_summary', { projectId: activeProjectId })
  });
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('token') ?? '').trim();
    if (!value) return;
    setSaving(true);
    try {
      const data = await listProjects(value);
      try { localStorage.setItem(tokenKey, value); } catch { /* session remains in memory */ }
      const sessionId = operationId();
      setToken(value);
      setNonce(sessionId);
      const requestedProjectId = projectIdFromSearch(window.location.search);
      setActiveProjectId(data.find(item => item.project._id === requestedProjectId)?.project._id ?? data[0]?.project._id ?? '');
      queryClient.setQueryData(['admin-projects', sessionId], data);
      notify('Acesso autorizado.', 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setSaving(false); }
  }
  function signOut() {
    try { localStorage.removeItem(tokenKey); } catch { /* ignore unavailable storage */ }
    setToken(''); setNonce(''); setActiveProjectId(''); setSelectedTask(null); setTransferTask(null); setStatusTask(null);
    queryClient.clear();
  }
  async function onTaskTransferred(result: { task: Task }, targetProjectId: string) {
    setSelectedTask(result.task);
    setTransferTask(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, targetProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['task-context', nonce, activeProjectId, result.task._id] }),
      queryClient.invalidateQueries({ queryKey: ['task-context', nonce, targetProjectId, result.task._id] }),
      queryClient.invalidateQueries({ queryKey: ['task-diffs', nonce, activeProjectId, result.task._id] }),
      queryClient.invalidateQueries({ queryKey: ['task-diffs', nonce, targetProjectId, result.task._id] }),
      queryClient.invalidateQueries({ queryKey: ['task-markdowns', nonce, activeProjectId, result.task._id] }),
      queryClient.invalidateQueries({ queryKey: ['task-markdowns', nonce, targetProjectId, result.task._id] }),
      queryClient.invalidateQueries({ queryKey: ['project-sync-report', nonce, activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['project-sync-report', nonce, targetProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] })
    ]);
    if (targetProjectId !== activeProjectId) navigateToRoute('tasks', targetProjectId, false);
    notify('Tarefa transferida. O projeto e os dados exibidos foram atualizados.', 'success');
  }
  async function toggleChecked(task: Task) {
    try {
      await adminMutation.mutateAsync({ path: '/admin/tasks/check', body: { operationId: operationId(), projectId: activeProjectId, taskId: task._id, version: task.version, checked: !task.checked } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] }),
        queryClient.invalidateQueries({ queryKey: ['task-context', nonce, activeProjectId, task._id] })
      ]);
      notify(task.checked ? 'Conferência removida.' : 'Tarefa conferida.', 'success');
    } catch (error) {
      notify(errorMessage(error) + ' Atualizando os dados da tarefa…', 'error');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] }),
        queryClient.invalidateQueries({ queryKey: ['task-context', nonce, activeProjectId, task._id] })
      ]);
    }
  }
  async function updateStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusTask) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await adminMutation.mutateAsync({ path: '/admin/tasks/status', body: { projectId: activeProjectId, taskId: statusTask._id, status: String(form.get('status')), reason: String(form.get('reason')).trim() } });
      setStatusTask(null);
      await queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] });
      notify('Status atualizado.', 'success');
    } catch (error) { notify(errorMessage(error), 'error'); await queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] }); }
    finally { setSaving(false); }
  }
  async function approveSelected(taskIds: string[], reason: string): Promise<boolean> {
    if (!taskIds.length) return false;
    setSaving(true);
    try {
      const result = await adminMutation.mutateAsync({ path: '/admin/tasks/approve', body: { projectId: activeProjectId, taskIds, ...(reason.trim() ? { reason: reason.trim() } : {}) } }) as { tasks: Task[]; operationId: string };
      await queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] });
      notify(result.tasks.length + ' tarefa(s) aprovada(s).', 'success');
      return true;
    } catch (error) { notify(errorMessage(error), 'error'); return false; }
    finally { setSaving(false); }
  }
  async function setTasksChecked(taskIds: string[], checked: boolean): Promise<string[]> {
    if (!taskIds.length) return [];
    const taskById = new Map(tasks.map(task => [task._id, task]));
    const selectedTasks = taskIds.map(id => taskById.get(id)).filter((task): task is Task => Boolean(task));
    const updatedIds: string[] = [];
    let firstFailure: unknown;
    setSaving(true);
    try {
      for (let offset = 0; offset < selectedTasks.length; offset += 8) {
        const batch = selectedTasks.slice(offset, offset + 8);
        const results = await Promise.allSettled(batch.map(task => request(token, '/admin/tasks/check', { body: { operationId: operationId(), projectId: activeProjectId, taskId: task._id, version: task.version, checked } })));
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') updatedIds.push(batch[index]._id);
          else firstFailure ??= result.reason;
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] }),
        ...taskIds.map(taskId => queryClient.invalidateQueries({ queryKey: ['task-context', nonce, activeProjectId, taskId] }))
      ]);
      const failedCount = taskIds.length - updatedIds.length;
      if (!failedCount) notify(checked ? `${updatedIds.length} tarefa(s) conferida(s).` : `Conferência removida de ${updatedIds.length} tarefa(s).`, 'success');
      else notify(`${updatedIds.length} de ${taskIds.length} tarefa(s) atualizadas; ${failedCount} falharam.${firstFailure ? ' ' + errorMessage(firstFailure) : ''}`, 'error');
      return updatedIds;
    } catch (error) {
      notify(errorMessage(error), 'error');
      return updatedIds;
    } finally { setSaving(false); }
  }
  async function copyProjectId() {
    if (!project) return;
    try {
      await navigator.clipboard.writeText(project._id);
      setCopiedProjectId(true); window.setTimeout(() => setCopiedProjectId(false), 1500);
    } catch { notify('Não foi possível copiar o ID do projeto.', 'error'); }
  }
  function requestProjectHardDelete(targetProject: Project) {
    setHardDeleteError('');
    setHardDeleteTarget({ kind: 'project', id: targetProject._id, name: targetProject.name });
  }
  function requestTaskHardDelete(task: Task) {
    setHardDeleteError('');
    setHardDeleteTarget({ kind: 'task', id: task._id, projectId: activeProjectId, projectName: project?.name, name: task.name, status: task.status, responsible: task.responsible });
  }
  async function confirmHardDelete() {
    const target = hardDeleteTarget;
    if (!target || !canHardDelete || hardDeleteBusy) return;
    setHardDeleteBusy(true);
    setHardDeleteError('');
    try {
      const path = target.kind === 'project'
        ? '/admin/projects/' + encodeURIComponent(target.id)
        : '/admin/projects/' + encodeURIComponent(target.projectId ?? activeProjectId) + '/tasks/' + encodeURIComponent(target.id);
      await request(token, path, { method: 'DELETE', body: { operationId: operationId() } });
      if (target.kind === 'project') {
        const remainingProjects = (queryClient.getQueryData<ProjectSummary[]>(['admin-projects', nonce]) ?? projects).filter(item => item.project._id !== target.id);
        queryClient.setQueryData<ProjectSummary[]>(['admin-projects', nonce], remainingProjects);
        queryClient.removeQueries({ queryKey: ['project-tasks', nonce, target.id] });
        queryClient.removeQueries({ queryKey: ['project-novelties', nonce, target.id] });
        queryClient.removeQueries({ queryKey: ['project-area-summary', nonce, target.id] });
        setActiveProjectId(remainingProjects[0]?.project._id ?? '');
        setSelectedTask(null);
        setStatusTask(null);
        setSummaryOpen(false);
        notify('Projeto e dados relacionados excluídos definitivamente.', 'success');
      } else {
        const projectId = target.projectId ?? activeProjectId;
        queryClient.setQueryData<Task[]>(['project-tasks', nonce, projectId], current => current?.filter(task => task._id !== target.id) ?? []);
        queryClient.removeQueries({ queryKey: ['task-context', nonce, projectId, target.id] });
        queryClient.removeQueries({ queryKey: ['task-diffs', nonce, projectId, target.id] });
        queryClient.removeQueries({ queryKey: ['task-markdowns', nonce, projectId, target.id] });
        if (selectedTask?._id === target.id) setSelectedTask(null);
        if (statusTask?._id === target.id) setStatusTask(null);
        notify('Tarefa excluída definitivamente.', 'success');
      }
      setHardDeleteTarget(null);
    } catch (error) {
      const status = error instanceof ApiRequestError ? error.status : undefined;
      if (status === 403) {
        setHardDeleteError('O servidor negou a exclusão porque esta credencial não tem permissão de administrador do sistema. Nenhum dado foi removido.');
        queryClient.setQueryData<AdminCapabilities>(['admin-capabilities', nonce], { scope: 'human', systemAdmin: false, canHardDelete: false });
      } else if (status === 409) {
        setHardDeleteError('O servidor recusou a exclusão por haver uma execução ou automação ativa. Nenhum dado foi removido.');
      } else setHardDeleteError(errorMessage(error));
    } finally { setHardDeleteBusy(false); }
  }
  async function archiveProject() {
    if (!project || saving || !window.confirm(`Arquivar o projeto “${project.name}”? Ele sairá da lista ativa, mas poderá ser restaurado depois. O servidor também pode recusar se houver tarefas ativas.`)) return;
    setSaving(true);
    try {
      await request(token, '/admin/archive', { method: 'POST', body: { operationId: operationId(), projectId: project._id, kind: 'project', id: project._id, version: project.version } });
      const remainingProjects = (queryClient.getQueryData<ProjectSummary[]>(['admin-projects', nonce]) ?? projects).filter(item => item.project._id !== project._id);
      queryClient.setQueryData<ProjectSummary[]>(['admin-projects', nonce], remainingProjects);
      setActiveProjectId(remainingProjects[0]?.project._id ?? '');
      setSelectedTask(null);
      setStatusTask(null);
      setSummaryOpen(false);
      notify('Projeto arquivado. O histórico continua disponível para restauração.', 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setSaving(false); }
  }
  async function archiveTask(task: Task) {
    if (saving || !window.confirm(`Arquivar “${task.name}”? A tarefa sairá da lista ativa, mas seu histórico será preservado e poderá ser restaurado.`)) return;
    setSaving(true);
    try {
      await request(token, '/admin/archive', { method: 'POST', body: { operationId: operationId(), projectId: activeProjectId, kind: 'task', id: task._id, version: task.version } });
      queryClient.setQueryData<Task[]>(['project-tasks', nonce, activeProjectId], current => current?.filter(item => item._id !== task._id) ?? []);
      if (selectedTask?._id === task._id) setSelectedTask(null);
      if (statusTask?._id === task._id) setStatusTask(null);
      notify('Tarefa arquivada. O histórico foi preservado.', 'success');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setSaving(false); }
  }
  const filteredProjects = projects.filter(item => {
    const matches = item.project.name.toLocaleLowerCase('pt-BR').includes(allProjectsSearch.toLocaleLowerCase('pt-BR'));
    return matches;
  });
  const projectPages = Math.max(1, Math.ceil(filteredProjects.length / 8));
  const currentProjectPage = filteredProjects.slice((projectPage - 1) * 8, projectPage * 8);

  if (!token || !nonce) return <main className="auth-page"><div className="auth-brand"><span className="brand-mark">PT</span><span>Project Tasks</span></div><section className="auth-card"><p className="eyebrow">PAINEL DE OPERAÇÃO</p><h1>Acesse seu workspace</h1><p className="muted-text">Entre com seu token humano para consultar projetos e tarefas.</p><form className="stack-form" onSubmit={signIn}><label>Token humano<input name="token" type="password" autoComplete="current-password" required autoFocus placeholder="Cole o token de administrador" /></label><button className="button primary full-button" disabled={saving}>{saving ? 'Validando…' : 'Entrar'}</button></form><p className="auth-footnote">As ações respeitam as permissões configuradas no servidor.</p></section>{notice && <div className={'toast toast-' + notice.kind}>{notice.message}</div>}</main>;

  return <div className="app-shell min-h-screen bg-canvas text-ink">
    <aside className="sidebar">
      <a className="brand" href={routeUrl('tasks', window.location.search, activeProjectId)} onClick={event => { event.preventDefault(); navigateToRoute('tasks'); }}><span className="brand-mark">PT</span><span><strong>Project Tasks</strong><small>Workspace</small></span></a>
      <div className="sidebar-label">VISÃO DO PROJETO</div>
      <div className="project-picker">
        <span className="project-picker-label">Projeto ativo</span>
        <div className="project-picker-control">
          <button id="active-project" type="button" className="project-picker-trigger" aria-haspopup="dialog" aria-controls="projects-dialog" disabled={projectsQuery.isPending || projects.length === 0} onClick={() => { setAllProjectsSearch(''); setProjectPage(1); (document.getElementById('projects-dialog') as HTMLDialogElement | null)?.showModal(); }}>
            <span className="project-avatar">{project?.name.slice(0, 1).toLocaleUpperCase('pt-BR') ?? '⌘'}</span>
            <span className="project-picker-copy"><strong>{project?.name ?? (projectsQuery.isPending ? 'Carregando projetos…' : 'Nenhum projeto')}</strong><small>{project ? project.visibility === 'private' ? 'Projeto privado' : 'Projeto compartilhado' : 'Selecione um workspace'}</small></span>
            <span className="project-picker-chevron" aria-hidden="true">⌄</span>
          </button>
          {project && <button className="small-icon project-copy-button" onClick={() => void copyProjectId()} title="Copiar ID do projeto" aria-label="Copiar ID do projeto">{copiedProjectId ? '✓' : '⧉'}</button>}
        </div>
      </div>
      <nav className="primary-nav" aria-label="Navegação principal">
        <button className={activeRoute === 'tasks' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('tasks')}><span>▦</span> Tarefas <b>{tasks.length}</b></button>
        <button className={activeRoute === 'conversations' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('conversations')}><span>✉</span> Conversas</button>
        <button className={activeRoute === 'activity' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('activity')}><span>◷</span> Novidades</button>
        <div className="sidebar-label nav-section-label">WORKSPACE</div>
        <button className={activeRoute === 'projects' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('projects')}><span>▣</span> Projetos <b>{projects.length}</b></button>
        <button className={catalogScreen ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('catalogs')}><span>＋</span> Cadastros</button>
        <button className={activeRoute === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('settings')}><span>⚙</span> Administração</button>
        <button className={activeRoute === 'help' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('help')}><span>ⓘ</span> Ajuda</button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer"><span className="online-dot" /> Conectado ao MCP <button className="small-icon" onClick={signOut} title="Sair">↪</button></div>
    </aside>
    <main className="main-area min-h-screen">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{activeRoute === 'projects' ? 'Projetos' : catalogScreen ? `Cadastros · ${{overview:'Visão geral',projects:'Projetos',features:'Features',tasks:'Tarefas',areas:'Áreas'}[catalogSectionForRoute(activeRoute)]}` : project?.name ?? 'Carregando projeto'}</strong></div><div className="topbar-actions"><span className="connection-pill"><span className="online-dot" /> Serviço ativo</span><button className="avatar-button" onClick={signOut} title="Sair">AU</button></div></header>
      <div className="content-wrap">
        {projectsQuery.isError && <div className="notice error">{errorMessage(projectsQuery.error)}</div>}
        <Suspense fallback={<div className="loading">Carregando tela…</div>}>
        {activeRoute === 'projects' && <ProjectsPage projects={currentProjectPage} isPending={projectsQuery.isPending} activeProjectId={activeProjectId} search={allProjectsSearch} currentPage={projectPage} pages={projectPages} total={filteredProjects.length} onSearchChange={value => { setAllProjectsSearch(value); setProjectPage(1); }} onPageChange={setProjectPage} onSelect={selectProject} />}
        {activeRoute !== 'projects' && !catalogScreen && !projects.length && !projectsQuery.isPending && <div className="empty-state"><h2>Nenhum projeto disponível</h2><p>Esta credencial ainda não possui projetos acessíveis.</p><button className="button secondary" onClick={() => navigateToRoute('projects')}>Abrir projetos</button></div>}
        {catalogScreen && <CatalogsPage section={catalogSectionForRoute(activeRoute)} token={token} nonce={nonce} projects={projects.map(item => item.project)} project={project} tasks={tasks} notify={notify} onProjectCreated={async created => { await projectsQuery.refetch(); navigateToRoute(routeForCatalogSection('projects'), created._id, false); }} onSelectProject={projectId => navigateToRoute(activeRoute, projectId, false)} onNavigateSection={section => navigateToRoute(routeForCatalogSection(section))} onChanged={() => { void projectsQuery.refetch(); void tasksQuery.refetch(); }} />}
        {activeRoute !== 'projects' && !catalogScreen && project && <>
          <div className="page-heading"><div><p className="eyebrow">{activeTab === 'tasks' ? 'ACOMPANHAMENTO' : activeTab === 'chat' ? 'COLABORAÇÃO' : activeTab === 'activity' ? 'ATIVIDADE' : activeTab === 'admin' ? 'CONFIGURAÇÃO' : 'DOCUMENTAÇÃO'}</p><h1>{activeTab === 'tasks' ? 'Tarefas do projeto' : activeTab === 'chat' ? 'Conversas com IA' : activeTab === 'activity' ? 'Novidades do projeto' : activeTab === 'admin' ? 'Administração' : 'Ajuda do Project Tasks'}</h1><p className="muted-text">{activeTab === 'tasks' ? 'Acompanhe execução, revisão e conclusão do trabalho.' : activeTab === 'chat' ? 'Esclareça pedidos com a IA e autorize a execução quando a proposta estiver pronta.' : activeTab === 'activity' ? 'Acompanhe as mudanças compartilhadas neste projeto.' : activeTab === 'admin' ? 'Credenciais e configurações restritas do workspace.' : 'Referência rápida para os servidores e ferramentas MCP.'}</p></div>{activeTab === 'tasks' && <div className="button-row"><button className="button secondary" onClick={() => setSummaryOpen(true)}>Resumo</button><button className="button secondary" onClick={() => { void projectsQuery.refetch(); void tasksQuery.refetch(); }}>↻ Atualizar</button></div>}</div>
          {activeTab === 'tasks' && <TaskWorkspace key={activeProjectId} token={token} nonce={nonce} projectId={activeProjectId} repositories={project?.repositories ?? []} projectAreas={project?.areas ?? ['backend', 'frontend', 'outro']} tasks={tasks} isPending={tasksQuery.isPending} isError={tasksQuery.isError} error={tasksQuery.error} saving={saving} canHardDelete={canHardDelete} onRefresh={() => { void tasksQuery.refetch(); }} onOpenTask={setSelectedTask} onOpenQuestionChat={openQuestionChat} onChangeStatus={setStatusTask} onToggleChecked={toggleChecked} onRequestHardDeleteTask={requestTaskHardDelete} onArchiveTask={archiveTask} onApproveSelected={approveSelected} onSetTasksChecked={setTasksChecked} />}
          {activeTab === 'chat' && <ConversationPanel token={token} nonce={nonce} projectId={activeProjectId} tasks={tasks} requestedConversationId={conversationToOpen || undefined} onConversationSelected={rememberConversation} onOpenTask={openTaskFromConversation} onOpenAdmin={() => setActiveTab('admin')} />}
          {activeTab === 'activity' && <section className="panel-card"><div className="section-heading"><div><h2>Eventos recentes</h2><p className="muted-text">Atualizações de tarefas e colaboração</p></div><button className="button secondary" onClick={() => void noveltiesQuery.refetch()}>↻ Atualizar</button></div>{noveltiesQuery.isPending ? <div className="loading">Carregando eventos…</div> : noveltiesQuery.isError ? <div className="notice error">{errorMessage(noveltiesQuery.error)}</div> : noveltiesQuery.data?.items?.length ? <div className="timeline">{noveltiesQuery.data.items.map((item, index) => <article className="timeline-item" key={item._id ?? index}><span className="timeline-dot" /><div><strong>{item.summary || item.kind || item.action || 'Atualização do projeto'}</strong><small>{item.author || 'Autor não identificado'} · {formatDate(item.at)}</small></div><Badge>{item.kind || item.action || 'evento'}</Badge></article>)}</div> : <div className="empty-state compact"><h3>Sem novidades recentes</h3><p>Eventos de colaboração aparecerão aqui.</p></div>}</section>}
          {activeTab === 'admin' && <AdminPanel token={token} project={project} projects={projects.map(item => item.project)} onChanged={() => { void projectsQuery.refetch(); }} notify={notify} canHardDelete={canHardDelete} actionPending={saving} onRequestHardDeleteProject={requestProjectHardDelete} onArchiveProject={() => { void archiveProject(); }} />}
          {activeTab === 'help' && <HelpToolsPanel search={toolSearch} onSearchChange={setToolSearch} />}
        </>}
        </Suspense>
      </div>
      <footer className="app-footer"><span>Project Tasks MCP</span><span>{project?.name ?? ''}</span></footer>
    </main>
    <Suspense fallback={null}>
    {selectedTask && project && <TaskDetailsDialog key={`${project._id}:${selectedTask._id}`} token={token} nonce={nonce} projectId={project._id} task={selectedTask} checking={adminMutation.isPending || saving} onToggleChecked={toggleChecked} onOpenConversation={openConversation} onRequestTransfer={setTransferTask} close={closeTaskDetails} />}
    {transferTask && project && <TransferTaskDialog key={`${project._id}:${transferTask._id}`} token={token} nonce={nonce} projectId={project._id} task={transferTask} projects={projects.map(item => item.project)} close={() => setTransferTask(null)} onTransferred={onTaskTransferred} />}
    {statusTask && <TaskStatusDialog task={statusTask} saving={saving} onClose={() => setStatusTask(null)} onSubmit={updateStatus} />}
    <ProjectPickerDialog projects={currentProjectPage} activeProjectId={activeProjectId} search={allProjectsSearch} currentPage={projectPage} pages={projectPages} total={filteredProjects.length} onSearchChange={value => { setAllProjectsSearch(value); setProjectPage(1); }} onPageChange={setProjectPage} onSelect={id => { selectProject(id); (document.getElementById('projects-dialog') as HTMLDialogElement | null)?.close(); }} />
    {summaryOpen && <ProjectSummaryDialog name={project?.name} taskCount={projectSummaryQuery.data?.taskCount ?? tasks.length} markdown={projectSummaryQuery.data?.markdown} error={projectSummaryQuery.error} isPending={projectSummaryQuery.isPending} isError={projectSummaryQuery.isError} onClose={() => setSummaryOpen(false)} />}
    {hardDeleteTarget && <HardDeleteDialog target={hardDeleteTarget} busy={hardDeleteBusy} error={hardDeleteError} onClose={() => { setHardDeleteTarget(null); setHardDeleteError(''); }} onConfirm={() => void confirmHardDelete()} />}
    </Suspense>
    {notice && <div className={'toast toast-' + notice.kind} role="status">{notice.message}<button onClick={() => setNotice(null)} aria-label="Dispensar">×</button></div>}
  </div>;
}

export default App;
