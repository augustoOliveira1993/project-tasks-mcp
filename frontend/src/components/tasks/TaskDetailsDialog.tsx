import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import type { Task } from '../../api';
import { Badge } from '../ui/Badge';
import { errorMessage, formatDate } from '../../lib/format';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { MarkdownView } from '../ui/MarkdownView';
import { TaskSummaryPanel } from './TaskSummaryPanel';

type TaskDiff = { _id: string; commit?: string; branch?: string; files?: string[]; at?: string; createdAt?: string };
type TaskMarkdown = { _id: string; name: string; summary: string; revision: number };

export function TaskDetailsDialog({ token, nonce, projectId, task, checking, onToggleChecked, close }: { token: string; nonce: string; projectId: string; task: Task; checking: boolean; onToggleChecked: (task: Task) => void; close: () => void }) {
  const [markdown, setMarkdown] = useState<{ name: string; content: string } | null>(null);
  const [view, setView] = useState<'details' | 'summary' | 'json'>('details');
  const context = useQuery({
    queryKey: ['task-context', nonce, task._id],
    queryFn: () => query<Record<string, any>>(token, 'get_task_context', { projectId, taskId: task._id })
  });
  const diffs = useQuery({
    queryKey: ['task-diffs', nonce, task._id],
    queryFn: () => query<{ items: TaskDiff[] }>(token, 'list_task_diffs', { projectId, taskId: task._id, limit: 20 })
  });
  const markdowns = useQuery({
    queryKey: ['task-markdowns', nonce, task._id],
    queryFn: () => query<{ items: TaskMarkdown[] }>(token, 'list_markdowns', { projectId, targetKind: 'task', targetId: task._id, limit: 20 })
  });
  const taskData = context.data?.task ?? task;

  async function openMarkdown(item: TaskMarkdown) {
    const result = await query<{ content: string }>(token, 'get_markdown', { projectId, id: item._id, revision: item.revision, line: 1, limit: 200 });
    setMarkdown({ name: item.name, content: result.content });
  }

  async function copyMarkdown() {
    if (!markdown) return;
    try { await navigator.clipboard.writeText(markdown.content); }
    catch { /* clipboard availability depends on browser permissions */ }
  }

  return <div className="overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <header className="dialog-header"><div><p className="eyebrow">TAREFA · {task.area ?? 'sem área'}</p><h2 id="details-title">{task.name}</h2><p className="muted-text id-text">{task._id}</p></div><button className="icon-button" onClick={close} aria-label="Fechar detalhes">×</button></header>
      {context.isPending ? <div className="loading">Carregando contexto…</div> : context.isError ? <div className="notice error">{errorMessage(context.error)}</div> : <>
        <div className="detail-meta"><Badge tone={statusTone[taskData.status]}>{statusLabels[taskData.status] ?? taskData.status}</Badge><span>Responsável: {taskData.responsible || 'Não atribuído'}</span><span>Atualizada: {formatDate(taskData.updatedAt)}</span><span>Prioridade: {taskData.priority ?? '—'}</span></div>
        {taskData.status === 'concluida' && <section className="detail-check-panel" aria-label="Conferência da tarefa">
          <div className="detail-check-copy"><Badge tone={taskData.checked ? 'green' : 'amber'}>{taskData.checked ? 'Conferida' : 'Não conferida'}</Badge><span>{taskData.checked ? 'por ' + (taskData.checkedBy || 'Usuário') + ' · ' + formatDate(taskData.checkedAt) : 'Marque após validar a tarefa.'}</span></div>
          <button type="button" className="button secondary small-button" disabled={checking} aria-pressed={Boolean(taskData.checked)} onClick={() => onToggleChecked(taskData as Task)}>{checking ? 'Salvando…' : taskData.checked ? 'Desmarcar' : 'Marcar como conferida'}</button>
        </section>}
        <div className="detail-toolbar"><div className="button-row"><button className="text-button" aria-pressed={view === 'summary'} onClick={() => setView(current => current === 'summary' ? 'details' : 'summary')}>{view === 'summary' ? 'Voltar aos detalhes' : 'Resumo completo'}</button><button className="text-button" onClick={() => setView(current => current === 'json' ? 'details' : 'json')}>{view === 'json' ? 'Ver detalhes' : 'Ver JSON'}</button></div></div>
        {view === 'json' ? <pre className="markdown-content json-content">{JSON.stringify(context.data, null, 2)}</pre> : view === 'summary' ? <div className="detail-summary-layout"><TaskSummaryPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} /></div> : <div className="detail-columns">
          <div className="detail-main">
            <section className="detail-section task-description-section"><h3>Descrição</h3>{taskData.description || taskData.instructions ? <MarkdownView content={taskData.description || taskData.instructions} /> : <p className="muted-text">Sem descrição cadastrada.</p>}</section>
            <section className="detail-section"><h3>Critérios de aceite</h3>{(taskData.acceptance ?? task.acceptance ?? []).length ? <ul className="criteria">{(taskData.acceptance ?? task.acceptance ?? []).map((item: string, index: number) => <li key={index}><span className={taskData.acceptanceProgress?.[index] ? 'criterion-check checked' : 'criterion-check'}>{taskData.acceptanceProgress?.[index] ? '✓' : '·'}</span>{item}</li>)}</ul> : <p className="muted-text">Nenhum critério cadastrado.</p>}</section>
            {markdown && <section className="detail-section"><div className="section-heading"><h3>{markdown.name}</h3><div className="button-row"><button className="text-button" onClick={() => void copyMarkdown()}>Copiar</button><button className="text-button" onClick={() => setMarkdown(null)}>Fechar</button></div></div><div className="markdown-document-view"><MarkdownView content={markdown.content} /></div></section>}
            <section className="detail-section"><h3>Planejamento Markdown</h3>{markdowns.isPending ? <p className="muted-text">Carregando documentos…</p> : markdowns.isError ? <p className="notice error">{errorMessage(markdowns.error)}</p> : markdowns.data?.items?.length ? <div className="resource-list">{markdowns.data.items.map(item => <button className="resource-row" key={item._id} onClick={() => void openMarkdown(item)}><span><strong>{item.name}</strong><small>{item.summary}</small></span><Badge>rev. {item.revision}</Badge></button>)}</div> : <p className="muted-text">Nenhum documento vinculado.</p>}</section>
          </div>
          <aside className="detail-aside"><section className="detail-section"><h3>Execução</h3><dl className="facts"><dt>Tipo</dt><dd>{taskData.type ?? '—'}</dd><dt>Criada</dt><dd>{formatDate(taskData.createdAt)}</dd><dt>Prazo da execução</dt><dd>{formatDate(taskData.leaseUntil)}</dd></dl></section>
            <section className="detail-section"><h3>Diffs publicados</h3>{diffs.isPending ? <p className="muted-text">Carregando…</p> : diffs.isError ? <p className="notice error">{errorMessage(diffs.error)}</p> : diffs.data?.items?.length ? <div className="resource-list">{diffs.data.items.map(diff => <div className="resource-row static-row" key={diff._id}><span><strong>{diff.branch || 'Commit ' + (diff.commit ?? '').slice(0, 8)}</strong><small>{(diff.files ?? []).length} arquivo(s) · {formatDate(diff.at ?? diff.createdAt)}</small></span><Badge>{(diff.commit ?? '').slice(0, 7) || 'diff'}</Badge></div>)}</div> : <p className="muted-text">Nenhum diff registrado.</p>}</section>
          </aside>
        </div>}
      </>}
      <footer className="dialog-footer"><button className="button secondary" onClick={close}>Fechar</button></footer>
    </section>
  </div>;
}
