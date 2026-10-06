import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, ApiRequestError, operationId, query, request } from '../../api';
import type { Project, Task } from '../../api';
import { markTaskReadIfUnread, type TaskUnreadState } from '../../features/tasks/task-read';
import { Badge } from '../ui/Badge';
import { DropdownMenu } from '../ui/DropdownMenu';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconAlert, IconCheck, IconClose, IconCopy, IconFeature, IconMore } from '../ui/icons';
import { ConversationLink, FeatureLink, FilterLink, TaskLink } from '../ui/Links';
import { AssigneePicker } from '../ui/AssigneePicker';
import { Person } from '../ui/Person';
import { useAssignees } from '../../features/tasks/assignees';
import { Skeleton } from '../ui/Skeleton';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage, formatDate } from '../../lib/format';
import { areaLabel, plural, priorityInfo, relativeTime, shortId, typeLabel } from '../../lib/labels';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { MarkdownView } from '../ui/MarkdownView';
import { TaskSummaryPanel } from './TaskSummaryPanel';
import { TaskEditorDialog } from './TaskEditorDialog';
import { TaskDiffsPanel, type TaskDiffSummary } from './TaskDiffsPanel';
import { TaskCriteriaPanel } from './TaskCriteriaPanel';
import { TaskTimeline, type StatusHistoryEntry } from './TaskTimeline';
import { TaskActivityPanel, type TaskActivityEvent } from './TaskActivityPanel';
import { routeUrl } from '../../route-state';
import { openTaskConversation } from '../../features/tasks/task-conversation';

type Feature = { _id: string; name: string };
export type TaskDetailsAction = 'details' | 'edit' | 'summary' | 'json' | 'criteria' | 'assign';
export type TaskReviewDecision = 'approve' | 'return' | 'unblock';
type TaskDiff = TaskDiffSummary;
type TaskMarkdown = { _id: string; name: string; summary: string; revision: number };
type TaskReadAttempt = { taskId: string; cursor: number; operationId: string };
type TaskMessage = { _id: string; type: string; author: string; authorType?: string; clientName?: string | null; message: string; createdAt: string };
type Tab = 'summary' | 'criteria' | 'planning' | 'diffs' | 'activity' | 'conversation';

const reviewCopy: Record<TaskReviewDecision, { title: string; confirm: string; reasonLabel: string; required: boolean; hint: string; tone: string }> = {
  approve: { title: 'Aprovar e concluir a tarefa', confirm: 'Aprovar e concluir', reasonLabel: 'Observação da aprovação (opcional)', required: false, hint: 'A tarefa vai para “Concluída”. Depois você ainda pode marcá-la como conferida.', tone: 'primary' },
  return: { title: 'Devolver para ajustes', confirm: 'Devolver para pendente', reasonLabel: 'O que precisa ser ajustado?', required: true, hint: 'A tarefa volta para “Pendente” com o motivo registrado, e o agente poderá assumi-la de novo.', tone: 'danger-button' },
  unblock: { title: 'Desbloquear a tarefa', confirm: 'Voltar para pendente', reasonLabel: 'Como o bloqueio foi resolvido?', required: true, hint: 'A tarefa volta para “Pendente” e fica disponível para ser assumida.', tone: 'primary' }
};

const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export function TaskDetailsDialog({ token, nonce, projectId, project, tasks, task, initialAction = 'details', checking, notify, onToggleChecked, onOpenConversation, onRequestTransfer, onReview, onChangeStatus, systemAdmin = false, close }: {
  systemAdmin?: boolean;
  token: string; nonce: string; projectId: string; project: Project; tasks: Task[]; task: Task; initialAction?: TaskDetailsAction; checking: boolean;
  notify: (message: string, kind?: string) => void; onToggleChecked: (task: Task) => void; onOpenConversation: (conversationId: string) => void;
  onRequestTransfer: (task: Task) => void; onReview?: (task: Task, decision: TaskReviewDecision, reason: string) => Promise<boolean>; onChangeStatus?: (task: Task) => void; close: () => void;
}) {
  const [markdown, setMarkdown] = useState<{ name: string; content: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(initialAction === 'edit');
  const [tab, setTab] = useState<Tab>(initialAction === 'assign' ? 'summary' : initialAction === 'criteria' || task.status === 'em_revisao' ? 'criteria' : 'summary');
  const [special, setSpecial] = useState<'full' | 'json' | null>(initialAction === 'summary' ? 'full' : initialAction === 'json' ? 'json' : null);
  const [review, setReview] = useState<TaskReviewDecision | null>(null);
  const [assigning, setAssigning] = useState(initialAction === 'assign');
  const [assignee, setAssignee] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [savingCriterion, setSavingCriterion] = useState<number | null>(null);
  const [criterionFeedback, setCriterionFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const queryClient = useQueryClient();
  const readAttempt = useRef<TaskReadAttempt | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const reviewRef = useRef(review);
  reviewRef.current = review;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Foco: entra na gaveta, prende o Tab nela e devolve o foco a quem abriu; Esc fecha.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      // Outro diálogo modal (edição, status, transferência) por cima: ele cuida do próprio Esc/Tab.
      const otherDialogOpen = Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')).some(element => element !== dialog);
      if (!dialog || otherDialogOpen) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        if (reviewRef.current) setReview(null);
        else close();
        return;
      }
      if (event.key !== 'Tab' || !dialog.contains(document.activeElement) && document.activeElement !== document.body) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const context = useQuery({
    queryKey: ['task-context', nonce, projectId, task._id],
    queryFn: () => query<Record<string, any>>(token, 'get_task_context', { projectId, taskId: task._id })
  });
  const features = useQuery({
    queryKey: ['project-features', nonce, projectId],
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId, archived: false })
  });
  const activityReport = useQuery({
    queryKey: ['project-sync-report', nonce, projectId, task.featureId ?? undefined],
    queryFn: () => query<{ tasks: Array<{ taskId: string; unread: TaskUnreadState }> }>(token, 'get_project_sync_report', { projectId, ...(task.featureId ? { featureId: task.featureId } : {}) })
  });
  const taskActivity = useQuery({
    queryKey: ['task-activity', nonce, projectId, task._id],
    queryFn: () => query<{ items: TaskActivityEvent[] }>(token, 'list_project_activity', { projectId, taskId: task._id, limit: 50 })
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
    queryKey: ['task-diffs', nonce, projectId, task._id],
    queryFn: () => query<{ items: TaskDiff[] }>(token, 'list_task_diffs', { projectId, taskId: task._id, limit: 20 })
  });
  const markdowns = useQuery({
    queryKey: ['task-markdowns', nonce, projectId, task._id],
    queryFn: () => query<{ items: TaskMarkdown[] }>(token, 'list_markdowns', { projectId, targetKind: 'task', targetId: task._id, limit: 20 })
  });
  const assignees = useAssignees(token, nonce, projectId, systemAdmin);
  const assign = useMutation({
    mutationFn: (responsible: string) => request<Task>(token, '/admin/records/edit', { body: { operationId: operationId(), projectId, kind: 'task', id: task._id, version: taskData.version, data: { responsible } } }),
    onSuccess: async result => {
      setAssigning(false);
      notify(`Responsável atualizado para ${result.responsible ?? 'o novo valor'}.`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task-context', nonce, projectId, task._id] }),
        queryClient.invalidateQueries({ queryKey: ['task-activity', nonce, projectId, task._id] }),
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] })
      ]);
    }
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
  const linkedConversations = useQuery({
    queryKey: ['task-markdown-summary', nonce, projectId, task._id],
    enabled: tab === 'conversation',
    queryFn: () => query<{ linkedConversations?: Array<{ conversationId: string; title: string; lastActivityAt?: string; messageCount: number }> }>(token, 'get_task_markdown_summary', { projectId, taskId: task._id })
  });
  const taskData = (context.data?.task ?? task) as Task & { statusHistory?: StatusHistoryEntry[] };
  const statusHistory = taskData.statusHistory ?? [];
  const contextExecutions: Array<{ _id: string; status: string; startedAt: string; impediments?: string[]; result?: { summary?: string; evidence?: string[] } }> = context.data?.executions ?? [];
  const blockedExecution = contextExecutions.find(execution => execution._id === (taskData as { executionId?: string }).executionId)
    ?? contextExecutions.find(execution => execution.impediments?.length);
  const blockingReasons = (blockedExecution?.impediments ?? []).filter(reason => reason.trim().length > 0);
  const acceptance = taskData.acceptance ?? task.acceptance ?? [];
  const availableFeatures = features.data ?? [];
  const currentFeature = context.data?.feature as Feature | undefined;
  const editorFeatures = currentFeature && !availableFeatures.some(feature => feature._id === currentFeature._id)
    ? [...availableFeatures, { _id: currentFeature._id, name: currentFeature.name }]
    : availableFeatures;
  const acceptanceProgress = acceptance.map((_item: string, index: number) => taskData.acceptanceProgress?.[index] === true);
  const completedCriteria = acceptanceProgress.filter(Boolean).length;
  const messages: TaskMessage[] = context.data?.messages ?? [];
  const dependencies: Array<{ _id: string; name: string; status: string; area?: string }> = context.data?.dependencies ?? [];
  const dependents = tasks.filter(item => item.dependencies?.includes(task._id));
  const diffCount = diffs.data?.items?.length ?? 0;
  const planningCount = markdowns.data?.items?.length ?? 0;
  const status = taskData.status;
  const priority = priorityInfo(taskData.priority);
  const repository = project?.repositories?.find(item => item.id === taskData.repositoryId);

  async function updateCriterion(criterionIndex: number, complete: boolean, evidence: string) {
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
      queryClient.setQueryData<Record<string, any>>(['task-context', nonce, projectId, task._id], current => current ? { ...current, task: updatedTask } : current);
      queryClient.setQueryData<Task[]>(['project-tasks', nonce, projectId], current => current?.map(item => item._id === task._id ? { ...item, version: result.task.version, acceptanceProgress: result.task.acceptanceProgress } : item));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] }),
        queryClient.invalidateQueries({ queryKey: ['task-markdown-summary', nonce, projectId, task._id] })
      ]);
      setCriterionFeedback({ kind: 'success', message: complete ? 'Critério marcado como atendido.' : 'Critério desmarcado.' });
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
    try {
      const result = await query<{ content: string }>(token, 'get_markdown', { projectId, id: item._id, revision: item.revision, line: 1, limit: 200 });
      setMarkdown({ name: item.name, content: result.content });
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function copyText(text: string, message: string) {
    if (await copyToClipboard(text)) notify(message, 'success');
    else notify('Não foi possível copiar automaticamente.', 'error');
  }

  function startReview(decision: TaskReviewDecision) {
    setReview(decision);
    setReviewReason('');
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || !onReview) return;
    const reason = reviewReason.trim();
    if (reviewCopy[review].required && !reason) return;
    setReviewBusy(true);
    try {
      const done = await onReview(taskData as Task, review, reason);
      if (done) {
        setReview(null);
        setReviewReason('');
        await Promise.all([
          context.refetch(),
          taskActivity.refetch(),
          queryClient.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] })
        ]);
      }
    } finally { setReviewBusy(false); }
  }

  function moveTab(event: ReactKeyboardEvent<HTMLButtonElement>, tabs: Array<{ id: Tab }>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].id);
    setSpecial(null);
    document.getElementById(`task-tab-${tabs[next].id}`)?.focus();
  }

  const tabs: Array<{ id: Tab; label: string; count?: string }> = [
    { id: 'summary', label: 'Resumo' },
    { id: 'criteria', label: 'Critérios', count: acceptance.length ? `${completedCriteria}/${acceptance.length}` : undefined },
    { id: 'planning', label: 'Planejamento', count: planningCount ? String(planningCount) : undefined },
    { id: 'diffs', label: 'Diffs', count: diffCount ? String(diffCount) : undefined },
    { id: 'activity', label: 'Atividade' },
    { id: 'conversation', label: 'Conversa', count: messages.length ? String(messages.length) : undefined }
  ];
  const copy = review ? reviewCopy[review] : null;

  return <div className="overlay drawer-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} tabIndex={-1} className="dialog detail-dialog task-drawer" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <header className="drawer-header">
        <div className="drawer-title">
          <p className="eyebrow">TAREFA · {areaLabel(task.area)}</p>
          <h2 id="details-title">{task.name}</h2>
          <div className="drawer-chips">
            <Badge tone={statusTone[status]}>{statusLabels[status] ?? status}</Badge>
            <span className={`priority priority-${priority.tone}`} title={priority.text}>{priority.text}</span>
            {taskData.area ? <FilterLink param="area" value={taskData.area} projectId={projectId} className={`chip chip-area chip-area-${taskData.area} entity-chip`} title={`Filtrar pela área ${areaLabel(taskData.area)}`}>{areaLabel(taskData.area)}</FilterLink> : <span className="chip chip-area chip-area-none">{areaLabel(taskData.area)}</span>}
            {taskData.type && <FilterLink param="type" value={taskData.type} projectId={projectId} className="chip chip-type entity-chip" title={`Filtrar pelo tipo ${typeLabel(taskData.type)}`}>{typeLabel(taskData.type)}</FilterLink>}
            {currentFeature?.name && <FeatureLink featureId={currentFeature._id} projectId={projectId} className="chip chip-feature entity-chip" title={`Ver todas as tarefas da feature “${currentFeature.name}”`}><IconFeature size={11} /><span>{currentFeature.name}</span></FeatureLink>}
            <button type="button" className="id-chip" title={`Copiar ID completo: ${task._id}`} aria-label={`Copiar ID da tarefa ${task._id}`} onClick={() => void copyText(task._id, 'ID da tarefa copiado.')}><code>{shortId(task._id)}</code><IconCopy size={11} /></button>
            <button type="button" className="id-chip" title="Copiar link direto para esta tarefa" onClick={() => void copyText(window.location.origin + routeUrl('tasks', 'taskId=' + encodeURIComponent(task._id), projectId), 'Link da tarefa copiado.')}>Copiar link</button>
          </div>
        </div>
        <button type="button" className="icon-button drawer-close" onClick={close} aria-label="Fechar detalhes (Esc)" title="Fechar (Esc)"><IconClose size={18} /></button>
      </header>

      <div className="drawer-actionbar" role="toolbar" aria-label="Ações da tarefa">
        {status === 'em_revisao' && <>
          <button type="button" className="button primary" disabled={!onReview} aria-pressed={review === 'approve'} onClick={() => startReview('approve')}><IconCheck size={13} /> Aprovar e concluir</button>
          <button type="button" className="button secondary" disabled={!onReview} aria-pressed={review === 'return'} onClick={() => startReview('return')}>Devolver para ajustes</button>
        </>}
        {status === 'concluida' && <button type="button" className={taskData.checked ? 'button secondary' : 'button primary'} disabled={checking} aria-pressed={Boolean(taskData.checked)} onClick={() => onToggleChecked(taskData as Task)}>{checking ? 'Salvando…' : taskData.checked ? 'Desfazer conferência' : 'Marcar como conferida'}</button>}
        {status === 'bloqueada' && <button type="button" className="button primary" disabled={!onReview} aria-pressed={review === 'unblock'} onClick={() => startReview('unblock')}>Desbloquear</button>}
        <span className="actionbar-spacer" />
        <button type="button" className="button secondary" disabled={openConversation.isPending} onClick={() => openConversation.mutate()}>{openConversation.isPending ? 'Abrindo…' : 'Abrir conversa'}</button>
        <button type="button" className="button secondary" disabled={features.isPending} onClick={() => setEditing(true)}>Editar</button>
        <DropdownMenu ariaLabel="Mais ações da tarefa" triggerClassName="button secondary" items={[
          { id: 'transfer', label: 'Transferir tarefa' },
          ...(onChangeStatus ? [{ id: 'status', label: 'Alterar status…' }] : []),
          { id: 'assign', label: 'Atribuir responsável…' },
          { id: 'full', label: 'Resumo completo', dividerBefore: true },
          { id: 'json', label: 'Ver JSON' }
        ]} onSelect={id => {
          if (id === 'transfer') onRequestTransfer(taskData as Task);
          else if (id === 'status') onChangeStatus?.(taskData as Task);
          else if (id === 'assign') { setSpecial(null); setTab('summary'); setAssignee(taskData.responsible ?? ''); setAssigning(true); }
          else setSpecial(id as 'full' | 'json');
        }}><IconMore size={14} /> Mais</DropdownMenu>
      </div>
      {status === 'concluida' && taskData.checked && <p className="drawer-notice ok"><IconCheck size={12} /> Conferida por {taskData.checkedBy || 'usuário'} · {formatDate(taskData.checkedAt)}</p>}
      {openConversation.isError && <div className="drawer-notice"><ErrorNotice error={openConversation.error} onRetry={() => openConversation.mutate()} title="Não foi possível abrir a conversa" /></div>}

      {review && copy && <form className="review-panel" onSubmit={event => void submitReview(event)} aria-label={copy.title}>
        <h3>{copy.title}</h3>
        <ul className="review-checklist">
          <li className={completedCriteria === acceptance.length && acceptance.length > 0 ? 'ok' : 'warn'}>{completedCriteria === acceptance.length && acceptance.length > 0 ? <IconCheck size={12} /> : <IconAlert size={12} />}{acceptance.length ? `${completedCriteria} de ${acceptance.length} critérios atendidos` : 'Nenhum critério de aceite cadastrado'}</li>
          <li className={diffCount ? 'ok' : 'warn'}>{diffCount ? <IconCheck size={12} /> : <IconAlert size={12} />}{diffCount ? `${plural(diffCount, 'diff Git publicado', 'diffs Git publicados')}` : 'Nenhum diff Git publicado'}</li>
        </ul>
        <label>{copy.reasonLabel}<textarea rows={3} value={reviewReason} onChange={event => setReviewReason(event.target.value)} required={copy.required} autoFocus aria-describedby="review-hint" /></label>
        <small id="review-hint">{copy.hint}</small>
        <div className="button-row end-row"><button type="button" className="button ghost" onClick={() => setReview(null)} disabled={reviewBusy}>Cancelar</button><button className={`button ${copy.tone}`} disabled={reviewBusy || (copy.required && !reviewReason.trim())}>{reviewBusy ? 'Salvando…' : copy.confirm}</button></div>
      </form>}

      {context.isPending ? <div className="drawer-body"><Skeleton rows={6} label="Carregando contexto da tarefa…" /></div> : context.isError ? <div className="drawer-body"><ErrorNotice error={context.error} onRetry={() => void context.refetch()} retrying={context.isFetching} title="Não foi possível carregar a tarefa" /></div> : <>
        <div className="drawer-tabs" role="tablist" aria-label="Seções da tarefa">
          {tabs.map(item => <button key={item.id} id={`task-tab-${item.id}`} type="button" role="tab" aria-selected={!special && tab === item.id} aria-controls="task-tabpanel" tabIndex={!special && tab === item.id ? 0 : -1} className={'drawer-tab' + (!special && tab === item.id ? ' active' : '')} onClick={() => { setTab(item.id); setSpecial(null); }} onKeyDown={event => moveTab(event, tabs)}>{item.label}{item.count && <span className="tab-count">{item.count}</span>}</button>)}
        </div>
        <div className="drawer-body" id="task-tabpanel" role="tabpanel" aria-labelledby={special ? undefined : `task-tab-${tab}`} aria-label={special ? (special === 'json' ? 'JSON da tarefa' : 'Resumo completo da tarefa') : undefined}>
          {special && <button type="button" className="text-button back-link" onClick={() => setSpecial(null)}>← Voltar aos detalhes</button>}
          {special === 'json' ? <pre className="markdown-content json-content">{JSON.stringify(context.data, null, 2)}</pre>
            : special === 'full' ? <TaskSummaryPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} onOpenConversation={onOpenConversation} />
              : tab === 'summary' ? <>
                {status === 'bloqueada' && <section className="blocked-reason-panel" aria-labelledby="blocked-reason-title"><h3 id="blocked-reason-title">Motivo do bloqueio</h3>{blockingReasons.length ? <ul>{blockingReasons.map((reason, index) => <li key={index}><MarkdownView content={reason} /></li>)}</ul> : <p>Não há um motivo registrado para este bloqueio.</p>}</section>}
                <section className="drawer-section task-description-section"><h3>Descrição</h3>{taskData.description || taskData.instructions ? <MarkdownView content={taskData.description || taskData.instructions} /> : <p className="empty-inline">Sem descrição cadastrada.</p>}</section>
                <section className="drawer-section" aria-label="Critérios de aceite"><div className="drawer-section-head"><h3>Critérios de aceite{acceptance.length > 0 && <span className="aside-count"> · {completedCriteria}/{acceptance.length} atendidos</span>}</h3>{acceptance.length > 0 && <button type="button" className="text-button" onClick={() => setTab('criteria')}>Ver evidências e marcar →</button>}</div>{acceptance.length ? <ul className="criteria-glance">{acceptance.map((item: string, index: number) => <li key={index} className={acceptanceProgress[index] ? 'done' : undefined}><span className={acceptanceProgress[index] ? 'criterion-state criterion-complete' : 'criterion-state'}>{acceptanceProgress[index] ? 'Atendido' : 'Pendente'}</span><MarkdownView content={item} /></li>)}</ul> : <p className="empty-inline">Nenhum critério de aceite cadastrado.</p>}</section>
                <section className="drawer-section" aria-label="Dados da tarefa"><h3>Dados</h3><dl className="facts-grid">
                  <div className="fact-assignee"><dt>Responsável</dt><dd>{assigning ? <form className="assign-form" onSubmit={event => { event.preventDefault(); if (assignee.trim()) assign.mutate(assignee.trim()); }}><AssigneePicker assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} defaultValue={taskData.responsible} allowEmpty={!taskData.responsible} label="Atribuir a" onChange={setAssignee} />{assign.isError && <p className="field-error" role="alert">{errorMessage(assign.error)}</p>}<div className="button-row"><button className="button primary small-button" disabled={assign.isPending || !assignee.trim() || assignee.trim() === (taskData.responsible ?? '')}>{assign.isPending ? 'Salvando…' : 'Atribuir'}</button><button type="button" className="button ghost small-button" disabled={assign.isPending} onClick={() => { setAssigning(false); assign.reset(); }}>Cancelar</button></div></form> : <span className="assignee-line"><Person identity={taskData.responsible} /><button type="button" className="text-button" onClick={() => { setAssignee(taskData.responsible ?? ''); setAssigning(true); }}>{taskData.responsible ? 'Alterar' : 'Atribuir'}</button></span>}</dd></div>
                  <div><dt>Atualizada</dt><dd title={formatDate(taskData.updatedAt)}>{relativeTime(taskData.updatedAt, now)}</dd></div>
                  <div><dt>Criada</dt><dd>{formatDate(taskData.createdAt)}</dd></div>
                  <div><dt>Prazo da execução</dt><dd>{taskData.leaseUntil ? formatDate(taskData.leaseUntil) : '—'}</dd></div>
                  <div><dt>Repositório</dt><dd>{repository?.name ?? '—'}</dd></div>
                  <div><dt>Feature</dt><dd>{currentFeature ? <FeatureLink featureId={currentFeature._id} projectId={projectId}>{currentFeature.name}</FeatureLink> : 'Sem feature'}</dd></div>
                </dl></section>
                {(dependencies.length > 0 || dependents.length > 0) && <section className="drawer-section" aria-label="Encadeamento de tarefas"><h3>Encadeamento</h3>
                  {dependencies.length > 0 && <div className="chain-group"><span className="chain-label">Depende de</span><ul className="chain-list">{dependencies.map(item => <li key={item._id}><TaskLink taskId={item._id} projectId={projectId}>{item.name}</TaskLink><Badge tone={statusTone[item.status]}>{statusLabels[item.status] ?? item.status}</Badge>{item.area && <span className={`chip chip-area chip-area-${item.area}`}>{areaLabel(item.area)}</span>}</li>)}</ul></div>}
                  {dependents.length > 0 && <div className="chain-group"><span className="chain-label">Libera</span><ul className="chain-list">{dependents.map(item => <li key={item._id}><TaskLink taskId={item._id} projectId={projectId}>{item.name}</TaskLink><Badge tone={statusTone[item.status]}>{statusLabels[item.status] ?? item.status}</Badge>{item.area && <span className={`chip chip-area chip-area-${item.area}`}>{areaLabel(item.area)}</span>}</li>)}</ul></div>}
                </section>}
                <section className="drawer-section" aria-labelledby="task-status-history-title"><h3 id="task-status-history-title">Linha do tempo de status</h3><TaskTimeline history={statusHistory} events={taskActivity.data?.items ?? []} now={now} truncated={context.data?.contextMeta?.truncatedFields?.includes('task.statusHistory')} /></section>
              </>
                : tab === 'criteria' ? <TaskCriteriaPanel acceptance={acceptance} progress={acceptanceProgress} evidence={taskData.acceptanceEvidence ?? []} savingIndex={savingCriterion} feedback={criterionFeedback} onUpdate={(index, complete, evidence) => void updateCriterion(index, complete, evidence)} />
                  : tab === 'planning' ? <section className="drawer-section" aria-label="Planejamento Markdown">
                    {markdown ? <><div className="section-heading"><h3>{markdown.name}</h3><div className="button-row"><button type="button" className="text-button" onClick={() => void copyText(markdown.content, 'Markdown copiado.')}>Copiar</button><button type="button" className="text-button" onClick={() => setMarkdown(null)}>← Voltar à lista</button></div></div><div className="markdown-document-view"><MarkdownView content={markdown.content} /></div></>
                      : markdowns.isPending ? <Skeleton rows={3} label="Carregando documentos…" /> : markdowns.isError ? <ErrorNotice error={markdowns.error} onRetry={() => void markdowns.refetch()} /> : markdowns.data?.items?.length ? <div className="resource-list">{markdowns.data.items.map(item => <button type="button" className="resource-row" key={item._id} onClick={() => void openMarkdown(item)}><span><strong>{item.name}</strong><small>{item.summary}</small></span><Badge>rev. {item.revision}</Badge></button>)}</div> : <p className="empty-inline">Nenhum documento de planejamento vinculado.</p>}
                  </section>
                    : tab === 'diffs' ? <section className="drawer-section" aria-label="Diffs publicados"><TaskDiffsPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} items={diffs.data?.items ?? []} isPending={diffs.isPending} isError={diffs.isError} error={diffs.error} onRetry={() => void diffs.refetch()} /></section>
                      : tab === 'activity' ? <TaskActivityPanel events={taskActivity.data?.items ?? []} isPending={taskActivity.isPending} isError={taskActivity.isError} error={taskActivity.error} onRetry={() => void taskActivity.refetch()} executions={contextExecutions} now={now} />
                        : <section className="drawer-section" aria-label="Conversa da tarefa">
                          <div className="drawer-section-head"><h3>Colaboração da tarefa</h3><button type="button" className="button secondary small-button" disabled={openConversation.isPending} onClick={() => openConversation.mutate()}>{openConversation.isPending ? 'Abrindo…' : 'Abrir conversa completa'}</button></div>
                          <div className="chain-group"><span className="chain-label">Conversas vinculadas</span>{linkedConversations.isPending ? <Skeleton rows={1} label="Carregando conversas…" /> : linkedConversations.isError ? <ErrorNotice error={linkedConversations.error} onRetry={() => void linkedConversations.refetch()} /> : linkedConversations.data?.linkedConversations?.length ? <ul className="chain-list">{linkedConversations.data.linkedConversations.map(item => <li key={item.conversationId}><ConversationLink conversationId={item.conversationId} projectId={projectId}>{item.title || 'Conversa sem título'}</ConversationLink><small>{plural(item.messageCount, 'mensagem', 'mensagens')}{item.lastActivityAt ? ' · ' + relativeTime(item.lastActivityAt, now) : ''}</small></li>)}</ul> : <p className="empty-inline">Nenhuma conversa vinculada ainda.</p>}</div>
                          {messages.length ? <ul className="activity-list">{messages.slice(0, 10).map(message => <li key={message._id}><div className="activity-row-body"><div className="activity-row-head"><Badge tone={message.type === 'resposta' ? 'green' : message.type === 'pergunta' ? 'blue' : 'muted'}>{message.type === 'resposta' ? 'Resposta' : message.type === 'pergunta' ? 'Pergunta' : message.type || 'Atualização'}</Badge><strong>{message.clientName?.trim() || message.author}</strong><time dateTime={message.createdAt} title={formatDate(message.createdAt)}>{relativeTime(message.createdAt, now)}</time></div><MarkdownView content={message.message} /></div></li>)}</ul> : <p className="empty-inline">Nenhuma mensagem de colaboração. Use “Abrir conversa completa” para falar com a IA sobre esta tarefa.</p>}
                        </section>}
        </div>
      </>}
      <div className="drawer-notices" aria-live="polite">
        {markRead.isPending && <p className="notice" role="status">Marcando atividades como lidas…</p>}
        {markRead.isError && <div className="notice error" role="alert"><span>Não foi possível marcar as atividades como lidas: {errorMessage(markRead.error)}</span><button type="button" className="text-button" disabled={markRead.isPending} onClick={() => { const attempt = readAttempt.current; if (attempt?.taskId === task._id) markRead.mutate(attempt); }}>Tentar novamente</button></div>}
      </div>
    </section>
    {editing && !features.isPending && <TaskEditorDialog token={token} nonce={nonce} project={project} tasks={tasks} features={editorFeatures} task={taskData as Task} systemAdmin={systemAdmin} close={() => setEditing(false)} notify={notify} onSaved={() => setEditing(false)} />}
  </div>;
}
