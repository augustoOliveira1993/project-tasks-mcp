export type TaskAttachmentReadState = { initialized: boolean; seenIds: string[] };

function storageKey(projectId: string, taskId: string) {
  return `task-attachment-reads:${projectId}:${taskId}`;
}

export function loadTaskAttachmentReadState(projectId: string, taskId: string): TaskAttachmentReadState {
  try {
    const value = localStorage.getItem(storageKey(projectId, taskId));
    if (!value) return { initialized: false, seenIds: [] };
    const parsed = JSON.parse(value) as Partial<TaskAttachmentReadState>;
    if (parsed.initialized !== true || !Array.isArray(parsed.seenIds)) return { initialized: false, seenIds: [] };
    return { initialized: true, seenIds: parsed.seenIds.filter((id): id is string => typeof id === 'string') };
  } catch {
    return { initialized: false, seenIds: [] };
  }
}

export function saveTaskAttachmentReadState(projectId: string, taskId: string, state: TaskAttachmentReadState) {
  try { localStorage.setItem(storageKey(projectId, taskId), JSON.stringify(state)); }
  catch { /* O estado em memória continua ativo quando o navegador bloqueia o armazenamento local. */ }
}
