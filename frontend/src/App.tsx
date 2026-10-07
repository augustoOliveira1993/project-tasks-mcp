import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, ApiRequestError, listProjects, operationId, query, request } from './api';
import type { AdminCapabilities, Project, ProjectSummary, Task } from './api';
import { ProjectPickerDialog } from './components/projects/ProjectPickerDialog';
import type { HardDeleteTarget } from './components/ui/HardDeleteDialog';
import { copyToClipboard } from './lib/clipboard';
import { errorMessage } from './lib/format';
import { openTaskConversation } from './features/tasks/task-conversation';
import type { ActivityEvent } from './features/activity/ActivityPage';
import { IconMenu } from './components/ui/icons';
import { Logo } from './components/ui/Logo';
import { EntityNavigationContext } from './components/ui/Links';
import type { TaskReviewDecision } from './components/tasks/TaskDetailsDialog';
import { catalogSectionForRoute, conversationIdFromSearch, isCatalogRoute, projectIdFromSearch, routeForCatalogSection, routeForTab, routeFromPath, routeUrl, tabForRoute, taskIdFromPath, taskIdFromSearch, taskPageUrl, type AppRoute, type AppTab } from './route-state';

const AdminPanel = lazy(() => import('./components/admin/AdminPanel').then(module => ({ default: module.AdminPanel })));
const ProjectImportPanel = lazy(() => import('./components/admin/ProjectImportPanel').then(module => ({ default: module.ProjectImportPanel })));
const ProjectsPage = lazy(() => import('./components/projects/ProjectsPage').then(module => ({ default: module.ProjectsPage })));
const ProjectSummaryDialog = lazy(() => import('./components/projects/ProjectSummaryDialog').then(module => ({ default: module.ProjectSummaryDialog })));
const TaskStatusDialog = lazy(() => import('./components/tasks/TaskStatusDialog').then(module => ({ default: module.TaskStatusDialog })));
const TaskDetailsDialog = lazy(() => import('./components/tasks/TaskDetailsDialog').then(module => ({ default: module.TaskDetailsDialog })));
const HardDeleteDialog = lazy(() => import('./components/ui/HardDeleteDialog').then(module => ({ default: module.HardDeleteDialog })));
const TaskPage = lazy(() => import('./features/tasks/TaskPage').then(module => ({ default: module.TaskPage })));
const TaskWorkspace = lazy(() => import('./features/tasks/TaskWorkspace').then(module => ({ default: module.TaskWorkspace })));
const ProjectDashboardPage = lazy(() => import('./features/dashboard/ProjectDashboardPage').then(module => ({ default: module.ProjectDashboardPage })));
const TransferTaskDialog = lazy(() => import('./features/tasks/TransferTaskDialog').then(module => ({ default: module.TransferTaskDialog })));
const ConversationPanel = lazy(() => import('./components/conversations/ConversationPanel').then(module => ({ default: module.ConversationPanel })));
const HelpToolsPanel = lazy(() => import('./components/help/HelpToolsPanel').then(module => ({ default: module.HelpToolsPanel })));
const CatalogsPage = lazy(() => import('./features/catalogs/CatalogsPage').then(module => ({ default: module.CatalogsPage })));
const ActivityPage = lazy(() => import('./features/activity/ActivityPage').then(module => ({ default: module.ActivityPage })));

const tokenKey = 'project-tasks.human-token';
const sidebarKey = 'project-tasks.sidebar-collapsed';
type TaskDetailsAction = 'details' | 'edit' | 'summary' | 'json' | 'criteria' | 'assign';

function App() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => { try { return localStorage.getItem(tokenKey) ?? ''; } catch { return ''; } });
  const [nonce, setNonce] = useState(() => token ? 'saved-session' : '');
  const [activeProjectId, setActiveProjectId] = useState(() => projectIdFromSearch(window.location.search));
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));
  const [activityScope, setActivityScope] = useState<'project' | 'global'>(() => routeFromPath(window.location.pathname) === 'globalActivity' || new URLSearchParams(window.location.search).get('activityScope') === 'global' ? 'global' : 'project');
  const [activityTaskSearch, setActivityTaskSearch] = useState('');
  const activeTab = tabForRoute(activeRoute);
  const catalogScreen = isCatalogRoute(activeRoute);
  const globalActivityRoute = activeRoute === 'globalActivity' || activeRoute === 'activity' && activityScope === 'global';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem(sidebarKey) === '1'; } catch { return false; } });
  const [notice, setNotice] = useState<{ message: string; kind: string } | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskAction, setSelectedTaskAction] = useState<TaskDetailsAction>('details');
  const [requestedTaskId, setRequestedTaskId] = useState(() => taskIdFromSearch(window.location.search));
  const [pageTaskId, setPageTaskId] = useState(() => taskIdFromPath(window.location.pathname));
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

  function toggleSidebar() {
    setSidebarCollapsed(current => {
      try { localStorage.setItem(sidebarKey, current ? '0' : '1'); } catch { /* preferência vale só nesta sessão */ }
      return !current;
    });
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'b') return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      toggleSidebar();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function navigateToRoute(route: AppRoute, projectId = activeProjectId, preserveQuery = true) {
    const params = new URLSearchParams(window.location.search);
    const legacyGlobalRoute = route === 'globalActivity';
    const targetRoute: AppRoute = legacyGlobalRoute ? 'activity' : route;
    if (targetRoute !== 'tasks') params.delete('taskId');
    if (targetRoute !== 'activity') params.delete('activityScope');
    if (legacyGlobalRoute) params.set('activityScope', 'global');
    const nextScope = legacyGlobalRoute || targetRoute === 'activity' && preserveQuery && params.get('activityScope') === 'global' ? 'global' : 'project';
    const nextUrl = routeUrl(targetRoute, params.toString(), projectId, preserveQuery || legacyGlobalRoute);
    const currentUrl = window.location.pathname + window.location.search;
    if (nextUrl !== currentUrl) window.history.pushState({ route: targetRoute }, '', nextUrl);
    setActiveRoute(targetRoute);
    setActivityScope(nextScope);
    setPageTaskId('');
    if (targetRoute !== 'tasks') {
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
    navigateToRoute(activeRoute === 'dashboard' ? 'dashboard' : 'tasks', projectId, preserveQuery);
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
    setSelectedTaskAction('details');
    setRequestedTaskId('');
  }

  function openTaskDetails(task: Task, action: TaskDetailsAction = 'details') {
    setSelectedTaskAction(action);
    setSelectedTask(task);
  }

  function openTaskPage(taskId: string) {
    window.history.pushState({ route: 'task' }, '', taskPageUrl(activeProjectId, taskId));
    setSelectedTask(null);
    setSelectedTaskAction('details');
    setRequestedTaskId('');
    setPageTaskId(taskId);
    setActiveRoute('task');
  }

  async function openTaskConversationFromTable(task: Task) {
    try {
      const result = await openTaskConversation(token, activeProjectId, task._id);
      openConversation(result.conversation._id);
    } catch (error) { notify(errorMessage(error), 'error'); }
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
    openTaskDetails(task);
  }

  function openTaskFromActivity(taskId: string, taskProjectId?: string | null) {
    const targetProjectId = taskProjectId || activeProjectId;
    if (targetProjectId !== activeProjectId) {
      window.location.assign(routeUrl('tasks', 'taskId=' + encodeURIComponent(taskId), targetProjectId));
      return;
    }
    const params = new URLSearchParams();
    params.set('taskId', taskId);
    window.history.pushState({ route: 'tasks' }, '', routeUrl('tasks', params.toString(), activeProjectId));
    setActiveRoute('tasks');
    setRequestedTaskId(taskId);
  }

  function filterTasksBy(param: string, value: string) {
    // Na própria fila, soma o filtro aos que já estão ativos; vindo de outra tela, começa limpo.
    const params = activeRoute === 'tasks' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    params.delete('taskId');
    params.delete('page');
    params.set(param, value);
    window.history.pushState({ route: 'tasks' }, '', routeUrl('tasks', params.toString(), activeProjectId));
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function closeTaskDetails() {
    setSelectedTask(null);
    setSelectedTaskAction('details');
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
      const route = routeFromPath(window.location.pathname);
      setActiveRoute(route);
      setActivityScope(route === 'globalActivity' || new URLSearchParams(window.location.search).get('activityScope') === 'global' ? 'global' : 'project');
      setActiveProjectId(projectIdFromSearch(window.location.search));
      setConversationToOpen(conversationIdFromSearch(window.location.search));
      setRequestedTaskId(taskIdFromSearch(window.location.search));
      setPageTaskId(taskIdFromPath(window.location.pathname));
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
  }, [projects, activeProjectId, activeRoute]);
  const currentSummary = projects.find(item => item.project._id === activeProjectId);
  const project = currentSummary?.project;
  const tasksQuery = useQuery({
    queryKey: ['project-tasks', nonce, activeProjectId],
    enabled: Boolean(token && nonce && activeProjectId),
    queryFn: () => allRecords<Task>(token, { kind: 'task', projectId: activeProjectId, archived: false })
  });
  const tasks = tasksQuery.data ?? [];
  const conversationsBadgeQuery = useQuery({
    queryKey: ['conversations', nonce, activeProjectId],
    enabled: Boolean(token && nonce && activeProjectId),
    queryFn: () => query<{ items: Array<{ unread?: { count: number } }>; next?: string | null }>(token, 'list_conversations', { projectId: activeProjectId, limit: 50 }),
    refetchInterval: 30_000
  });
  const unreadConversationCount = (conversationsBadgeQuery.data?.items ?? []).filter(item => (item.unread?.count ?? 0) > 0).length;
  const screenTitle = activeRoute === 'projects' ? 'Projetos' : activeTab === 'dashboard' ? 'Dashboard do projeto' : activeTab === 'activity' ? 'Atividade' : activeTab === 'chat' ? 'Conversas' : activeTab === 'admin' ? 'Administração' : activeTab === 'help' ? 'Ajuda' : catalogScreen ? 'Cadastros' : activeRoute === 'task' ? 'Tarefa' : 'Tarefas';
  useEffect(() => { document.title = (token ? screenTitle + (project ? ' · ' + project.name : '') + ' · ' : '') + 'Project Tasks'; }, [token, screenTitle, project?.name]);
  useEffect(() => {
    if (activeRoute !== 'tasks' || !requestedTaskId || tasksQuery.isPending) return;
    const task = tasks.find(item => item._id === requestedTaskId);
    if (task) {
      setSelectedTaskAction('details');
      setSelectedTask(current => current?._id === task._id ? current : task);
    }
    else {
      setRequestedTaskId('');
      const params = new URLSearchParams(window.location.search);
      params.delete('taskId');
      window.history.replaceState(window.history.state, '', routeUrl('tasks', params.toString(), activeProjectId));
      notify('A tarefa deste link não está disponível na listagem do projeto.', 'error');
    }
  }, [activeRoute, requestedTaskId, tasks, tasksQuery.isPending]);
  useEffect(() => { setActivityTaskSearch(''); }, [activeProjectId, globalActivityRoute]);
  const projectActivityQuery = useInfiniteQuery({
    queryKey: ['project-activity', nonce, activeProjectId, activityTaskSearch.trim()],
    enabled: Boolean(token && nonce && activeProjectId && activeRoute === 'activity' && !globalActivityRoute),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => query<{ items: ActivityEvent[]; next: string | null }>(token, 'list_project_activity', { projectId: activeProjectId, ...(activityTaskSearch.trim() ? { search: activityTaskSearch.trim() } : {}), ...(pageParam ? { after: pageParam } : {}), limit: 40 }),
    getNextPageParam: lastPage => lastPage.next ?? undefined,
    retry: false
  });
  const globalActivityQuery = useInfiniteQuery({
    queryKey: ['global-activity', nonce],
    enabled: Boolean(token && nonce && globalActivityRoute && capabilitiesQuery.data?.systemAdmin === true),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => query<{ items: ActivityEvent[]; next: string | null }>(token, 'get_global_activity', { ...(pageParam ? { after: pageParam } : {}), limit: 40 }),
    getNextPageParam: lastPage => lastPage.next ?? undefined,
    retry: false
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
    setToken(''); setNonce(''); setActiveProjectId(''); setSelectedTask(null); setSelectedTaskAction('details'); setTransferTask(null); setStatusTask(null);
    queryClient.clear();
  }
  async function onTaskTransferred(result: { task: Task }, targetProjectId: string) {
    openTaskDetails(result.task);
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
  async function reviewTask(task: Task, decision: TaskReviewDecision, reason: string): Promise<boolean> {
    setSaving(true);
    const refresh = () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['task-context', nonce, activeProjectId, task._id] }),
      queryClient.invalidateQueries({ queryKey: ['task-activity', nonce, activeProjectId, task._id] }),
      queryClient.invalidateQueries({ queryKey: ['project-sync-report', nonce, activeProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] })
    ]);
    try {
      if (decision === 'approve') await adminMutation.mutateAsync({ path: '/admin/tasks/approve', body: { projectId: activeProjectId, taskIds: [task._id], ...(reason ? { reason } : {}) } });
      else await adminMutation.mutateAsync({ path: '/admin/tasks/status', body: { projectId: activeProjectId, taskId: task._id, status: 'pendente', reason } });
      await refresh();
      notify(decision === 'approve' ? 'Tarefa aprovada e concluída.' : decision === 'return' ? 'Tarefa devolvida para ajustes.' : 'Tarefa desbloqueada.', 'success');
      return true;
    } catch (error) {
      notify(errorMessage(error), 'error');
      await refresh();
      return false;
    } finally { setSaving(false); }
  }
  async function copyProjectId() {
    if (!project) return;
    if (await copyToClipboard(project._id)) { setCopiedProjectId(true); window.setTimeout(() => setCopiedProjectId(false), 1500); }
    else notify('Não foi possível copiar o ID do projeto.', 'error');
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

  if (!token || !nonce) return <main className="auth-page"><div className="auth-brand"><Logo size={36} title="Project Tasks" /><span>Project Tasks</span></div><section className="auth-card"><p className="eyebrow">PAINEL DE OPERAÇÃO</p><h1>Acesse seu workspace</h1><p className="muted-text">Entre com seu token humano para consultar projetos e tarefas.</p><form className="stack-form" onSubmit={signIn}><label>Token humano<input name="token" type="password" autoComplete="current-password" required autoFocus placeholder="Cole o token de administrador" /></label><button className="button primary full-button" disabled={saving}>{saving ? 'Validando…' : 'Entrar'}</button></form><p className="auth-footnote">As ações respeitam as permissões configuradas no servidor.</p></section>{notice && <div className={'toast toast-' + notice.kind}>{notice.message}</div>}</main>;

  return <EntityNavigationContext.Provider value={{ projectId: activeProjectId, openTask: openTaskFromActivity, openConversation, filterByFeature: featureId => filterTasksBy('featureId', featureId), filterBy: filterTasksBy }}><div className={'app-shell min-h-screen bg-canvas text-ink' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
    <aside className="sidebar" id="app-sidebar" aria-label="Menu lateral" aria-hidden={sidebarCollapsed || undefined} inert={sidebarCollapsed || undefined}>
      <a className="brand" href={routeUrl('tasks', window.location.search, activeProjectId)} onClick={event => { event.preventDefault(); navigateToRoute('tasks'); }}><Logo size={34} /><span><strong>Project Tasks</strong><small>Workspace</small></span></a>
      <div className="sidebar-label">CONTEXTO DO PROJETO</div>
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
        <button className={activeRoute === 'tasks' || activeRoute === 'task' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('tasks')}><span>▦</span> Tarefas <b>{tasks.length}</b></button>
        <button className={activeRoute === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('dashboard')}><span>▤</span> Dashboard</button>
        <button className={activeRoute === 'conversations' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('conversations')}><span>✉</span> Conversas{unreadConversationCount > 0 && <b className="nav-badge-unread" aria-label={unreadConversationCount + ' conversa(s) com mensagens não lidas'}>{unreadConversationCount}</b>}</button>
        <button className={activeRoute === 'activity' || globalActivityRoute ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('activity')}><span>◷</span> Atividade</button>
        <div className="sidebar-label nav-section-label">WORKSPACE</div>
        <button className={activeRoute === 'projects' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('projects')}><span>▣</span> Meus projetos <b>{projects.length}</b></button>
        <div className="sidebar-label nav-section-label">CADASTROS</div>
        <button className={activeRoute === 'catalogProjects' || activeRoute === 'catalogs' || activeRoute === 'catalogAreas' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('catalogProjects')}><span>▣</span> Projetos</button>
        <button className={activeRoute === 'catalogFeatures' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('catalogFeatures')}><span>◈</span> Features</button>
        <button className={activeRoute === 'catalogTasks' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('catalogTasks')}><span>☑</span> Tarefas</button>
        <button className={activeRoute === 'catalogResponsibles' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('catalogResponsibles')}><span>☺</span> Responsáveis</button>
        <div className="sidebar-label nav-section-label">SISTEMA</div>
        <button className={activeRoute === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('settings')}><span>⚙</span> Administração</button>
        <button className={activeRoute === 'help' ? 'nav-item active' : 'nav-item'} onClick={() => navigateToRoute('help')}><span>ⓘ</span> Ajuda</button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer"><span className="online-dot" /> Conectado ao MCP <button className="small-icon" onClick={signOut} title="Sair">↪</button></div>
    </aside>
    <main className="main-area min-h-screen">
      <header className="topbar"><div className="breadcrumbs"><button type="button" className="small-icon sidebar-toggle" aria-controls="app-sidebar" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? 'Mostrar menu lateral' : 'Ocultar menu lateral'} title={(sidebarCollapsed ? 'Mostrar' : 'Ocultar') + ' menu lateral (Ctrl+B)'} onClick={toggleSidebar}><IconMenu size={18} /></button><span>Workspace</span><span>/</span><strong>{activeRoute === 'projects' ? 'Projetos' : activeTab === 'activity' ? 'Atividade' : catalogScreen ? `Cadastros · ${{projects:'Projetos',features:'Features',tasks:'Tarefas',responsibles:'Responsáveis'}[catalogSectionForRoute(activeRoute)]}` : project?.name ?? 'Carregando projeto'}</strong></div><div className="topbar-actions"><span className="connection-pill"><span className="online-dot" /> Serviço ativo</span><button className="avatar-button" onClick={signOut} title="Sair">AU</button></div></header>
      <div className="content-wrap">
        {projectsQuery.isError && <div className="notice error">{errorMessage(projectsQuery.error)}</div>}
        <Suspense fallback={<div className="loading">Carregando tela…</div>}>
        {activeRoute === 'projects' && <ProjectsPage projects={currentProjectPage} isPending={projectsQuery.isPending} activeProjectId={activeProjectId} search={allProjectsSearch} currentPage={projectPage} pages={projectPages} total={filteredProjects.length} onSearchChange={value => { setAllProjectsSearch(value); setProjectPage(1); }} onPageChange={setProjectPage} onSelect={selectProject} />}
        {activeRoute !== 'projects' && !catalogScreen && !globalActivityRoute && !projects.length && !projectsQuery.isPending && <div className="empty-state"><h2>Nenhum projeto disponível</h2><p>Esta credencial ainda não possui projetos acessíveis.</p><button className="button secondary" onClick={() => navigateToRoute('projects')}>Abrir projetos</button></div>}
        {activeTab === 'admin' && !project && !projectsQuery.isPending && canHardDelete && <div className="project-import-first"><div className="page-heading"><div><p className="eyebrow">CONFIGURAÇÃO</p><h1>Administração</h1><p className="muted-text">Importe um projeto para começar neste MCP.</p></div></div><ProjectImportPanel token={token} canImport onImported={async result => { await projectsQuery.refetch(); setActiveProjectId(result.projectId); navigateToRoute('settings', result.projectId, false); }} /></div>}
        {catalogScreen && <CatalogsPage section={catalogSectionForRoute(activeRoute)} token={token} nonce={nonce} projects={projects.map(item => item.project)} project={project} tasks={tasks} notify={notify} onProjectCreated={async created => { await projectsQuery.refetch(); navigateToRoute(routeForCatalogSection('projects'), created._id, false); }} onSelectProject={projectId => navigateToRoute(activeRoute, projectId, false)} systemAdmin={capabilitiesQuery.data?.systemAdmin === true} onChanged={() => { void projectsQuery.refetch(); void tasksQuery.refetch(); }} />}
        {activeRoute !== 'projects' && !catalogScreen && (project || globalActivityRoute) && <>
          {activeRoute !== 'task' && activeRoute !== 'dashboard' && <div className="page-heading"><div><p className="eyebrow">{activeTab === 'tasks' ? 'ACOMPANHAMENTO' : activeTab === 'chat' ? 'COLABORAÇÃO' : activeTab === 'activity' ? 'ATIVIDADE' : activeTab === 'admin' ? 'CONFIGURAÇÃO' : 'DOCUMENTAÇÃO'}</p><h1>{activeTab === 'tasks' ? 'Tarefas do projeto' : activeTab === 'chat' ? 'Conversas com IA' : activeTab === 'activity' ? 'Atividade' : activeTab === 'admin' ? 'Administração' : 'Ajuda do Project Tasks'}</h1><p className="muted-text">{activeTab === 'tasks' ? 'Acompanhe execução, revisão e conclusão do trabalho.' : activeTab === 'chat' ? 'Esclareça pedidos com a IA e autorize a execução quando a proposta estiver pronta.' : activeTab === 'activity' ? globalActivityRoute ? 'Acompanhe eventos recentes de todos os projetos.' : 'Acompanhe eventos, mudanças e colaboração neste projeto.' : activeTab === 'admin' ? 'Credenciais e configurações restritas do workspace.' : 'Referência rápida para os servidores e ferramentas MCP.'}</p></div>{activeTab === 'tasks' && <div className="button-row"><button className="button secondary" onClick={() => setSummaryOpen(true)}>Resumo do projeto</button></div>}</div>}
          {activeTab === 'tasks' && activeRoute !== 'task' && <TaskWorkspace key={activeProjectId} token={token} nonce={nonce} projectId={activeProjectId} repositories={project?.repositories ?? []} projectAreas={project?.areas ?? ['backend', 'frontend', 'outro']} tasks={tasks} isPending={tasksQuery.isPending} isError={tasksQuery.isError} error={tasksQuery.error} saving={saving} updatedAt={tasksQuery.dataUpdatedAt || undefined} refreshing={tasksQuery.isFetching} canHardDelete={canHardDelete} systemAdmin={capabilitiesQuery.data?.systemAdmin === true} onRefresh={() => { void projectsQuery.refetch(); void tasksQuery.refetch(); }} onOpenTask={openTaskDetails} onOpenTaskConversation={openTaskConversationFromTable} onTransferTask={setTransferTask} onChangeStatus={setStatusTask} onToggleChecked={toggleChecked} onRequestHardDeleteTask={requestTaskHardDelete} onArchiveTask={archiveTask} onApproveSelected={approveSelected} onSetTasksChecked={setTasksChecked} />}
          {activeRoute === 'dashboard' && <ProjectDashboardPage token={token} nonce={nonce} projectId={activeProjectId} />}
          {activeRoute === 'task' && pageTaskId && <TaskPage key={activeProjectId + ':' + pageTaskId} taskId={pageTaskId} token={token} nonce={nonce} projectId={activeProjectId} project={project!} tasks={tasks} checking={adminMutation.isPending || saving} notify={notify} onToggleChecked={toggleChecked} onOpenConversation={openConversation} onRequestTransfer={setTransferTask} systemAdmin={capabilitiesQuery.data?.systemAdmin === true} onReview={reviewTask} onChangeStatus={setStatusTask} close={() => navigateToRoute('tasks', activeProjectId, false)} />}
          {activeTab === 'chat' && <ConversationPanel token={token} nonce={nonce} projectId={activeProjectId} tasks={tasks} requestedConversationId={conversationToOpen || undefined} onConversationSelected={rememberConversation} onOpenTask={openTaskFromConversation} onOpenAdmin={() => setActiveTab('admin')} />}
          {activeTab === 'activity' && (globalActivityRoute && capabilitiesQuery.data?.systemAdmin !== true
            ? <div className="notice error" role="alert">{capabilitiesQuery.isPending ? 'Verificando acesso administrativo…' : capabilitiesQuery.isError ? errorMessage(capabilitiesQuery.error) : 'A atividade global é restrita a administradores do sistema.'}</div>
            : <ActivityPage
              key={globalActivityRoute ? 'global' : activeProjectId}
              events={globalActivityRoute ? globalActivityQuery.data?.pages.flatMap(page => page.items) ?? [] : projectActivityQuery.data?.pages.flatMap(page => page.items) ?? []}
              tasks={tasks}
              projects={projects.map(item => item.project)}
              isGlobal={globalActivityRoute}
              canViewGlobal={capabilitiesQuery.data?.systemAdmin === true}
              taskSearch={activityTaskSearch}
              onTaskSearchChange={setActivityTaskSearch}
              onScopeChange={isGlobal => navigateToRoute(isGlobal ? 'globalActivity' : 'activity', activeProjectId, isGlobal)}
              isPending={globalActivityRoute ? capabilitiesQuery.isPending || globalActivityQuery.isPending : projectActivityQuery.isPending}
              isError={globalActivityRoute ? globalActivityQuery.isError : projectActivityQuery.isError}
              error={globalActivityRoute ? globalActivityQuery.error : projectActivityQuery.error}
              hasMore={globalActivityRoute ? globalActivityQuery.hasNextPage : projectActivityQuery.hasNextPage}
              isLoadingMore={globalActivityRoute ? globalActivityQuery.isFetchingNextPage : projectActivityQuery.isFetchingNextPage}
              onRefresh={() => { if (globalActivityRoute) void globalActivityQuery.refetch(); else void projectActivityQuery.refetch(); }}
              onLoadMore={() => { if (globalActivityRoute) void globalActivityQuery.fetchNextPage(); else void projectActivityQuery.fetchNextPage(); }}
            />)}
          {activeTab === 'admin' && project && <AdminPanel token={token} project={project} projects={projects.map(item => item.project)} onChanged={() => projectsQuery.refetch()} notify={notify} canHardDelete={canHardDelete} systemAdmin={capabilitiesQuery.data?.systemAdmin === true} actionPending={saving} onRequestHardDeleteProject={requestProjectHardDelete} onArchiveProject={() => { void archiveProject(); }} />}
          {activeTab === 'help' && <HelpToolsPanel search={toolSearch} onSearchChange={setToolSearch} />}
        </>}
        </Suspense>
      </div>
      <footer className="app-footer"><span>Project Tasks MCP</span><span>{project?.name ?? ''}</span></footer>
    </main>
    <Suspense fallback={null}>
    {selectedTask && project && <TaskDetailsDialog key={`${project._id}:${selectedTask._id}:${selectedTaskAction}`} token={token} nonce={nonce} projectId={project._id} project={project} tasks={tasks} task={selectedTask} initialAction={selectedTaskAction} checking={adminMutation.isPending || saving} notify={notify} onToggleChecked={toggleChecked} onOpenConversation={openConversation} onRequestTransfer={setTransferTask} systemAdmin={capabilitiesQuery.data?.systemAdmin === true} onReview={reviewTask} onChangeStatus={setStatusTask} onOpenPage={() => openTaskPage(selectedTask._id)} close={closeTaskDetails} />}
    {transferTask && project && <TransferTaskDialog key={`${project._id}:${transferTask._id}`} token={token} nonce={nonce} projectId={project._id} task={transferTask} projects={projects.map(item => item.project)} close={() => setTransferTask(null)} onTransferred={onTaskTransferred} />}
    {statusTask && <TaskStatusDialog task={statusTask} saving={saving} onClose={() => setStatusTask(null)} onSubmit={updateStatus} />}
    <ProjectPickerDialog projects={currentProjectPage} activeProjectId={activeProjectId} search={allProjectsSearch} currentPage={projectPage} pages={projectPages} total={filteredProjects.length} onSearchChange={value => { setAllProjectsSearch(value); setProjectPage(1); }} onPageChange={setProjectPage} onSelect={id => { selectProject(id); (document.getElementById('projects-dialog') as HTMLDialogElement | null)?.close(); }} />
    {summaryOpen && <ProjectSummaryDialog name={project?.name} taskCount={projectSummaryQuery.data?.taskCount ?? tasks.length} markdown={projectSummaryQuery.data?.markdown} error={projectSummaryQuery.error} isPending={projectSummaryQuery.isPending} isError={projectSummaryQuery.isError} onClose={() => setSummaryOpen(false)} />}
    {hardDeleteTarget && <HardDeleteDialog target={hardDeleteTarget} busy={hardDeleteBusy} error={hardDeleteError} onClose={() => { setHardDeleteTarget(null); setHardDeleteError(''); }} onConfirm={() => void confirmHardDelete()} />}
    </Suspense>
    {notice && <div className={'toast toast-' + notice.kind} role="status">{notice.message}<button onClick={() => setNotice(null)} aria-label="Dispensar">×</button></div>}
  </div></EntityNavigationContext.Provider>;
}

export default App;
