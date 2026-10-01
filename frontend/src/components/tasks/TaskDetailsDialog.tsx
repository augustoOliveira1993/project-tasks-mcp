import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, operationId, query, request } from '../../api';
import type { Task } from '../../api';
import { markTaskReadIfUnread, type TaskUnreadState } from '../../features/tasks/task-read';
import { Badge } from '../ui/Badge';
import { errorMessage, formatDate } from '../../lib/format';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { MarkdownView } from '../ui/MarkdownView';
import { TaskSummaryPanel } from './TaskSummaryPanel';
import { openTaskConversation } from '../../features/tasks/task-conversation';

type TaskDiff = { _id: string; commit?: string; branch?: string; files?: string[]; at?: string; createdAt?: string };
type TaskMarkdown = { _id: string; name: string; summary: string; revision: number };
type TaskReadAttempt = { taskId: string; cursor: number; operationId: string };

export function TaskDetailsDialog({ token, nonce, projectId, task, checking, onToggleChecked, onOpenConversation, close }: { token: string; nonce: string; projectId: string; task: Task; checking: boolean; onToggleChecked: (task: Task) => void; onOpenConversation: (conversationId: string) => void; close: () => void }) {
  const [markdown, setMarkdown] = useState<{ name: string; content: string } | null>(null);
  const [view, setView] = useState<'details' | 'summary' | 'json'>('details');
  const [criterionEvidence, setCriterionEvidence] = useState<Record<number, string>>({});
  const [savingCriterion, setSavingCriterion] = useState<number | null>(null);
  const [criterionFeedback, setCriterionFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const queryClient = useQueryClient();
  const readAttempt = useRef<TaskReadAttempt | null>(null);
  const context = useQuery({
    queryKey: ['task-context', nonce, task._id],
    queryFn: () => query<Record<string, any>>(token, 'get_task_context', { projectId, taskId: task._id })
  });
  const activityReport = useQuery({
    queryKey: ['project-sync-report', nonce, projectId, task.featureId ?? undefined],
    queryFn: () => query<{ tasks: Array<{ taskId: string; unread: TaskUnreadState }> }>(token, 'get_project_sync_report', { projectId, ...(task.featureId ? { featureId: task.featureId } : {}) })
  });
  const unreadActivity = activityReport.data?.tasks.find(item => item.taskId === task._id)?.unread;
  const markRead = useMutation({
    mutationFn: (attempt: TaskReadAttempt) => markTaskReadIfUnread({
      token, projectId, taskId: task._id,
      unread: { count: 1, cursor: attempt.cursor },
      operationId: attempt.operationId
    }, () => queryClient.invalidateQueries({ queryKey: ['project-sync-report', nonce, projectId] }))
  });
  const markReadAutomatically = useCallback((unread: TaskUnreadState | undefined) => {
    if (!unread || unread.count <= 0 || unread.cursor === null) return;
    const previous = readAttempt.current;
    if (previous?.taskId === task._id && previous.cursor === unread.cursor) return;
    const attempt = { taskId: task._id, cursor: unread.cursor, operationId: operationId() };
    readAttempt.current = attempt;
    markRead.mutate(attempt);
  }, [markRead.mutate, task._id]);
  useEffect(() => {
    readAttempt.current = null;
    markRead.reset();
  }, [markRead.reset, task._id]);
  useEffect(() => {
    markReadAutomatically(unreadActivity);
  }, [markReadAutomatically, unreadActivity?.count, unreadActivity?.cursor]);
  const diffs = useQuery({
    queryKey: ['task-diffs', nonce, task._id],
    queryFn: () => query<{ items: TaskDiff[] }>(token, 'list_task_diffs', { projectId, taskId: task._id, limit: 20 })
  });
  const markdowns = useQuery({
    queryKey: ['task-markdowns', nonce, task._id],
    queryFn: () => query<{ items: TaskMarkdown[] }>(token, 'list_markdowns', { projectId, targetKind: 'task', targetId: task._id, limit: 20 })
  });
  const openConversation = useMutation({
    mutationFn: () => openTaskConversation(token, projectId, task._id),
    onSuccess: async result => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations', nonce, projectId] }),
        queryClient.invalidateQueries({ queryKey: ['task-markdown-summary', nonce, projectId, task._id] })
      ]);
      onOpenConversation(result.conversation._id);
    }
  });
  const taskData = context.data?.task ?? task;
  const acceptance = taskData.acceptance ?? task.acceptance ?? [];
  const acceptanceProgress = acceptance.map((_item: string, index: number) => taskData.acceptanceProgress?.[index] === true);
  const completedCriteria = acceptanceProgress.filter(Boolean).length;

  async function updateCriterion(criterionIndex: number, complete: boolean) {
    const evidence = (criterionEvidence[criterionIndex] ?? taskData.acceptanceEvidence?.[criterionIndex] ?? '').trim();
    if (!evidence) {
      setCriterionFeedback({ kind: 'error', message: `Informe uma evidência objetiva para ${complete ? 'marcar' : 'desmarcar'} este critério.` });
      return;
    }
    setSavingCriterion(criterionIndex);
    setCriterionFeedback(null);
    try {
      const result = await request<{ task: Task }>(token, '/admin/tasks/acceptance', { body: {
        operationId: operationId(), projectId, taskId: task._id, version: taskData.version,
        criterionIndex, complete, evidence
      } });
      const acceptanceEvidence = [...(taskData.acceptanceEvidence ?? Array.from({ length: acceptance.length }, () => null))];
      acceptanceEvidence[criterionIndex] = complete ? evidence : null;
      const updatedTask = { ...result.task, acceptanceEvidence };
      queryClient.setQueryData<Record<string, any>>(['task-context', nonce, task._id], current => current ? { ...current, task: updatedTask } : current);
      queryClient.setQueryData<Task[]>(['project-tasks', nonce, projectId], current => current?.map(item => item._id === task._id ? { ...item, version: result.task.version, acceptanceProgress: result.task.acceptanceProgress } : item));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] }),
        queryClient.invalidateQueries({ queryKey: ['task-markdown-summary', nonce, projectId, task._id] })
      ]);
      setCriterionFeedback({ kind: 'success', message: 'Critério atualizado; o resumo Markdown foi sincronizado.' });
    } catch (error) {
      const conflict = error instanceof ApiRequestError && error.status === 409;
      setCriterionFeedback({ kind: 'error', message: conflict ? 'A tarefa mudou em outra ação. Recarreguei o contexto; revise o critério antes de tentar novamente.' : errorMessage(error) });
      await Promise.all([
        context.refetch(),
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] }),
        queryClient.invalidateQueries({ queryKey: ['task-markdown-summary', nonce, projectId, task._id] })
      ]);
    } finally {
      setSavingCriterion(null);
    }
  }

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
        <div className="detail-meta"><Badge tone={statusTone[taskData.status]}>Status · {statusLabels[taskData.status] ?? taskData.status}</Badge><Badge tone="blue">Área · {taskData.area || 'Não definida'}</Badge>{context.data?.feature?.name && <Badge tone="muted">Feature · {context.data.feature.name}</Badge>}<span>Responsável: {taskData.responsible || 'Não atribuído'}</span><span>Atualizada: {formatDate(taskData.updatedAt)}</span><span>Prioridade: {taskData.priority ?? '—'}</span></div>
        {taskData.status === 'concluida' && <section className="detail-check-panel" aria-label="Conferência da tarefa">
          <div className="detail-check-copy"><Badge tone={taskData.checked ? 'green' : 'amber'}>{taskData.checked ? 'Conferida' : 'Não conferida'}</Badge><span>{taskData.checked ? 'por ' + (taskData.checkedBy || 'Usuário') + ' · ' + formatDate(taskData.checkedAt) : 'Marque após validar a tarefa.'}</span></div>
          <button type="button" className="button secondary small-button" disabled={checking} aria-pressed={Boolean(taskData.checked)} onClick={() => onToggleChecked(taskData as Task)}>{checking ? 'Salvando…' : taskData.checked ? 'Desmarcar' : 'Marcar como conferida'}</button>
        </section>}
        <div className="detail-toolbar"><div className="button-row"><button type="button" className="button secondary small-button" disabled={openConversation.isPending} onClick={() => openConversation.mutate()}>{openConversation.isPending ? 'Abrindo…' : 'Abrir conversa'}</button><button className="text-button" aria-pressed={view === 'summary'} onClick={() => setView(current => current === 'summary' ? 'details' : 'summary')}>{view === 'summary' ? 'Voltar aos detalhes' : 'Resumo completo'}</button><button className="text-button" onClick={() => setView(current => current === 'json' ? 'details' : 'json')}>{view === 'json' ? 'Ver detalhes' : 'Ver JSON'}</button></div></div>
        {openConversation.isError && <div className="notice error" role="alert">{errorMessage(openConversation.error)}</div>}
        {view === 'json' ? <pre className="markdown-content json-content">{JSON.stringify(context.data, null, 2)}</pre> : view === 'summary' ? <div className="detail-summary-layout"><TaskSummaryPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} onOpenConversation={onOpenConversation} /></div> : <div className="detail-columns">
          <div className="detail-main">
            <section className="detail-section task-description-section"><h3>Descrição</h3>{taskData.description || taskData.instructions ? <MarkdownView content={taskData.description || taskData.instructions} /> : <p className="muted-text">Sem descrição cadastrada.</p>}</section>
            <section className="detail-section"><div className="criteria-heading"><h3>Critérios de aceite</h3>{acceptance.length > 0 && <span>{completedCriteria}/{acceptance.length} concluídos</span>}</div>
              {acceptance.length ? <>
                <div className="criteria-progress" role="progressbar" aria-label="Critérios de aceite concluídos" aria-valuenow={completedCriteria} aria-valuemin={0} aria-valuemax={acceptance.length}><span style={{ width: `${Math.round(completedCriteria * 100 / acceptance.length)}%` }} /></div>
                {savingCriterion !== null && <p className="notice" role="status">Salvando critério…</p>}
                {criterionFeedback && <p className={`notice ${criterionFeedback.kind === 'error' ? 'error' : ''}`} role={criterionFeedback.kind === 'error' ? 'alert' : 'status'}>{criterionFeedback.message}</p>}
                <ul className="criteria">{acceptance.map((item: string, index: number) => <li className="criteria-item" key={index}>
                  <div className="criteria-item-heading"><label className="criteria-check-label"><input className="criterion-toggle" type="checkbox" checked={acceptanceProgress[index]} disabled={savingCriterion !== null} aria-label={`${acceptanceProgress[index] ? 'Desmarcar' : 'Marcar'} critério ${index + 1}`} onChange={event => void updateCriterion(index, event.currentTarget.checked)} /><span>{item}</span></label>{acceptanceProgress[index] && <span className="criterion-complete">Atendido</span>}</div>
                  <label className="criterion-evidence"><span>{acceptanceProgress[index] ? 'Observação do critério atendido' : 'Evidência objetiva'}</span><textarea rows={2} value={criterionEvidence[index] ?? taskData.acceptanceEvidence?.[index] ?? ''} disabled={savingCriterion !== null || acceptanceProgress[index]} placeholder={acceptanceProgress[index] ? 'Critério atendido sem observação registrada.' : 'Descreva como este critério foi validado.'} onChange={event => setCriterionEvidence(current => ({ ...current, [index]: event.target.value }))} /></label>
                </li>)}</ul>
              </> : <p className="muted-text">Nenhum critério cadastrado.</p>}
            </section>
            {markdown && <section className="detail-section"><div className="section-heading"><h3>{markdown.name}</h3><div className="button-row"><button className="text-button" onClick={() => void copyMarkdown()}>Copiar</button><button className="text-button" onClick={() => setMarkdown(null)}>Fechar</button></div></div><div className="markdown-document-view"><MarkdownView content={markdown.content} /></div></section>}
            <section className="detail-section"><h3>Planejamento Markdown</h3>{markdowns.isPending ? <p className="muted-text">Carregando documentos…</p> : markdowns.isError ? <p className="notice error">{errorMessage(markdowns.error)}</p> : markdowns.data?.items?.length ? <div className="resource-list">{markdowns.data.items.map(item => <button className="resource-row" key={item._id} onClick={() => void openMarkdown(item)}><span><strong>{item.name}</strong><small>{item.summary}</small></span><Badge>rev. {item.revision}</Badge></button>)}</div> : <p className="muted-text">Nenhum documento vinculado.</p>}</section>
          </div>
          <aside className="detail-aside"><section className="detail-section"><h3>Execução</h3><dl className="facts"><dt>Tipo</dt><dd>{taskData.type ?? '—'}</dd><dt>Criada</dt><dd>{formatDate(taskData.createdAt)}</dd><dt>Prazo da execução</dt><dd>{formatDate(taskData.leaseUntil)}</dd></dl></section>
            <section className="detail-section"><h3>Diffs publicados</h3>{diffs.isPending ? <p className="muted-text">Carregando…</p> : diffs.isError ? <p className="notice error">{errorMessage(diffs.error)}</p> : diffs.data?.items?.length ? <div className="resource-list">{diffs.data.items.map(diff => <div className="resource-row static-row" key={diff._id}><span><strong>{diff.branch || 'Commit ' + (diff.commit ?? '').slice(0, 8)}</strong><small>{(diff.files ?? []).length} arquivo(s) · {formatDate(diff.at ?? diff.createdAt)}</small></span><Badge>{(diff.commit ?? '').slice(0, 7) || 'diff'}</Badge></div>)}</div> : <p className="muted-text">Nenhum diff registrado.</p>}</section>
          </aside>
        </div>}
      </>}
      {markRead.isPending && <p className="notice" role="status">Marcando atividades como lidas…</p>}
      {markRead.isSuccess && markRead.data && <p className="notice" role="status">Atividades marcadas como lidas.</p>}
      {markRead.isError && <div className="notice error" role="alert"><span>Não foi possível marcar as atividades como lidas: {errorMessage(markRead.error)}</span><button className="text-button" disabled={markRead.isPending} onClick={() => { const attempt = readAttempt.current; if (attempt?.taskId === task._id) markRead.mutate(attempt); }}>Tentar novamente</button></div>}
      <footer className="dialog-footer"><button className="button secondary" onClick={close}>Fechar</button></footer>
    </section>
  </div>;
}
