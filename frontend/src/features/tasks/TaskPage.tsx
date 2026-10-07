import type { ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import type { Task } from '../../api';
import { TaskDetailsContent } from '../../components/tasks/TaskDetailsContent';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { buttonSecondary } from '../../components/ui/classes';
import { Skeleton } from '../../components/ui/Skeleton';

type ContentProps = ComponentProps<typeof TaskDetailsContent>;

const pageState = 'grid justify-items-start gap-4 p-6';

/**
 * Página dedicada de uma tarefa (`/tasks/:id`). Carrega a tarefa por `get_task_context`,
 * sem depender de ela estar na lista já carregada do projeto.
 */
export function TaskPage({ taskId, ...rest }: Omit<ContentProps, 'variant' | 'task' | 'initialAction' | 'onOpenPage'> & { taskId: string }) {
  const { token, nonce, projectId, close } = rest;
  const context = useQuery({
    queryKey: ['task-context', nonce, projectId, taskId],
    queryFn: () => query<Record<string, any>>(token, 'get_task_context', { projectId, taskId })
  });
  const task = context.data?.task as Task | undefined;

  if (context.isPending) return <div className={pageState}><Skeleton rows={8} label="Carregando a tarefa…" /></div>;
  if (context.isError || !task) return <div className={pageState}>
    <ErrorNotice error={context.error ?? new Error('Tarefa não encontrada neste projeto.')} onRetry={() => void context.refetch()} retrying={context.isFetching} title="Não foi possível carregar a tarefa" />
    <button type="button" className={buttonSecondary} onClick={close}>Voltar às tarefas</button>
  </div>;
  return <TaskDetailsContent key={task._id} variant="page" task={task} {...rest} />;
}
