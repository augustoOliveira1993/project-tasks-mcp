import type { ComponentProps } from 'react';
import { TaskDetailsContent } from './TaskDetailsContent';

export type { TaskDetailsAction, TaskReviewDecision } from './TaskDetailsContent';

/** Drawer lateral com os detalhes da tarefa; o conteúdo é o mesmo da página `/tasks/:id`. */
export function TaskDetailsDialog(props: Omit<ComponentProps<typeof TaskDetailsContent>, 'variant'>) {
  return <TaskDetailsContent variant="drawer" {...props} />;
}
