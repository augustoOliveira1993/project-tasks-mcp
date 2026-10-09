import type { TaskQueryState } from './task-query-params';
import { countFilterConditions, emptyFilterGroup, type FilterGroup } from './advanced-filter';

export type TaskViewState = Partial<Pick<TaskQueryState, 'search' | 'status' | 'area' | 'type' | 'priority' | 'responsible' | 'featureId' | 'flag' | 'sort'>> & { expression?: FilterGroup };
export type TaskView = { id: string; label: string; description: string; state: TaskViewState; custom?: boolean };

const viewKeys = ['search', 'status', 'area', 'type', 'priority', 'responsible', 'featureId', 'flag', 'sort'] as const;
const emptyViewState: Required<TaskViewState> = { search: '', status: 'todos', area: 'todos', type: 'todos', priority: '', responsible: '', featureId: '', flag: '', sort: 'priority', expression: emptyFilterGroup() };

export const builtInViews: TaskView[] = [
  { id: 'all', label: 'Todas', description: 'Sem filtros', state: {} },
  { id: 'review', label: 'Aguardando revisão', description: 'Tarefas em revisão, mais recentes primeiro', state: { status: 'em_revisao', sort: 'updated' } },
  { id: 'blocked', label: 'Bloqueadas', description: 'Tarefas bloqueadas', state: { status: 'bloqueada' } },
  { id: 'questions', label: 'Perguntas abertas', description: 'Tarefas com pergunta sem resposta', state: { flag: 'questions' } },
  { id: 'unread', label: 'Não lidas', description: 'Tarefas com atualizações não lidas', state: { flag: 'unread' } }
];

export function mineView(email: string): TaskView {
  return { id: 'mine', label: 'Minhas tasks', description: `Responsável: ${email}`, state: { responsible: email } };
}

/** Estado completo da visão (campos omitidos voltam ao padrão). */
export function viewPatch(view: TaskView): Required<TaskViewState> {
  return { ...emptyViewState, ...view.state };
}

/** A visão está ativa quando todos os campos coincidem; a ordenação só conta para visões que a definem. */
export function matchesView(state: TaskQueryState, view: TaskView): boolean {
  const expected = viewPatch(view);
  const advancedActive = Boolean(state.createdAfter || state.createdBefore || state.updatedAfter || state.updatedBefore);
  return !advancedActive && JSON.stringify(state.expression) === JSON.stringify(expected.expression) && viewKeys.every(key => key === 'sort' && view.state.sort === undefined ? true : state[key] === expected[key]);
}

/** Conta filtros avançados que ficam atrás de “Mais filtros”, sem contar busca e seletores rápidos da fila. */
export function countAdvancedFilters(state: TaskQueryState): number {
  return [state.priority, state.responsible, state.featureId, state.createdAfter, state.createdBefore, state.updatedAfter, state.updatedBefore]
    .filter(Boolean).length + countFilterConditions(state.expression);
}

export function snapshotView(name: string, state: TaskQueryState): TaskView {
  const picked = Object.fromEntries(viewKeys.map(key => [key, state[key]])) as TaskViewState;
  picked.expression = state.expression;
  return { id: `custom-${Date.now().toString(36)}`, label: name.trim(), description: 'Visão salva neste navegador', state: picked, custom: true };
}

const viewsKey = (projectId: string) => `project-tasks.views.${projectId}`;
const emailKey = 'project-tasks.me-email';

export function loadSavedViews(projectId: string): TaskView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(viewsKey(projectId)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((item): item is TaskView => typeof item?.id === 'string' && typeof item?.label === 'string' && typeof item?.state === 'object').map(item => ({ ...item, custom: true })) : [];
  } catch { return []; }
}

export function storeSavedViews(projectId: string, views: TaskView[]) {
  try { localStorage.setItem(viewsKey(projectId), JSON.stringify(views)); } catch { /* armazenamento indisponível: as visões valem só nesta sessão */ }
}

export function loadMyEmail(): string {
  try { return localStorage.getItem(emailKey) ?? ''; } catch { return ''; }
}

export function storeMyEmail(email: string) {
  try { localStorage.setItem(emailKey, email); } catch { /* ignore */ }
}
