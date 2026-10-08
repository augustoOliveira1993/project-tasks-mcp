import { operationId, query, request } from '../../api';
import type { ConversationStage, ConversationType } from './conversation-types';

export type ConversationFilter = 'all' | 'unread' | 'review' | 'done';
export type ConversationInboxState = { filter: ConversationFilter; selectedId: string; chooseAfterFilter: boolean };

export function conversationInboxAfterFilter(state: ConversationInboxState, filter: ConversationFilter): ConversationInboxState {
  return { ...state, filter, selectedId: '', chooseAfterFilter: true };
}

export function conversationInboxAfterSelection(state: ConversationInboxState, selectedId: string): ConversationInboxState {
  return { ...state, selectedId, chooseAfterFilter: false };
}

export function createProjectConversation<T>(token: string, projectId: string, typeId?: string) {
  return request<T>(token, '/admin/conversations', { body: { projectId, operationId: operationId(), ...(typeId ? { typeId } : {}) } });
}

export function listConversationTypes<T = ConversationType[]>(token: string, projectId: string) {
  const params = new URLSearchParams({ projectId });
  return request<{ items: T }>(token, '/admin/conversation-types?' + params.toString());
}

export function createConversationType<T = ConversationType>(token: string, projectId: string, data: { name: string; description: string; stages: ConversationStage[] }) {
  return request<T>(token, '/admin/conversation-types', { body: { operationId: operationId(), projectId, data } });
}

export function updateConversationType<T = ConversationType>(token: string, projectId: string, typeId: string, version: number, data: { name: string; description: string; stages: ConversationStage[] }) {
  return request<T>(token, `/admin/conversation-types/${encodeURIComponent(typeId)}`, { method: 'PATCH', body: { operationId: operationId(), projectId, version, data } });
}

export function duplicateConversationType<T = ConversationType>(token: string, projectId: string, typeId: string, sourceVersion: number, name: string) {
  return request<T>(token, `/admin/conversation-types/${encodeURIComponent(typeId)}/duplicate`, { body: { operationId: operationId(), projectId, sourceVersion, name } });
}

export function archiveConversationType<T = ConversationType>(token: string, projectId: string, typeId: string, version: number) {
  return request<T>(token, `/admin/conversation-types/${encodeURIComponent(typeId)}/archive`, { body: { operationId: operationId(), projectId, version } });
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

export type ConversationReadAttempt = { conversationId: string; cursor: string; operationId: string };

export function nextConversationReadAttempt(
  previous: ConversationReadAttempt | null,
  conversationId: string,
  unread?: { count: number; cursor: string | null }
): ConversationReadAttempt | null {
  if (!unread || unread.count <= 0 || !unread.cursor) return null;
  if (previous?.conversationId === conversationId && previous.cursor === unread.cursor) return null;
  return { conversationId, cursor: unread.cursor, operationId: operationId() };
}

export function markConversationRead<T>(token: string, projectId: string, attempt: ConversationReadAttempt) {
  return request<T>(token, `/admin/conversations/${attempt.conversationId}/read`, {
    body: { projectId, cursor: attempt.cursor, operationId: attempt.operationId }
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
