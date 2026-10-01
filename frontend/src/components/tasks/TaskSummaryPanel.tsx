import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownModeView } from '../ui/MarkdownModeView';

type TaskSummary = {
  markdown: string;
  generatedAt?: string;
  linkedConversations?: Array<{ conversationId: string; title: string; lastActivityAt?: string; messageCount: number }>;
};

export function TaskSummaryPanel({ token, nonce, projectId, taskId, onOpenConversation = () => {} }: { token: string; nonce: string; projectId: string; taskId: string; onOpenConversation?: (conversationId: string) => void }) {
  const summary = useQuery({
    queryKey: ['task-markdown-summary', nonce, projectId, taskId],
    queryFn: () => query<TaskSummary>(token, 'get_task_markdown_summary', { projectId, taskId })
  });

  return <section className="task-summary-panel">
    <div className="task-summary-panel-heading"><div><h3>Resumo completo da tarefa</h3><p>Critérios de aceite, dependências, execução, mensagens e documentos.</p></div>{summary.data?.generatedAt && <small>Gerado em {formatDate(summary.data.generatedAt)}</small>}</div>
    {summary.isPending ? <div className="loading">Gerando resumo…</div> : summary.isError ? <div className="notice error"><span>{errorMessage(summary.error)}</span><button className="text-button" onClick={() => void summary.refetch()}>Tentar novamente</button></div> : <MarkdownModeView content={summary.data.markdown} emptyMessage="Nenhum resumo disponível para esta tarefa." label="Modo do resumo da tarefa" />}
    {summary.data?.linkedConversations?.length ? <section className="task-summary-conversations" aria-label="Conversas vinculadas à tarefa">
      <h4>Conversas vinculadas</h4>
      <div>{summary.data.linkedConversations.map(conversation => <button type="button" className="task-summary-conversation" key={conversation.conversationId} aria-label={`Abrir conversa ${conversation.title}`} onClick={() => onOpenConversation(conversation.conversationId)}><span><strong>{conversation.title}</strong><small>Atividade · {formatDate(conversation.lastActivityAt)}</small></span><span className="task-summary-conversation-action">Abrir</span></button>)}</div>
    </section> : null}
  </section>;
}
