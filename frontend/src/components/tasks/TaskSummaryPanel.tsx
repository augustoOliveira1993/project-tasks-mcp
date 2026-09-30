import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownModeView } from '../ui/MarkdownModeView';

type TaskSummary = { markdown: string; generatedAt?: string };

export function TaskSummaryPanel({ token, nonce, projectId, taskId }: { token: string; nonce: string; projectId: string; taskId: string }) {
  const summary = useQuery({
    queryKey: ['task-markdown-summary', nonce, projectId, taskId],
    queryFn: () => query<TaskSummary>(token, 'get_task_markdown_summary', { projectId, taskId })
  });

  return <section className="task-summary-panel">
    <div className="task-summary-panel-heading"><div><h3>Resumo completo da tarefa</h3><p>Critérios de aceite, dependências, execução, mensagens e documentos.</p></div>{summary.data?.generatedAt && <small>Gerado em {formatDate(summary.data.generatedAt)}</small>}</div>
    {summary.isPending ? <div className="loading">Gerando resumo…</div> : summary.isError ? <div className="notice error"><span>{errorMessage(summary.error)}</span><button className="text-button" onClick={() => void summary.refetch()}>Tentar novamente</button></div> : <MarkdownModeView content={summary.data.markdown} emptyMessage="Nenhum resumo disponível para esta tarefa." label="Modo do resumo da tarefa" />}
  </section>;
}
