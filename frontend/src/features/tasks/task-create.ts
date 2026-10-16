import { operationId, request } from '../../api';
import type { Task } from '../../api';

export type NewTaskDraft = {
  name: string;
  instructions: string;
  acceptanceText: string;
  area: string;
  repositoryId: string;
  featureId: string;
  type: 'feature' | 'fix' | 'chore' | 'docs' | 'refactor' | 'test' | 'perf' | 'build' | 'ci' | 'revert';
  priority: number;
  dependencies: string[];
  responsible: string;
  plannedStartAt?: string;
  plannedDueAt?: string;
};

export function acceptanceCriteriaFromText(value: string): string[] {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

export function plannedDateTime(value: string): string | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString();
}

export function plannedDateInput(value?: string | null): string {
  return value?.slice(0, 10) ?? '';
}

export function createTaskDataFromDraft(draft: NewTaskDraft) {
  const name = draft.name.trim();
  const instructions = draft.instructions.trim();
  const acceptance = acceptanceCriteriaFromText(draft.acceptanceText);
  if (!name || !instructions || acceptance.length === 0 || !draft.repositoryId) {
    throw new Error('Preencha nome, instruções, repositório e ao menos um critério de aceite.');
  }
  if (draft.plannedStartAt && draft.plannedDueAt && draft.plannedStartAt > draft.plannedDueAt) {
    throw new Error('A data planejada de início precisa ser anterior ou igual à data de entrega.');
  }
  return {
    name, instructions, acceptance, area: draft.area, repositoryId: draft.repositoryId,
    featureId: draft.featureId || null, type: draft.type, priority: draft.priority,
    dependencies: draft.dependencies, ...(draft.responsible.trim() ? { responsible: draft.responsible.trim() } : {}),
    ...(draft.plannedStartAt ? { plannedStartAt: draft.plannedStartAt } : {}),
    ...(draft.plannedDueAt ? { plannedDueAt: draft.plannedDueAt } : {})
  };
}

export function submitNewTask(token: string, projectId: string, draft: NewTaskDraft): Promise<Task> {
  return request<Task>(token, '/admin/tasks', {
    body: { operationId: operationId(), projectId, data: createTaskDataFromDraft(draft) }
  });
}
