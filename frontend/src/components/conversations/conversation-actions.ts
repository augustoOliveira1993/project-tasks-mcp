import { operationId, query, request } from '../../api';

export function createProjectConversation<T>(token: string, projectId: string) {
  return request<T>(token, '/admin/conversations', { body: { projectId, operationId: operationId() } });
}

export function searchProjectTasks<T>(token: string, projectId: string, search: string) {
  return query<T>(token, 'list_records', { kind: 'task', projectId, archived: false, search, limit: 20 });
}

export function linkConversationTask<T>(token: string, conversationId: string, projectId: string, taskId: string, version: number) {
  return request<T>(token, `/admin/conversations/${conversationId}/task`, {
    body: { projectId, taskId, version, operationId: operationId() }
  });
}

export function deleteProjectConversation<T>(token: string, conversationId: string, projectId: string, version: number) {
  return request<T>(token, `/admin/conversations/${conversationId}`, {
    method: 'DELETE', body: { projectId, version, operationId: operationId() }
  });
}

export function updateConversationTitle<T>(token: string, conversationId: string, projectId: string, title: string, version: number) {
  return request<T>(token, `/admin/conversations/${conversationId}/title`, {
    method: 'PATCH', body: { projectId, title, version, operationId: operationId() }
  });
}

export function scheduleTaskSearch(value: string, update: (value: string) => void, delayMs = 250) {
  const timer = setTimeout(() => update(value.trim()), delayMs);
  return () => clearTimeout(timer);
}

export function confirmConversationDeletion(confirm: (message: string) => boolean, remove: () => void) {
  if (confirm('Excluir esta conversa do histórico? Tarefas e execuções não serão alteradas.')) remove();
}

type HistoryPage<T> = { items: T[]; next?: string | null };

export function historyAfterConversationDeletion<T extends { _id: string }>(
  current: HistoryPage<T> | undefined,
  olderPages: HistoryPage<T>[],
  deletedId: string
) {
  const remaining = [...new Map([...(current?.items ?? []), ...olderPages.flatMap(page => page.items)].map(item => [item._id, item])).values()]
    .filter(item => item._id !== deletedId);
  return {
    current: current ? { ...current, items: current.items.filter(item => item._id !== deletedId) } : current,
    olderPages: olderPages.map(page => ({ ...page, items: page.items.filter(item => item._id !== deletedId) })),
    selectedId: remaining[0]?._id ?? ''
  };
}

export function historyAfterConversationTitleUpdate<T extends { _id: string; title: string; version: number }>(
  current: HistoryPage<T> | undefined,
  olderPages: HistoryPage<T>[],
  updated: Pick<T, '_id' | 'title' | 'version'>
) {
  const update = (item: T) => item._id === updated._id ? { ...item, title: updated.title, version: updated.version } : item;
  return {
    current: current ? { ...current, items: current.items.map(update) } : current,
    olderPages: olderPages.map(page => ({ ...page, items: page.items.map(update) }))
  };
}
