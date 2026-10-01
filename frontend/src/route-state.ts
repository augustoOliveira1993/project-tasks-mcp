export type AppRoute = 'projects' | 'tasks' | 'conversations' | 'activity' | 'settings' | 'help';
export type AppTab = 'tasks' | 'chat' | 'activity' | 'admin' | 'help';

const routePaths: Record<AppRoute, string> = {
  projects: '/projects', tasks: '/tasks', conversations: '/conversations',
  activity: '/activity', settings: '/settings', help: '/help'
};

const tabRoutes: Record<AppTab, AppRoute> = {
  tasks: 'tasks', chat: 'conversations', activity: 'activity', admin: 'settings', help: 'help'
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
  return route === 'conversations' ? 'chat' : route === 'settings' ? 'admin' : route === 'projects' ? 'tasks' : route;
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

export function routeUrl(route: AppRoute, search: string, projectId: string, preserveQuery = true): string {
  const params = preserveQuery ? new URLSearchParams(search) : new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  else params.delete('projectId');
  const query = params.toString();
  return pathForRoute(route) + (query ? `?${query}` : '');
}
