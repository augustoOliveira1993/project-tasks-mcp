export type AppRoute = 'projects' | 'tasks' | 'task' | 'dashboard' | 'globalDashboard' | 'conversations' | 'activity' | 'globalActivity' | 'catalogs' | 'catalogProjects' | 'catalogFeatures' | 'catalogTasks' | 'catalogAreas' | 'catalogResponsibles' | 'catalogConversationTypes' | 'settings' | 'help';
export type AppTab = 'tasks' | 'dashboard' | 'chat' | 'activity' | 'catalogs' | 'admin' | 'help';
export type CatalogSection = 'projects' | 'features' | 'tasks' | 'responsibles' | 'conversationTypes';

const routePaths: Record<Exclude<AppRoute, 'task'>, string> = {
  projects: '/projects', tasks: '/tasks', dashboard: '/dashboard', globalDashboard: '/dashboard', conversations: '/conversations',
  activity: '/activity', globalActivity: '/activity/global', catalogs: '/catalogs', catalogProjects: '/catalogs/projects', catalogFeatures: '/catalogs/features',
  catalogTasks: '/catalogs/tasks', catalogAreas: '/catalogs/areas', catalogResponsibles: '/catalogs/responsibles', catalogConversationTypes: '/catalogs/conversation-types', settings: '/settings', help: '/help'
};

const tabRoutes: Record<AppTab, AppRoute> = {
  tasks: 'tasks', dashboard: 'dashboard', chat: 'conversations', activity: 'activity', catalogs: 'catalogs', admin: 'settings', help: 'help'
};

const taskPagePattern = /^\/tasks\/([^/]+)$/;

export function taskIdFromPath(pathname: string): string {
  const match = taskPagePattern.exec(pathname.replace(/\/+$/, ''));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

export function routeFromPath(pathname: string, search = ''): AppRoute {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (taskIdFromPath(path)) return 'task';
  if (path === routePaths.dashboard && new URLSearchParams(search).get('dashboardScope') === 'global') return 'globalDashboard';
  const route = (Object.entries(routePaths) as Array<[AppRoute, string]>).find(([, value]) => value === path)?.[0];
  // /admin remains the existing SPA entry point; its default view is the task workspace.
  return route ?? 'tasks';
}

export function routeForTab(tab: AppTab): AppRoute {
  return tabRoutes[tab];
}

export function tabForRoute(route: AppRoute): AppTab {
  if (route === 'task') return 'tasks';
  if (route === 'conversations') return 'chat';
  if (route === 'globalActivity') return 'activity';
  if (route === 'globalDashboard') return 'dashboard';
  if (route === 'settings') return 'admin';
  if (route === 'projects') return 'tasks';
  if (isCatalogRoute(route)) return 'catalogs';
  return route;
}

export function isCatalogRoute(route: AppRoute): route is 'catalogs' | 'catalogProjects' | 'catalogFeatures' | 'catalogTasks' | 'catalogAreas' | 'catalogResponsibles' | 'catalogConversationTypes' {
  return route === 'catalogs' || route === 'catalogProjects' || route === 'catalogFeatures' || route === 'catalogTasks' || route === 'catalogAreas' || route === 'catalogResponsibles' || route === 'catalogConversationTypes';
}

export function catalogSectionForRoute(route: AppRoute): CatalogSection {
  return route === 'catalogFeatures' ? 'features' : route === 'catalogTasks' ? 'tasks' : route === 'catalogResponsibles' ? 'responsibles' : route === 'catalogConversationTypes' ? 'conversationTypes' : 'projects';
}

export function routeForCatalogSection(section: CatalogSection): AppRoute {
  return section === 'features' ? 'catalogFeatures' : section === 'tasks' ? 'catalogTasks' : section === 'responsibles' ? 'catalogResponsibles' : section === 'conversationTypes' ? 'catalogConversationTypes' : 'catalogProjects';
}

export function pathForRoute(route: AppRoute): string {
  return route === 'task' ? routePaths.tasks : routePaths[route];
}

/** Página dedicada de uma tarefa: /tasks/:taskId?projectId=… */
export function taskPageUrl(projectId: string, taskId: string): string {
  return `${routePaths.tasks}/${encodeURIComponent(taskId)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`;
}

export function projectIdFromSearch(search: string): string {
  return new URLSearchParams(search).get('projectId') ?? '';
}

export function conversationIdFromSearch(search: string): string {
  return new URLSearchParams(search).get('conversationId') ?? '';
}

export function taskIdFromSearch(search: string): string {
  return new URLSearchParams(search).get('taskId') ?? '';
}

export function routeUrl(route: AppRoute, search: string, projectId: string, preserveQuery = true): string {
  const params = preserveQuery ? new URLSearchParams(search) : new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  else params.delete('projectId');
  const query = params.toString();
  return pathForRoute(route) + (query ? `?${query}` : '');
}
