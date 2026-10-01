import { operationId, request } from '../../api';

export type OpenTaskConversationResult = { conversation: { _id: string; title?: string; taskId: string }; created: boolean };

export function openTaskConversation(token: string, projectId: string, taskId: string) {
  return request<OpenTaskConversationResult>(token, `/admin/tasks/${taskId}/conversation`, {
    body: { operationId: operationId(), projectId }
  });
}
