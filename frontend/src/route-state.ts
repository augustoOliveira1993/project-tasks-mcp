export type AppRoute = 'projects' | 'tasks' | 'conversations' | 'activity' | 'globalActivity' | 'catalogs' | 'catalogProjects' | 'catalogFeatures' | 'catalogTasks' | 'catalogAreas' | 'catalogResponsibles' | 'settings' | 'help';
export type AppTab = 'tasks' | 'chat' | 'activity' | 'catalogs' | 'admin' | 'help';
export type CatalogSection = 'projects' | 'features' | 'tasks' | 'responsibles';

const routePaths: Record<AppRoute, string> = {
  projects: '/projects', tasks: '/tasks', conversations: '/conversations',
  activity: '/activity', globalActivity: '/activity/global', catalogs: '/catalogs', catalogProjects: '/catalogs/projects', catalogFeatures: '/catalogs/features',
  catalogTasks: '/catalogs/tasks', catalogAreas: '/catalogs/areas', catalogResponsibles: '/catalogs/responsibles', settings: '/settings', help: '/help'
};

const tabRoutes: Record<AppTab, AppRoute> = {
  tasks: 'tasks', chat: 'conversations', activity: 'activity', catalogs: 'catalogs', admin: 'settings', help: 'help'
};

export function routeFromPath(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, '') || '/';
  const route = (Object.entries(routePaths) as Array<[AppRoute, string]>).find(([, value]) => value === path)?.[0];
  // /admin remains the existing SPA entry point; its default view is the task workspace.
  return route ?? 'tasks';
}

export function routeForTab(tab: AppTab): AppRoute {
  return tabRoutes[tab];
}

export function tabForRoute(route: AppRoute): AppTab {
  if (route === 'conversations') return 'chat';
  if (route === 'globalActivity') return 'activity';
  if (route === 'settings') return 'admin';
  if (route === 'projects') return 'tasks';
  if (isCatalogRoute(route)) return 'catalogs';
  return route;
}

export function isCatalogRoute(route: AppRoute): route is 'catalogs' | 'catalogProjects' | 'catalogFeatures' | 'catalogTasks' | 'catalogAreas' | 'catalogResponsibles' {
  return route === 'catalogs' || route === 'catalogProjects' || route === 'catalogFeatures' || route === 'catalogTasks' || route === 'catalogAreas' || route === 'catalogResponsibles';
}

export function catalogSectionForRoute(route: AppRoute): CatalogSection {
  return route === 'catalogFeatures' ? 'features' : route === 'catalogTasks' ? 'tasks' : route === 'catalogResponsibles' ? 'responsibles' : 'projects';
}

export function routeForCatalogSection(section: CatalogSection): AppRoute {
  return section === 'features' ? 'catalogFeatures' : section === 'tasks' ? 'catalogTasks' : section === 'responsibles' ? 'catalogResponsibles' : 'catalogProjects';
}

export function pathForRoute(route: AppRoute): string {
  return routePaths[route];
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
