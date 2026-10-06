import type { Task } from '../../api';

export type TaskRowAction = 'details' | 'status' | 'edit' | 'conversation' | 'transfer' | 'summary' | 'json' | 'check' | 'archive' | 'delete';

export type TaskMenuAction = { id: TaskRowAction; label: string; danger?: boolean; disabled?: boolean; dividerBefore?: boolean };

/** Ação primária contextual exibida na linha, conforme o estágio do fluxo. */
export function primaryActionFor(task: Pick<Task, 'status' | 'checked'>): { id: TaskRowAction; label: string; emphasis: boolean } {
  switch (task.status) {
    case 'em_revisao': return { id: 'details', label: 'Revisar', emphasis: true };
    case 'concluida': return task.checked ? { id: 'details', label: 'Abrir', emphasis: false } : { id: 'check', label: 'Conferir', emphasis: true };
    case 'bloqueada': return { id: 'details', label: 'Ver bloqueio', emphasis: false };
    case 'em_execucao': return { id: 'details', label: 'Acompanhar', emphasis: false };
    default: return { id: 'details', label: 'Abrir', emphasis: false };
  }
}

/** Menu único da linha; reúne tudo que não é a ação primária. */
export function buildTaskMenu(task: Pick<Task, 'status' | 'checked'>, { canHardDelete, saving }: { canHardDelete: boolean; saving: boolean }): TaskMenuAction[] {
  return [
    { id: 'details', label: 'Abrir detalhes' },
    { id: 'conversation', label: 'Abrir conversa' },
    { id: 'edit', label: 'Editar tarefa', dividerBefore: true },
    { id: 'status', label: 'Alterar status…' },
    { id: 'transfer', label: 'Transferir tarefa' },
    { id: 'summary', label: 'Resumo completo', dividerBefore: true },
    { id: 'json', label: 'Ver JSON' },
    ...(task.status === 'concluida' ? [{ id: 'check' as const, label: task.checked ? 'Remover conferência' : 'Conferir tarefa', disabled: saving, dividerBefore: true }] : []),
    ...(['concluida', 'cancelada'].includes(task.status) ? [{ id: 'archive' as const, label: 'Arquivar', disabled: saving, dividerBefore: task.status !== 'concluida' }] : []),
    ...(canHardDelete ? [{ id: 'delete' as const, label: 'Excluir definitivamente…', danger: true, disabled: saving, dividerBefore: true }] : [])
  ];
}
