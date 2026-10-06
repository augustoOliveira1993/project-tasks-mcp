import type { Task } from '../../api';

export const sortLabels: Record<string, string> = {
  priority: 'Prioridade',
  updated: 'Atualizadas recentemente',
  created: 'Criadas recentemente',
  name: 'Nome (A–Z)',
  status: 'Fluxo de status'
};

const statusOrder = ['em_revisao', 'em_execucao', 'bloqueada', 'pendente', 'concluida', 'cancelada'];

const byUpdatedDesc = (a: Task, b: Task) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
const byPriority = (a: Task, b: Task) => (a.priority ?? 999) - (b.priority ?? 999);

export function sortTasks(tasks: Task[], sort: string): Task[] {
  const items = [...tasks];
  switch (sort) {
    case 'updated': return items.sort(byUpdatedDesc);
    case 'created': return items.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    case 'name': return items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    case 'status': return items.sort((a, b) => (statusOrder.indexOf(a.status) + 1 || 99) - (statusOrder.indexOf(b.status) + 1 || 99) || byPriority(a, b) || byUpdatedDesc(a, b));
    default: return items.sort((a, b) => byPriority(a, b) || byUpdatedDesc(a, b));
  }
}
