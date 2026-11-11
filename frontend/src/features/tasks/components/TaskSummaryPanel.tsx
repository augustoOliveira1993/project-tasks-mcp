import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownModeView } from '../ui/MarkdownModeView';
import { notice, textButton } from '../ui/classes';

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

  return <section className="rounded-ui-md border border-[#e3e7f3] bg-[#fbfcff] p-[18px]">
    <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="mb-[5px] font-display text-[13px] leading-[normal] font-bold text-[#36445a]">Resumo completo da tarefa</h3><p className="text-[9px] leading-[1.5] text-[#7f8a9b]">Critérios de aceite, dependências, execução, mensagens e documentos.</p></div>{summary.data?.generatedAt && <small className="text-[9px] leading-[1.5] text-[#7f8a9b]">Gerado em {formatDate(summary.data.generatedAt)}</small>}</div>
    {summary.isPending ? <div className="px-[18px] py-7 text-center text-[11px] text-[#8792a2]">Gerando resumo…</div> : summary.isError ? <div className={notice.error}><span>{errorMessage(summary.error)}</span><button className={textButton} onClick={() => void summary.refetch()}>Tentar novamente</button></div> : <MarkdownModeView content={summary.data.markdown} emptyMessage="Nenhum resumo disponível para esta tarefa." label="Modo do resumo da tarefa" />}
    {summary.data?.linkedConversations?.length ? <section className="mb-3.5 grid gap-2 rounded-[9px] border border-[#e4e8f2] bg-white p-[11px]" aria-label="Conversas vinculadas à tarefa">
      <h4 className="text-[10px] font-bold text-[#46536a]">Conversas vinculadas</h4>
      <div className="grid gap-1.5">{summary.data.linkedConversations.map(conversation => <button type="button" className="flex w-full items-center justify-between gap-3 rounded-[7px] border border-[#e8ebf2] bg-[#fbfcff] px-[9px] py-2 text-left text-[#48566d] hover:border-[#b9c4f7] hover:bg-[#f6f7ff]" key={conversation.conversationId} aria-label={`Abrir conversa ${conversation.title}`} onClick={() => onOpenConversation(conversation.conversationId)}><span className="grid min-w-0 gap-[3px]"><strong className="text-[10px] wrap-anywhere">{conversation.title}</strong><small className="text-[9px] text-[#8993a2]">Atividade · {formatDate(conversation.lastActivityAt)}</small></span><span className="text-[9px] font-bold text-[#5364d3]">Abrir</span></button>)}</div>
    </section> : null}
  </section>;
}
