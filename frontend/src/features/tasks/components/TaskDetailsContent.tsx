import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, ApiRequestError, listTaskAttachments, operationId, query, request } from '../../../api';
import type { Project, Task } from '../../../api';
import { markTaskReadIfUnread, type TaskUnreadState } from '../task-read';
import { loadTaskAttachmentReadState, saveTaskAttachmentReadState, type TaskAttachmentReadState } from '../task-attachment-read';
import { Badge } from '../../../components/ui/badge';
import { Textarea } from '../../../components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { ErrorNotice } from '../../../components/ui/ErrorNotice';
import { IconAlert, IconCheck, IconClose, IconCopy, IconFeature, IconMore } from '../../../components/ui/icons';
import { ConversationLink, FeatureLink, FilterLink } from '../../../components/ui/Links';
import { AssigneePicker } from '../../../components/ui/AssigneePicker';
import { Person } from '../../../components/ui/Person';
import { useAssignees } from '../assignees';
import { SkeletonRows as Skeleton } from '../../../components/ui/skeleton';
import { copyToClipboard } from '../../../lib/clipboard';
import { isTechnicalEvent } from '../../../lib/activity';
import { errorMessage, formatDate } from '../../../lib/format';
import { areaLabel, plural, priorityInfo, relativeTime, shortId, typeLabel } from '../../../lib/labels';
import { TaskStatusBadge } from './TaskStatusBadge';
import { MarkdownView } from '../../../components/ui/MarkdownView';
import { TaskSummaryPanel } from './TaskSummaryPanel';
import { TaskEditorDialog } from './TaskEditorDialog';
import { TaskDiffsPanel, type TaskDiffSummary } from './TaskDiffsPanel';
import { TaskCriteriaPanel } from './TaskCriteriaPanel';
import { TaskTimeline, type StatusHistoryEntry } from './TaskTimeline';
import { TaskActivityPanel, type TaskActivityEvent } from './TaskActivityPanel';
import { TaskAttachmentsPanel } from './TaskAttachmentsPanel';
import { TaskMemoriesPanel } from './TaskMemoriesPanel';
import { TaskMessageBody } from './TaskMessageBody';
import { TaskChainList } from './TaskChainList';
import { TaskSectionRail, type TaskSection } from './TaskSectionRail';
import { taskPageUrl } from '../../../route-state';
import { TaskMessageAuthor } from '../../conversations/components/ConversationParts';
import { openTaskConversation } from '../task-conversation';
import { buttonBase, buttonDanger, buttonGhost, buttonPrimary, buttonSecondarySmall, eyebrow, textButton } from '../../../components/ui/classes';
import { Dialog, DialogContent } from '../../../components/ui/dialog';

type Feature = { _id: string; name: string };
export type TaskDetailsAction = 'details' | 'edit' | 'summary' | 'json' | 'criteria' | 'assign';
export type TaskReviewDecision = 'approve' | 'return' | 'unblock';
type TaskDiff = TaskDiffSummary;
type TaskMarkdown = { _id: string; name: string; summary: string; revision: number };
type TaskReadAttempt = { taskId: string; cursor: number; operationId: string };
type TaskUnreadNovelty = TaskActivityEvent & { sequence: number; taskId: string | null };
type AttachmentReadSnapshot = TaskAttachmentReadState & { scope: string };
type TaskMessage = { _id: string; type: string; author: string; authorType?: string; clientName?: string | null; message: string; createdAt: string; truncated?: boolean };
type Tab = 'summary' | 'criteria' | 'planning' | 'diffs' | 'activity' | 'attachments' | 'memories' | 'conversation';

const reviewCopy: Record<TaskReviewDecision, { title: string; confirm: string; reasonLabel: string; required: boolean; hint: string; tone: string }> = {
  approve: { title: 'Aprovar e concluir a tarefa', confirm: 'Aprovar e concluir', reasonLabel: 'Observação da aprovação (opcional)', required: false, hint: 'A tarefa vai para “Concluída”. Depois você ainda pode marcá-la como conferida.', tone: buttonPrimary },
  return: { title: 'Devolver para ajustes', confirm: 'Devolver para pendente', reasonLabel: 'O que precisa ser ajustado?', required: true, hint: 'A tarefa volta para “Pendente” com o motivo registrado, e o agente poderá assumi-la de novo.', tone: buttonDanger },
  unblock: { title: 'Desbloquear a tarefa', confirm: 'Voltar para pendente', reasonLabel: 'Como o bloqueio foi resolvido?', required: true, hint: 'A tarefa volta para “Pendente” e fica disponível para ser assumida.', tone: buttonPrimary }
};

const chainLabel = 'text-ui-xs font-bold text-muted-strong';
const emptyInline = 'rounded-ui-md border border-dashed border-line-strong px-4 py-3 text-ui-sm text-muted-strong';
const sectionTitle = 'font-display text-ui-md leading-[normal] font-bold text-ink';
const drawerSection = 'grid gap-3';
const drawerSectionMarkdown = 'grid gap-3 [&_h3]:m-0! [&_h3]:font-display! [&_h3]:text-ui-md! [&_h3]:leading-[normal]! [&_h3]:font-bold! [&_h3]:text-ink!';
const drawerBody = 'grid min-h-0 flex-[1_1_0] content-start gap-6 p-6 max-[760px]:p-4';
const iconButton = 'inline-grid size-[34px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const idChip = 'inline-flex items-center gap-[5px] rounded-ui-sm border border-transparent bg-[#f3f4f8] px-[7px] py-0.5 text-ui-xs font-semibold text-muted-strong hover:border-line-strong hover:bg-white';
const chipLink = 'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-ui-sm px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap no-underline hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue';
const areaTone: Record<string, string> = { backend: 'bg-[#eaeeff] text-[#3544a8]', frontend: 'bg-[#e1f4f1] text-[#136059]' };
const priorityTone: Record<string, string> = { red: 'bg-tone-red-bg text-tone-red', amber: 'bg-tone-amber-bg text-tone-amber', muted: 'bg-tone-slate-bg text-tone-slate' };
const actionButton = 'inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg border px-3 text-ui-xs font-bold transition max-[760px]:flex-auto';
const actionPrimary = `${actionButton} border-transparent bg-primary text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const actionSecondary = `${actionButton} border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`;
const smallPrimary = `${buttonBase} min-h-[29px] border-transparent bg-primary px-2.5 text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const smallGhost = `${buttonBase} min-h-[29px] border-transparent bg-transparent px-2.5 text-[#758093]`;
const factCard = 'grid min-w-0 gap-1 rounded-ui-sm border border-line bg-[#fbfcfe] px-3 py-2.5';
const factTerm = 'text-[10.5px] font-bold text-muted-strong';
const factValue = 'text-ui-sm font-semibold text-ink-2 wrap-anywhere';
const checkOk = 'flex items-center gap-1.5 text-tone-green';
const checkWarn = 'flex items-center gap-1.5 text-tone-amber';


/**
 * Conteúdo dos detalhes da tarefa, compartilhado pelo drawer (`variant="drawer"`, com overlay, focus-trap e Esc)
 * e pela página dedicada `/tasks/:id` (`variant="page"`, onde `close` volta para a fila).
 */
export function TaskDetailsContent({ variant, token, nonce, projectId, project, tasks, task, initialAction = 'details', checking, notify, onToggleChecked, onOpenConversation, onRequestTransfer, onReview, onChangeStatus, onOpenPage, systemAdmin = false, close }: {
  variant: 'drawer' | 'page';
  onOpenPage?: () => void;
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
  const isDrawer = variant === 'drawer';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const context = useQuery({
    queryKey: ['task-context', nonce, projectId, task._id],
    queryFn: () => query<Record<string, any>>(token, 'get_task_context', { projectId, taskId: task._id })
  });
  const taskData = (context.data?.task ?? task) as Task & { readCursor?: number; statusHistory?: StatusHistoryEntry[] };
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
  const unreadActivityEvents = useQuery({
    queryKey: ['task-unread-activity-events', nonce, projectId, task._id, taskData.readCursor, unreadActivity?.cursor],
    enabled: tab === 'activity' && typeof taskData.readCursor === 'number' && (unreadActivity?.count ?? 0) > 0 && unreadActivity?.cursor !== null,
    retry: false,
    queryFn: async () => {
      const throughCursor = unreadActivity?.cursor ?? 0;
      let after = taskData.readCursor ?? 0;
      const unreadEvents: TaskActivityEvent[] = [];
      for (let pageNumber = 0; pageNumber < 100 && after < throughCursor; pageNumber += 1) {
        const page = await query<{ items: TaskUnreadNovelty[]; cursor: number; hasMore: boolean }>(token, 'get_project_novelties', { projectId, after, limit: 100 });
        unreadEvents.push(...page.items.filter(event => event.taskId === task._id && event.sequence <= throughCursor));
        if (!page.hasMore || page.cursor <= after || page.cursor >= throughCursor) break;
        after = page.cursor;
      }
      return unreadEvents;
    }
  });
  const markRead = useMutation({
    mutationFn: (attempt: TaskReadAttempt) => markTaskReadIfUnread({
      token, projectId, taskId: task._id,
      unread: { count: 1, cursor: attempt.cursor },
      operationId: attempt.operationId
    }, async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-sync-report', nonce, projectId] }),
      queryClient.invalidateQueries({ queryKey: ['task-context', nonce, projectId, task._id] })
    ]))
  });
  const markUnreadAsRead = useCallback(() => {
    if (!unreadActivity || unreadActivity.count <= 0 || unreadActivity.cursor === null || markRead.isPending) return;
    const previous = readAttempt.current;
    const attempt = previous?.taskId === task._id && previous.cursor === unreadActivity.cursor
      ? previous
      : { taskId: task._id, cursor: unreadActivity.cursor, operationId: operationId() };
    readAttempt.current = attempt;
    markRead.mutate(attempt);
  }, [markRead.isPending, markRead.mutate, task._id, unreadActivity?.count, unreadActivity?.cursor]);
  useEffect(() => {
    readAttempt.current = null;
    markRead.reset();
  }, [markRead.reset, task._id]);
  const diffs = useQuery({
    queryKey: ['task-diffs', nonce, projectId, task._id],
    queryFn: () => query<{ items: TaskDiff[] }>(token, 'list_task_diffs', { projectId, taskId: task._id, limit: 20 })
  });
  const markdowns = useQuery({
    queryKey: ['task-markdowns', nonce, projectId, task._id],
    queryFn: () => query<{ items: TaskMarkdown[] }>(token, 'list_markdowns', { projectId, targetKind: 'task', targetId: task._id, limit: 20 })
  });
  const attachments = useQuery({
    queryKey: ['task-attachments', nonce, projectId, task._id],
    queryFn: () => listTaskAttachments(token, projectId, task._id)
  });
  const attachmentReadScope = `${projectId}:${task._id}`;
  const [attachmentReadState, setAttachmentReadState] = useState<AttachmentReadSnapshot>(() => ({ scope: attachmentReadScope, ...loadTaskAttachmentReadState(projectId, task._id) }));
  const effectiveAttachmentReadState = useMemo(() => attachmentReadState.scope === attachmentReadScope
    ? attachmentReadState
    : { scope: attachmentReadScope, ...loadTaskAttachmentReadState(projectId, task._id) }, [attachmentReadState, attachmentReadScope, projectId, task._id]);
  useEffect(() => {
    if (!attachments.data) return;
    const attachmentIds = attachments.data.map(item => item.id);
    setAttachmentReadState(current => {
      const currentState = current.scope === attachmentReadScope ? current : { scope: attachmentReadScope, ...loadTaskAttachmentReadState(projectId, task._id) };
      const seenIds = currentState.initialized ? currentState.seenIds.filter(id => attachmentIds.includes(id)) : attachmentIds;
      if (currentState.initialized && seenIds.length === currentState.seenIds.length) return currentState;
      return { scope: attachmentReadScope, initialized: true, seenIds };
    });
  }, [attachments.data, attachmentReadScope, projectId, task._id]);
  useEffect(() => {
    if (effectiveAttachmentReadState.initialized) saveTaskAttachmentReadState(projectId, task._id, effectiveAttachmentReadState);
  }, [attachmentReadScope, effectiveAttachmentReadState, projectId, task._id]);
  const newAttachmentIds = useMemo(() => {
    if (!attachments.data || !effectiveAttachmentReadState.initialized) return [];
    const seenIds = new Set(effectiveAttachmentReadState.seenIds);
    return attachments.data.filter(item => !seenIds.has(item.id)).map(item => item.id);
  }, [attachments.data, effectiveAttachmentReadState]);
  const markAttachmentViewed = useCallback((attachmentId: string) => {
    setAttachmentReadState(current => {
      const currentState = current.scope === attachmentReadScope ? current : { scope: attachmentReadScope, ...loadTaskAttachmentReadState(projectId, task._id) };
      const seenIds = new Set(currentState.initialized ? currentState.seenIds : (attachments.data ?? []).map(item => item.id));
      seenIds.add(attachmentId);
      return { scope: attachmentReadScope, initialized: true, seenIds: [...seenIds] };
    });
  }, [attachmentReadScope, attachments.data, projectId, task._id]);
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
  const activityCount = (taskActivity.data?.items ?? []).filter(event => !isTechnicalEvent(event)).length;
  const attachmentCount = attachments.data?.length ?? 0;
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

  const tabs: Array<TaskSection<Tab>> = [
    { id: 'summary', label: 'Visão geral' },
    { id: 'criteria', label: 'Critérios', count: acceptance.length ? `${completedCriteria}/${acceptance.length}` : undefined },
    { id: 'planning', label: 'Planejamento', count: planningCount ? String(planningCount) : undefined },
    { id: 'diffs', label: 'Diffs', count: diffCount ? String(diffCount) : undefined },
    { id: 'activity', label: 'Atividade', count: activityCount ? String(activityCount) : undefined, unread: (unreadActivity?.count ?? 0) > 0 },
    { id: 'attachments', label: 'Arquivos', count: attachmentCount ? String(attachmentCount) : undefined, unread: newAttachmentIds.length > 0 },
    { id: 'memories', label: 'Memórias' },
    { id: 'conversation', label: 'Conversa', count: messages.length ? String(messages.length) : undefined }
  ];
  const copy = review ? reviewCopy[review] : null;

  const nextPending = acceptance.findIndex((_item: string, index: number) => !acceptanceProgress[index]);
  const progressPercent = acceptance.length ? Math.round(completedCriteria * 100 / acceptance.length) : 0;
  const fixed = isDrawer ? ' flex-none' : '';
  const railFooter = isDrawer ? undefined : <div className="grid gap-3 border-t border-line p-4 text-ui-sm text-ink-2 max-[960px]:hidden">
    <div className="grid gap-[3px]"><span className={chainLabel}>Responsável</span><Person identity={taskData.responsible} /></div>
    <div className="grid gap-[3px]"><span className={chainLabel}>Versão</span><span>{taskData.version !== undefined ? `v${taskData.version}` : '—'}</span></div>
    <div className="grid gap-[3px]"><span className={chainLabel}>Atualizada</span><span title={formatDate(taskData.updatedAt)}>{relativeTime(taskData.updatedAt, now)}</span></div>
  </div>;
  const editorDialog = editing && !features.isPending && <TaskEditorDialog token={token} nonce={nonce} project={project} tasks={tasks} features={editorFeatures} task={taskData as Task} systemAdmin={systemAdmin} close={() => setEditing(false)} notify={notify} onSaved={() => setEditing(false)} />;

  const details = <>
      <header className={'flex items-start justify-between gap-4 border-b border-line px-6 pt-4 pb-3 max-[760px]:px-4 max-[760px]:pt-3' + fixed}>
        <div className="min-w-0">
          {!isDrawer && <Button type="button" className={`${textButton} justify-self-start`} onClick={close}>‹ Voltar às tarefas</Button>}
          <p className={eyebrow}>TAREFA · {areaLabel(task.area)}</p>
          <h2 className="mb-2 font-display text-ui-xl leading-[1.3] font-bold tracking-[-.03em] text-ink wrap-anywhere max-[760px]:text-[17px]" id="details-title">{task.name}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskStatusBadge status={status} />
            <span className={`inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap ${priorityTone[priority.tone] ?? ''}`.trim()} title={priority.text}>{priority.text}</span>
            {taskData.area ? <FilterLink param="area" value={taskData.area} projectId={projectId} className={`${chipLink} ${areaTone[taskData.area] ?? 'bg-tone-slate-bg text-tone-slate'}`} title={`Filtrar pela área ${areaLabel(taskData.area)}`}>{areaLabel(taskData.area)}</FilterLink> : <span className="inline-flex max-w-full items-center gap-1 rounded-ui-sm bg-tone-slate-bg px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap text-tone-slate">{areaLabel(taskData.area)}</span>}
            {taskData.type && <FilterLink param="type" value={taskData.type} projectId={projectId} className={`${chipLink} bg-[#f4effc] text-[#603d99]`} title={`Filtrar pelo tipo ${typeLabel(taskData.type)}`}>{typeLabel(taskData.type)}</FilterLink>}
            {currentFeature?.name && <FeatureLink featureId={currentFeature._id} name={currentFeature.name} projectId={projectId} className="inline-flex max-w-[240px] cursor-pointer items-center gap-1 rounded-ui-sm border border-line-strong bg-white px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap text-ink-2 no-underline hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue" title={`Ver todas as tarefas da feature “${currentFeature.name}”`}><IconFeature size={11} /><span className="overflow-hidden text-ellipsis">{currentFeature.name}</span></FeatureLink>}
            <Button type="button" className={idChip} title={`Copiar ID completo: ${task._id}`} aria-label={`Copiar ID da tarefa ${task._id}`} onClick={() => void copyText(task._id, 'ID da tarefa copiado.')}><code className="font-code text-[10px] leading-[normal] font-semibold">{shortId(task._id)}</code><IconCopy size={11} /></Button>
            <Button type="button" className={idChip} title="Copiar link direto para esta tarefa" onClick={() => void copyText(window.location.origin + taskPageUrl(projectId, task._id), 'Link da tarefa copiado.')}>Copiar link</Button>
            {taskData.version !== undefined && <span className={idChip} title="Versão atual da tarefa">v{taskData.version}</span>}
          </div>
        </div>
        {isDrawer && <div className="flex flex-none items-center gap-2">
          {onOpenPage && <Button type="button" className={buttonSecondarySmall} onClick={onOpenPage}>Abrir página</Button>}
          <Button type="button" className={iconButton} onClick={close} aria-label="Fechar detalhes (Esc)" title="Fechar (Esc)"><IconClose size={18} /></Button>
        </div>}
      </header>

      <div className={'flex flex-wrap items-center gap-2 border-b border-line bg-[#fbfcff] px-6 py-3 max-[760px]:px-4 max-[760px]:py-2' + fixed} role="toolbar" aria-label="Ações da tarefa">
        {status === 'em_revisao' && <>
          <Button type="button" className={actionPrimary} disabled={!onReview} aria-pressed={review === 'approve'} onClick={() => startReview('approve')}><IconCheck size={13} /> Aprovar e concluir</Button>
          <Button type="button" className={actionSecondary} disabled={!onReview} aria-pressed={review === 'return'} onClick={() => startReview('return')}>Devolver para ajustes</Button>
        </>}
        {status === 'concluida' && <Button type="button" className={taskData.checked ? actionSecondary : actionPrimary} disabled={checking} aria-pressed={Boolean(taskData.checked)} onClick={() => onToggleChecked(taskData as Task)}>{checking ? 'Salvando…' : taskData.checked ? 'Desfazer conferência' : 'Marcar como conferida'}</Button>}
        {status === 'bloqueada' && <Button type="button" className={actionPrimary} disabled={!onReview} aria-pressed={review === 'unblock'} onClick={() => startReview('unblock')}>Desbloquear</Button>}
        <span className="flex-auto max-[760px]:hidden" />
        <Button type="button" className={actionSecondary} disabled={openConversation.isPending} onClick={() => openConversation.mutate()}>{openConversation.isPending ? 'Abrindo…' : 'Abrir conversa'}</Button>
        <Button type="button" className={actionSecondary} disabled={features.isPending} onClick={() => setEditing(true)}>Editar</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" className={actionSecondary} aria-label="Mais ações da tarefa"><IconMore aria-hidden="true" size={14} /> Mais</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="Mais ações da tarefa">
            <DropdownMenuItem onSelect={() => onRequestTransfer(taskData as Task)}>Transferir tarefa</DropdownMenuItem>
            {onChangeStatus && <DropdownMenuItem onSelect={() => onChangeStatus(taskData as Task)}>{status === 'em_execucao' ? 'Bloquear tarefa…' : 'Alterar status…'}</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => { setSpecial(null); setTab('summary'); setAssignee(taskData.responsible ?? ''); setAssigning(true); }}>Atribuir responsável…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSpecial('full')}>Resumo completo</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSpecial('json')}>Ver JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {status === 'concluida' && taskData.checked && <p className={'flex items-center gap-1.5 border-b border-line bg-[#f4fbf7] px-6 py-2 text-ui-xs font-semibold text-tone-green' + fixed}><IconCheck size={12} /> Conferida por {taskData.checkedBy || 'usuário'} · {formatDate(taskData.checkedAt)}</p>}
      {openConversation.isError && <div className={'border-b border-line px-6 py-2 text-ui-xs' + fixed}><ErrorNotice error={openConversation.error} onRetry={() => openConversation.mutate()} title="Não foi possível abrir a conversa" /></div>}

      {review && copy && <form className={'grid gap-3 border-b border-line bg-[#fffdf6] px-6 py-4 max-[760px]:px-4 max-[760px]:py-3' + fixed} onSubmit={event => void submitReview(event)} aria-label={copy.title}>
        <h3 className="font-display text-ui-md leading-[normal] font-bold text-ink">{copy.title}</h3>
        <ul className="grid gap-1 text-ui-xs">
          <li className={completedCriteria === acceptance.length && acceptance.length > 0 ? checkOk : checkWarn}>{completedCriteria === acceptance.length && acceptance.length > 0 ? <IconCheck size={12} /> : <IconAlert size={12} />}{acceptance.length ? `${completedCriteria} de ${acceptance.length} critérios atendidos` : 'Nenhum critério de aceite cadastrado'}</li>
          <li className={diffCount ? checkOk : checkWarn}>{diffCount ? <IconCheck size={12} /> : <IconAlert size={12} />}{diffCount ? `${plural(diffCount, 'diff Git publicado', 'diffs Git publicados')}` : 'Nenhum diff Git publicado'}</li>
        </ul>
        <label className="grid gap-[5px] text-ui-xs font-bold text-ink-2">{copy.reasonLabel}<Textarea className="resize-y rounded-ui-sm border-line-strong px-2.5 py-2 text-ui-sm" rows={3} value={reviewReason} onChange={event => setReviewReason(event.target.value)} required={copy.required} autoFocus aria-describedby="review-hint" /></label>
        <small className="text-ui-xs text-muted-strong" id="review-hint">{copy.hint}</small>
        <div className="mt-1 flex items-center justify-end gap-2"><Button type="button" className={buttonGhost} onClick={() => setReview(null)} disabled={reviewBusy}>Cancelar</Button><Button type="submit" className={copy.tone} disabled={reviewBusy || (copy.required && !reviewReason.trim())}>{reviewBusy ? 'Salvando…' : copy.confirm}</Button></div>
      </form>}

      {context.isPending ? <div className={`${drawerBody} overflow-y-auto`}><Skeleton rows={6} label="Carregando contexto da tarefa…" /></div> : context.isError ? <div className={`${drawerBody} overflow-y-auto`}><ErrorNotice error={context.error} onRetry={() => void context.refetch()} retrying={context.isFetching} title="Não foi possível carregar a tarefa" /></div> : <div className={isDrawer ? 'flex min-h-0 flex-[1_1_0] flex-col' : 'grid min-h-[420px] grid-cols-[220px_minmax(0,1fr)] items-start max-[960px]:grid-cols-[minmax(0,1fr)]'}>
        <TaskSectionRail sections={tabs} active={special ? null : tab} orientation={isDrawer ? 'horizontal' : 'vertical'} onSelect={id => { setTab(id); setSpecial(null); }} footer={railFooter} />
        <div className={`${drawerBody} ${isDrawer ? 'overflow-x-hidden overflow-y-auto' : 'overflow-visible'}`} id="task-tabpanel" role="tabpanel" aria-labelledby={special ? undefined : `task-tab-${tab}`} aria-label={special ? (special === 'json' ? 'JSON da tarefa' : 'Resumo completo da tarefa') : undefined}>
          {special && <Button type="button" className={`${textButton} justify-self-start`} onClick={() => setSpecial(null)}>← Voltar aos detalhes</Button>}
          {special === 'json' ? <pre className="mt-2 max-h-[300px] overflow-auto rounded-[8px] border border-[#edf0f4] bg-[#fafbfc] p-3 font-[ui-monospace,monospace] text-[10px] leading-[1.65] wrap-anywhere whitespace-pre-wrap text-[#526075]">{JSON.stringify(context.data, null, 2)}</pre>
            : special === 'full' ? <TaskSummaryPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} onOpenConversation={onOpenConversation} />
              : tab === 'summary' ? <>
                {status === 'bloqueada' && <section className="rounded-[9px] border border-[#efc9c9] bg-[#fff8f7] px-[15px] py-[13px] text-[#813840] max-[760px]:mx-4 [&_p]:text-ui-xs [&_p]:leading-[1.6]" aria-labelledby="blocked-reason-title"><h3 className="mb-2 text-ui-sm font-extrabold text-[#813840]" id="blocked-reason-title">Motivo do bloqueio</h3>{blockingReasons.length ? <ul className="grid gap-[7px] pl-[19px] text-ui-xs leading-[1.6] wrap-anywhere">{blockingReasons.map((reason, index) => <li key={index}><MarkdownView content={reason} /></li>)}</ul> : <p>Não há um motivo registrado para este bloqueio.</p>}</section>}
                <div className="grid grid-cols-2 gap-3 max-[960px]:grid-cols-[minmax(0,1fr)]">
                  <section className="grid min-w-0 content-start gap-2 rounded-ui-md border border-line bg-canvas px-4 py-3 [&_strong]:text-ui-md! [&_strong]:text-ink!" aria-label="Progresso dos critérios">
                    <span className={chainLabel}>Critérios de aceite</span>
                    {acceptance.length ? <>
                      <strong>{completedCriteria} de {acceptance.length} atendidos</strong>
                      <div className="h-2 overflow-hidden rounded-[999px] bg-[#e3e7ef]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="Progresso dos critérios"><span className="block h-full rounded-[inherit] bg-[#1f9d5b] transition-[width] duration-200 ease-[ease]" style={{ width: `${progressPercent}%` }} /></div>
                      <Button type="button" className={`${textButton} justify-self-start`} onClick={() => setTab('criteria')}>Ver evidências e marcar →</Button>
                    </> : <p className={emptyInline}>Nenhum critério de aceite cadastrado.</p>}
                  </section>
                  <section className="grid min-w-0 content-start gap-2 rounded-ui-md border border-line bg-canvas px-4 py-3 [&_strong]:text-ui-md! [&_strong]:text-ink!" aria-label="Próximo passo">
                    <span className={chainLabel}>Próximo passo</span>
                    {nextPending >= 0 ? <MarkdownView content={acceptance[nextPending]} /> : <p className="text-ui-sm text-muted-strong">{acceptance.length ? 'Todos os critérios foram atendidos.' : 'Cadastre critérios de aceite para acompanhar o andamento.'}</p>}
                  </section>
                </div>
                <section className={drawerSectionMarkdown}><h3>Descrição</h3>{taskData.description || taskData.instructions ? <MarkdownView content={taskData.description || taskData.instructions} variant="description" /> : <p className={emptyInline}>Sem descrição cadastrada.</p>}</section>
                <section className={drawerSection} aria-label="Dados da tarefa"><h3 className={sectionTitle}>Dados</h3><dl className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2 max-[420px]:grid-cols-[minmax(0,1fr)]">
                  <div className={factCard + ' col-span-2 max-[760px]:col-auto'}><dt className={factTerm}>Responsável</dt><dd className={factValue}>{assigning ? <form className="grid gap-2 font-normal" onSubmit={event => { event.preventDefault(); if (assignee.trim()) assign.mutate(assignee.trim()); }}><AssigneePicker assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} defaultValue={taskData.responsible} allowEmpty={!taskData.responsible} label="Atribuir a" onChange={setAssignee} />{assign.isError && <p className="mt-1 text-ui-xs font-semibold text-tone-red" role="alert">{errorMessage(assign.error)}</p>}<div className="flex items-center gap-2"><Button type="submit" className={smallPrimary} disabled={assign.isPending || !assignee.trim() || assignee.trim() === (taskData.responsible ?? '')}>{assign.isPending ? 'Salvando…' : 'Atribuir'}</Button><Button type="button" className={smallGhost} disabled={assign.isPending} onClick={() => { setAssigning(false); assign.reset(); }}>Cancelar</Button></div></form> : <span className="flex items-center justify-between gap-2"><Person identity={taskData.responsible} /><Button type="button" className={textButton} onClick={() => { setAssignee(taskData.responsible ?? ''); setAssigning(true); }}>{taskData.responsible ? 'Alterar' : 'Atribuir'}</Button></span>}</dd></div>
                  <div className={factCard}><dt className={factTerm}>Atualizada</dt><dd className={factValue} title={formatDate(taskData.updatedAt)}>{relativeTime(taskData.updatedAt, now)}</dd></div>
                  <div className={factCard}><dt className={factTerm}>Criada</dt><dd className={factValue}>{formatDate(taskData.createdAt)}</dd></div>
                  <div className={factCard}><dt className={factTerm}>Prazo da execução</dt><dd className={factValue}>{taskData.leaseUntil ? formatDate(taskData.leaseUntil) : '—'}</dd></div>
                  <div className={factCard}><dt className={factTerm}>Repositório</dt><dd className={factValue}>{repository?.name ?? '—'}</dd></div>
                  <div className={factCard}><dt className={factTerm}>Feature</dt><dd className={factValue}>{currentFeature ? <FeatureLink featureId={currentFeature._id} name={currentFeature.name} projectId={projectId}>{currentFeature.name}</FeatureLink> : 'Sem feature'}</dd></div>
                </dl></section>
                <TaskChainList projectId={projectId} dependencies={dependencies} dependents={dependents} />
                <section className={drawerSection} aria-labelledby="task-status-history-title"><h3 className={sectionTitle} id="task-status-history-title">Linha do tempo de status</h3><TaskTimeline history={statusHistory} events={taskActivity.data?.items ?? []} now={now} truncated={context.data?.contextMeta?.truncatedFields?.includes('task.statusHistory')} /></section>
              </>
                : tab === 'criteria' ? <TaskCriteriaPanel acceptance={acceptance} progress={acceptanceProgress} evidence={taskData.acceptanceEvidence ?? []} savingIndex={savingCriterion} feedback={criterionFeedback} onUpdate={(index, complete, evidence) => void updateCriterion(index, complete, evidence)} />
                  : tab === 'planning' ? <section className={drawerSectionMarkdown} aria-label="Planejamento Markdown">
                    {markdown ? <><div className="mb-[11px] flex items-center justify-between gap-[14px]"><h3>{markdown.name}</h3><div className="flex items-center gap-2"><Button type="button" className={`${textButton} flex-none`} onClick={() => void copyText(markdown.content, 'Markdown copiado.')}>Copiar</Button><Button type="button" className={`${textButton} flex-none`} onClick={() => setMarkdown(null)}>← Voltar à lista</Button></div></div><div className="mt-2 overflow-auto rounded-[8px] border border-[#edf0f4] bg-[#fafbfc] p-3"><MarkdownView content={markdown.content} variant="document" /></div></>
                      : markdowns.isPending ? <Skeleton rows={3} label="Carregando documentos…" /> : markdowns.isError ? <ErrorNotice error={markdowns.error} onRetry={() => void markdowns.refetch()} /> : markdowns.data?.items?.length ? <div className="grid gap-1">{markdowns.data.items.map(item => <Button type="button" className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left hover:bg-accent" key={item._id} onClick={() => void openMarkdown(item)}><span className="grid min-w-0 gap-1"><strong className="truncate text-sm font-medium">{item.name}</strong><small className="truncate text-xs text-muted-foreground">{item.summary}</small></span><Badge variant="secondary">rev. {item.revision}</Badge></Button>)}</div> : <p className={emptyInline}>Nenhum documento de planejamento vinculado.</p>}
                  </section>
                    : tab === 'diffs' ? <section className={drawerSection} aria-label="Diffs publicados"><TaskDiffsPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} items={diffs.data?.items ?? []} isPending={diffs.isPending} isError={diffs.isError} error={diffs.error} onRetry={() => void diffs.refetch()} /></section>
                      : tab === 'activity' ? <TaskActivityPanel events={taskActivity.data?.items ?? []} unreadEvents={unreadActivity?.count ? unreadActivityEvents.data ?? [] : []} unreadCount={unreadActivity?.count ?? 0} markReadPending={markRead.isPending} markReadError={markRead.isError ? errorMessage(markRead.error) : undefined} onMarkRead={unreadActivity?.cursor !== null && unreadActivity?.cursor !== undefined ? markUnreadAsRead : undefined} onRetryMarkRead={markUnreadAsRead} unreadEventsPending={unreadActivityEvents.isPending && (unreadActivity?.count ?? 0) > 0} unreadEventsError={unreadActivityEvents.isError} onRetryUnreadEvents={() => void unreadActivityEvents.refetch()} isPending={taskActivity.isPending} isError={taskActivity.isError} error={taskActivity.error} onRetry={() => void taskActivity.refetch()} executions={contextExecutions} now={now} />
                        : tab === 'attachments' ? <TaskAttachmentsPanel token={token} nonce={nonce} projectId={projectId} taskId={task._id} onAttachmentViewed={markAttachmentViewed} />
                          : tab === 'memories' ? <TaskMemoriesPanel token={token} projectId={projectId} taskId={task._id} taskName={task.name} />
                            : <section className={drawerSectionMarkdown} aria-label="Conversa da tarefa">
                          <div className="flex flex-wrap items-center justify-between gap-3"><h3>Colaboração da tarefa</h3><Button type="button" className={buttonSecondarySmall} disabled={openConversation.isPending} onClick={() => openConversation.mutate()}>{openConversation.isPending ? 'Abrindo…' : 'Abrir conversa completa'}</Button></div>
                          <div className="grid gap-1.5"><span className={chainLabel}>Conversas vinculadas</span>{linkedConversations.isPending ? <Skeleton rows={1} label="Carregando conversas…" /> : linkedConversations.isError ? <ErrorNotice error={linkedConversations.error} onRetry={() => void linkedConversations.refetch()} /> : linkedConversations.data?.linkedConversations?.length ? <ul className="grid gap-1.5">{linkedConversations.data.linkedConversations.map(item => <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ui-sm border border-line bg-[#fbfcfe] px-2.5 py-2 text-ui-sm" key={item.conversationId}><ConversationLink conversationId={item.conversationId} projectId={projectId}>{item.title || 'Conversa sem título'}</ConversationLink><small className="text-ui-xs text-muted-strong">{plural(item.messageCount, 'mensagem', 'mensagens')}{item.lastActivityAt ? ' · ' + relativeTime(item.lastActivityAt, now) : ''}</small></li>)}</ul> : <p className={emptyInline}>Nenhuma conversa vinculada ainda.</p>}</div>
                          {messages.length ? <ul className="grid gap-3 [&_p]:text-ui-sm [&_p]:leading-normal [&_p]:text-ink-2">{messages.slice(0, 10).map(message => <li className="flex items-start gap-2.5 border-b border-[#eef0f5] pb-3 last:border-b-0" key={message._id}><div className="grid min-w-0 flex-1 gap-1"><div className="flex flex-wrap items-start gap-x-2.5 gap-y-1 text-ui-xs text-muted-strong [&>div]:min-w-0 [&>div]:flex-1 [&_small]:text-ui-xs [&_strong]:text-ui-sm [&_strong]:text-ink"><Badge variant={message.type === 'resposta' ? 'success' : message.type === 'pergunta' ? 'info' : message.type === 'bloqueio' ? 'destructive' : 'muted'}>{message.type === 'resposta' ? 'Resposta' : message.type === 'pergunta' ? 'Pergunta' : message.type === 'bloqueio' ? 'Bloqueio' : message.type || 'Atualização'}</Badge><TaskMessageAuthor message={{ ...message, authorType: message.authorType === 'agent' || message.authorType === 'human' ? message.authorType : 'unknown', clientName: message.clientName ?? null }} variant="head" /><time className="ml-auto whitespace-nowrap" dateTime={message.createdAt} title={formatDate(message.createdAt)}>{relativeTime(message.createdAt, now)}</time></div><TaskMessageBody token={token} nonce={nonce} projectId={projectId} taskId={task._id} message={message} /></div></li>)}</ul> : <p className={emptyInline}>Nenhuma mensagem de colaboração. Use “Abrir conversa completa” para falar com a IA sobre esta tarefa.</p>}
                        </section>}
        </div>
      </div>}
  </>;

  if (!isDrawer) return <section className="overflow-hidden rounded-ui-md border border-line bg-surface" aria-labelledby="details-title">{details}{editorDialog}</section>;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent showCloseButton={false} aria-labelledby="details-title" onEscapeKeyDown={event => { if (review) { event.preventDefault(); setReview(null); } }} className="left-auto right-0 top-0 flex h-dvh min-h-0 max-h-none w-full max-w-[900px] flex-col translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 shadow-2xl sm:max-w-[900px]">
      {details}
      {editorDialog}
    </DialogContent>
  </Dialog>;
}
