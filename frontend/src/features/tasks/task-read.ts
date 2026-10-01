import { request } from '../../api';

export type TaskUnreadState = { count: number; cursor: number | null };

export async function markTaskReadIfUnread(input: {
  token: string;
  projectId: string;
  taskId: string;
  unread: TaskUnreadState;
  operationId: string;
}, onMarkedRead: () => Promise<unknown>): Promise<boolean> {
  if (input.unread.count <= 0 || input.unread.cursor === null) return false;
  await request(input.token, '/admin/tasks/read', {
    body: {
      operationId: input.operationId,
      projectId: input.projectId,
      taskId: input.taskId,
      cursor: input.unread.cursor
    }
  });
  await onMarkedRead();
  return true;
}
