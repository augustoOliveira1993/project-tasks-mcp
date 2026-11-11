import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { errorMessage } from '../../lib/format';
import { MarkdownView, type MarkdownVariant } from '../ui/MarkdownView';

type TaskMessagePreview = { _id: string; message: string; truncated?: boolean };

/** Renders task-message Markdown and fetches the persisted body when the context is abbreviated. */
export function TaskMessageBody({ token, nonce, projectId, taskId, message, variant = 'default' }: {
  token: string;
  nonce: string;
  projectId: string;
  taskId: string;
  message: TaskMessagePreview;
  variant?: MarkdownVariant;
}) {
  const needsFullBody = message.truncated === true;
  const canFetch = Boolean(token && projectId && taskId && message._id);
  const completeMessage = useQuery({
    queryKey: ['task-message-full', nonce, projectId, taskId, message._id],
    enabled: needsFullBody && canFetch,
    retry: false,
    queryFn: async () => {
      const result = await query<{ items: Array<{ _id: string; message: string }> }>(token, 'list_task_messages', {
        projectId,
        taskId,
        messageId: message._id,
        limit: 1
      });
      const full = result.items.find(item => item._id === message._id);
      if (!full) throw new Error('A mensagem não foi encontrada nesta tarefa.');
      return full.message;
    }
  });

  const content = needsFullBody ? completeMessage.data ?? message.message : message.message;

  return <>
    <MarkdownView content={content} variant={variant} />
    {needsFullBody && !completeMessage.data && <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-strong" aria-live="polite">
      {!canFetch
        ? <span role="status">Esta mensagem foi abreviada e o conteúdo completo não está disponível neste painel.</span>
        : completeMessage.isPending
          ? <span role="status">Carregando mensagem completa…</span>
          : completeMessage.isError
            ? <>
              <span role="alert">Falha ao carregar a mensagem completa. {errorMessage(completeMessage.error)}</span>
              <button type="button" className="font-semibold text-tone-blue underline underline-offset-2 disabled:opacity-50" disabled={completeMessage.isFetching} onClick={() => void completeMessage.refetch()}>
                {completeMessage.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}
              </button>
            </>
            : <span role="status">Esta mensagem foi abreviada; exibindo o trecho disponível.</span>}
    </div>}
  </>;
}
