import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { allRecords, query } from '../../api';
import type { Project, Task } from '../../api';
import { Badge } from '../../components/ui/Badge';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { IconCheck, IconDiff, IconFeature, IconMail, IconQuestion, IconRefresh, IconSearch } from '../../components/ui/icons';
import { FeatureLink, FilterLink, taskHref } from '../../components/ui/Links';
import { AssigneePicker } from '../../components/ui/AssigneePicker';
import { Person } from '../../components/ui/Person';
import { useAssignees, type Assignee } from './assignees';
import { TableSkeleton } from '../../components/ui/Skeleton';
import { buttonBase, buttonGhost, buttonSecondarySmall, notice, textButton } from '../../components/ui/classes';
import { formatDate } from '../../lib/format';
import { areaLabel, plural, priorityInfo, relativeTime, shortId, typeLabel } from '../../lib/labels';
import { CreateTaskDialog } from './CreateTaskDialog';
import { CreateFeatureDialog } from './CreateFeatureDialog';
import { TaskActionsMenu } from './TaskActionsMenu';
import { TaskKpiBar } from './TaskKpiBar';
import { statusLabels, statusTone } from './status';
import { primaryActionFor, type TaskRowAction } from './task-actions';
import { filterTasks, getTaskFilterOptions, taskFilterOptionLabel } from './task-filters';
import { getSelectedVisibleItems, paginateItems } from './task-pagination';
import { readTaskQueryState, syncTaskQueryState, type TaskQueryState } from './task-query-params';
import { sortLabels, sortTasks } from './task-sort';
import { builtInViews, loadMyEmail, loadSavedViews, matchesView, mineView, snapshotView, storeMyEmail, storeSavedViews, viewPatch, type TaskView } from './task-views';

type TaskWorkspaceProps = {
  token: string;
  nonce: string;
  projectId: string;
  repositories?: Project['repositories'];
  projectAreas?: string[];
  tasks: Task[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  saving: boolean;
  /** Momento (ms) da última sincronização da lista de tarefas. */
  updatedAt?: number;
  refreshing?: boolean;
  onRefresh: () => void;
  onOpenTask: (task: Task, action?: 'details' | 'edit' | 'summary' | 'json' | 'criteria' | 'assign') => void;
  onOpenTaskConversation: (task: Task) => void;
  onTransferTask: (task: Task) => void;
  onChangeStatus: (task: Task) => void;
  onToggleChecked: (task: Task) => void;
  canHardDelete: boolean;
  systemAdmin?: boolean;
  onRequestHardDeleteTask: (task: Task) => void;
  onArchiveTask: (task: Task) => void;
  onApproveSelected: (taskIds: string[], reason: string) => Promise<boolean>;
  onSetTasksChecked: (taskIds: string[], checked: boolean) => Promise<string[]>;
};

type Feature = { _id: string; name: string };
type SyncReport = {
  summary: { taskCount: number; unreadTaskCount: number; openQuestionCount: number };
  tasks: Array<{ taskId: string; unread: { count: number }; openQuestions: unknown[]; gitDiff: unknown | null }>;
};

const flagLabels: Record<string, string> = { unread: 'Com novidades não lidas', questions: 'Com perguntas abertas', diff: 'Com diff Git' };

const primaryTone = 'border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark';
const buttonPrimarySmall = `${buttonBase} min-h-[29px] px-2.5 ${primaryTone}`;
const buttonGhostSmall = `${buttonBase} min-h-[29px] px-2.5 border-transparent bg-transparent text-[#758093]`;
const secondaryTone = 'border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]';
const rowButton = 'inline-flex min-h-[29px] min-w-[76px] items-center justify-center gap-2 rounded-ui-lg border px-2.5 text-ui-xs font-bold transition max-[760px]:flex-[1_1_auto]';
const toolbarFlex = 'max-[420px]:flex-[1_1_auto]';

const panelClass = 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm';
const kbd = 'inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-b-2 border-line-strong bg-white px-1 font-code text-[10px] leading-[normal] font-semibold text-muted-strong';
const viewPill = 'min-h-[28px] border px-3 text-ui-xs font-semibold transition-[background,border-color] duration-150 ease-[ease] enabled:hover:border-[#aab4f2] enabled:hover:bg-[#f6f7ff]';
const viewPillIdle = 'border-line-strong bg-white text-ink-2';
const viewPillActive = 'border-focus bg-tone-blue-bg text-tone-blue';
const filterSelect = 'min-h-[34px] min-w-[110px] rounded-[7px] border border-[#e3e7ef] bg-white py-2 pr-[27px] pl-2.5 text-ui-xs text-ink-2 max-[760px]:w-full';
const pageSelect = 'min-h-[34px] min-w-[58px] rounded-[7px] border border-[#e3e7ef] bg-white py-[5px] pr-[18px] pl-[7px] text-ui-xs text-ink-2';
const advancedLabel = 'grid gap-1.5 text-ui-xs font-semibold text-slate-600';
const advancedControl = 'min-h-[32px] w-full rounded-ui-md border border-slate-200 bg-white p-2 text-ui-xs';
const inlineForm = 'mx-5 mb-3 flex flex-wrap items-end gap-2 rounded-ui-md border border-[#dfe4ff] bg-[#f7f8ff] p-3 text-ui-xs font-bold text-ink-2 max-[760px]:mx-3.5 [&_label]:gap-1';
const inlineLabel = 'grid flex-[1_1_220px] gap-1';
const inlineInput = 'min-h-[32px] rounded-ui-sm border border-line-strong px-2.5 text-ui-sm';
const inlineNote = 'basis-full text-ui-xs font-normal text-muted-strong';
const emptyState = 'grid justify-items-center gap-2 px-[14px] py-[30px] text-center';
const emptyTitle = 'm-0 font-display text-[13px] leading-[normal] font-bold text-[#394558]';
const emptyText = 'mb-2 text-[11px] text-[#8993a3]';

const chip = 'inline-flex items-center gap-1 rounded-ui-sm px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap';
const chipLink = 'cursor-pointer no-underline hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue';
const chipSlate = 'bg-tone-slate-bg text-tone-slate';
const areaChipTone = (area: string) => area === 'backend' ? 'bg-[#eaeeff] text-[#3544a8]' : area === 'frontend' ? 'bg-[#e1f4f1] text-[#136059]' : chipSlate;
const flagChip = 'inline-flex items-center gap-1 rounded-full px-[7px] py-0.5 text-[10.5px] leading-normal font-bold';
const flagButton = `${flagChip} cursor-pointer hover:brightness-[.96]`;
const priorityTone = (tone: string) => tone === 'red' ? 'bg-tone-red-bg text-tone-red' : tone === 'amber' ? 'bg-tone-amber-bg text-tone-amber' : chipSlate;

const th = 'border-y border-slate-100 bg-slate-50 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap text-slate-400 uppercase';
const td = 'border-b border-slate-100 align-top text-ui-sm text-slate-600 max-[760px]:min-w-0 max-[760px]:border-b-0';
const tdFirst = `${td} w-9 px-3 pb-3 pt-[15px] max-[760px]:w-auto max-[760px]:pl-[3px]`;
const tdLast = `${td} w-[1%] py-3 pr-5 pl-3`;
const tdMiddle = `${td} p-3`;
const rowBase = 'transition-[background] duration-100 ease-[ease] max-[760px]:grid max-[760px]:grid-cols-[22px_minmax(0,1fr)_auto] max-[760px]:items-center max-[760px]:gap-[5px] max-[760px]:rounded-[9px] max-[760px]:border max-[760px]:border-[#eceff4] max-[760px]:p-[10px]';
const rowIdle = `${rowBase} hover:bg-[#f8f9ff] max-[760px]:bg-white max-[760px]:hover:bg-[#f8f9ff]`;
const rowSelected = `${rowBase} bg-[#f1f3ff]`;
const checkbox = 'size-[13px] align-middle accent-[#5969dc]';
const pageButton = 'inline-grid size-[27px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[15px] text-[#8792a2] hover:border-[#e8eaf5] hover:bg-[#f6f7fc] hover:text-[#4c5bc9] disabled:border-transparent disabled:bg-transparent';

export function TaskWorkspace({ token, nonce, projectId, repositories = [], projectAreas = ['backend', 'frontend', 'outro'], tasks, isPending, isError, error, saving, updatedAt, refreshing = false, onRefresh, onOpenTask, onOpenTaskConversation, onTransferTask, onChangeStatus, onToggleChecked, canHardDelete, systemAdmin = false, onRequestHardDeleteTask, onArchiveTask, onApproveSelected, onSetTasksChecked }: TaskWorkspaceProps) {
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createFeatureOpen, setCreateFeatureOpen] = useState(false);
  const [createdTaskNotice, setCreatedTaskNotice] = useState('');
  const [createdFeatureNotice, setCreatedFeatureNotice] = useState('');
  const [state, setState] = useState<TaskQueryState>(readTaskQueryState);
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(state.priority || state.responsible || state.featureId || state.createdAfter || state.createdBefore || state.updatedAfter || state.updatedBefore));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [approvalReason, setApprovalReason] = useState('');
  const [savedViews, setSavedViews] = useState<TaskView[]>(() => loadSavedViews(projectId));
  const [viewFormOpen, setViewFormOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [myEmail, setMyEmail] = useState(loadMyEmail);
  const [identityDraft, setIdentityDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  const syncReportQuery = useQuery({
    queryKey: ['project-sync-report', nonce, projectId, state.featureId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => query<SyncReport>(token, 'get_project_sync_report', { projectId, ...(state.featureId ? { featureId: state.featureId } : {}) })
  });
  const featuresQuery = useQuery({
    queryKey: ['project-features', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId, archived: false })
  });
  const assigneesQuery = useAssignees(token, nonce, projectId, systemAdmin);
  // Responsáveis conhecidos: credenciais ativas somadas a quem já aparece nas tarefas do projeto.
  const responsibleOptions = useMemo<Assignee[]>(() => {
    const known = new Map((assigneesQuery.data ?? []).map(item => [item.email.toLowerCase(), item]));
    for (const task of tasks) if (task.responsible && !known.has(task.responsible.toLowerCase())) known.set(task.responsible.toLowerCase(), { email: task.responsible, kind: 'pessoa' });
    return [...known.values()].sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'));
  }, [assigneesQuery.data, tasks]);
  const featureNames = useMemo(() => new Map((featuresQuery.data ?? []).map(feature => [feature._id, feature.name])), [featuresQuery.data]);
  const syncTasks = useMemo(() => new Map((syncReportQuery.data?.tasks ?? []).map(item => [item.taskId, item])), [syncReportQuery.data]);

  const filtered = useMemo(() => {
    const matching = filterTasks(tasks, state).filter(task => {
      if (!state.flag) return true;
      const sync = syncTasks.get(task._id);
      if (state.flag === 'unread') return (sync?.unread.count ?? 0) > 0;
      if (state.flag === 'questions') return (sync?.openQuestions.length ?? 0) > 0;
      return Boolean(sync?.gitDiff);
    });
    return sortTasks(matching, state.sort);
  }, [tasks, state, syncTasks]);
  const filterOptions = useMemo(() => getTaskFilterOptions(tasks, state, projectAreas), [tasks, projectAreas, state]);
  const pagination = paginateItems(filtered, state.page, state.pageSize);
  const { page: currentPage, pageCount: pages, items: visibleTasks } = pagination;
  const countStatus = (status: string) => tasks.filter(task => task.status === status).length;
  const selectionAllowed = (task: Task) => task.status === 'em_revisao' || task.status === 'concluida';
  const selectableTasks = visibleTasks.filter(selectionAllowed);
  const selectedTasks = getSelectedVisibleItems(visibleTasks, selectedIds, selectionAllowed);
  const selectedForApproval = selectedTasks.filter(task => task.status === 'em_revisao');
  const selectedForChecking = selectedTasks.filter(task => task.status === 'concluida' && !task.checked);
  const selectedForUnchecking = selectedTasks.filter(task => task.status === 'concluida' && task.checked);
  const syncState = syncReportQuery.isPending ? 'pending' : syncReportQuery.isError ? 'error' : 'ready';
  const diffCount = syncReportQuery.data?.tasks.filter(item => item.gitDiff).length ?? 0;
  const syncedAt = Math.min(updatedAt ?? Infinity, syncReportQuery.dataUpdatedAt || Infinity);
  const noFilters = matchesView(state, builtInViews[0]) && !state.search;

  function patch(partial: Partial<TaskQueryState>) {
    setState(current => ({ ...current, ...partial, page: 1 }));
    setSelectedIds([]);
  }

  function applyView(view: TaskView) {
    patch({ ...viewPatch(view), createdAfter: '', createdBefore: '', updatedAfter: '', updatedBefore: '' });
  }

  function runTaskAction(task: Task, action: TaskRowAction) {
    if (action === 'details') onOpenTask(task);
    else if (action === 'edit') onOpenTask(task, 'edit');
    else if (action === 'assign') onOpenTask(task, 'assign');
    else if (action === 'status') onChangeStatus(task);
    else if (action === 'conversation') onOpenTaskConversation(task);
    else if (action === 'transfer') onTransferTask(task);
    else if (action === 'summary') onOpenTask(task, 'summary');
    else if (action === 'json') onOpenTask(task, 'json');
    else if (action === 'check') onToggleChecked(task);
    else if (action === 'archive') onArchiveTask(task);
    else if (action === 'delete') onRequestHardDeleteTask(task);
  }

  function refreshAll() {
    onRefresh();
    void syncReportQuery.refetch();
    void featuresQuery.refetch();
  }

  useEffect(() => {
    syncTaskQueryState({ ...state, page: currentPage });
  }, [state, currentPage]);

  useEffect(() => {
    if (projectId && !isPending && state.page !== currentPage) {
      setState(current => ({ ...current, page: currentPage }));
      setSelectedIds([]);
    }
  }, [projectId, isPending, state.page, currentPage]);

  useEffect(() => { setSelectedIds([]); setSavedViews(loadSavedViews(projectId)); }, [projectId]);

  useEffect(() => {
    const eligibleIds = new Set(tasks.filter(selectionAllowed).map(task => task._id));
    setSelectedIds(current => {
      const next = current.filter(id => eligibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [tasks]);

  useEffect(() => {
    if (selectedForApproval.length === 0) setApprovalReason('');
  }, [selectedForApproval.length]);

  useEffect(() => {
    const restoreFromUrl = () => {
      const next = readTaskQueryState();
      setState(next);
      setAdvancedOpen(Boolean(next.priority || next.responsible || next.featureId || next.createdAfter || next.createdBefore || next.updatedAfter || next.updatedBefore));
      setSelectedIds([]);
    };
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const focusSearchOnSlash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener('keydown', focusSearchOnSlash);
    return () => document.removeEventListener('keydown', focusSearchOnSlash);
  }, []);

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds(current => checked ? Array.from(new Set([...current, id])) : current.filter(value => value !== id));
  }

  async function approveSelected() {
    const taskIds = selectedForApproval.map(task => task._id);
    if (taskIds.length && await onApproveSelected(taskIds, approvalReason)) {
      setSelectedIds(current => current.filter(id => !taskIds.includes(id)));
      setApprovalReason('');
    }
  }

  async function updateSelectedChecks(checked: boolean) {
    const targets = checked ? selectedForChecking : selectedForUnchecking;
    const updatedIds = await onSetTasksChecked(targets.map(task => task._id), checked);
    if (updatedIds.length) setSelectedIds(current => current.filter(id => !updatedIds.includes(id)));
  }

  function moveRowFocus(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-row-focus')) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row-focus]'));
    const index = rows.indexOf(target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault();
    rows[next]?.focus();
  }

  function saveCurrentView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('viewName') ?? '').trim();
    if (!name) return;
    const next = [...savedViews, snapshotView(name, state)];
    setSavedViews(next);
    storeSavedViews(projectId, next);
    setViewFormOpen(false);
  }

  function removeView(id: string) {
    const next = savedViews.filter(view => view.id !== id);
    setSavedViews(next);
    storeSavedViews(projectId, next);
  }

  function chooseMine() {
    if (myEmail) applyView(mineView(myEmail));
    else setIdentityOpen(true);
  }

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = identityDraft.trim();
    if (!email) return;
    storeMyEmail(email);
    setMyEmail(email);
    setIdentityOpen(false);
    applyView(mineView(email));
  }

  const views: TaskView[] = [...builtInViews.slice(0, 2), ...(myEmail ? [mineView(myEmail)] : []), ...builtInViews.slice(2), ...savedViews];
  const mineActive = Boolean(myEmail) && matchesView(state, mineView(myEmail));

  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (state.search) chips.push({ key: 'search', label: `Busca: “${state.search}”`, clear: () => patch({ search: '' }) });
  if (state.status !== 'todos') chips.push({ key: 'status', label: `Status: ${statusLabels[state.status] ?? state.status}`, clear: () => patch({ status: 'todos' }) });
  if (state.area !== 'todos') chips.push({ key: 'area', label: `Área: ${areaLabel(state.area)}`, clear: () => patch({ area: 'todos' }) });
  if (state.type !== 'todos') chips.push({ key: 'type', label: `Tipo: ${typeLabel(state.type)}`, clear: () => patch({ type: 'todos' }) });
  if (state.priority) chips.push({ key: 'priority', label: `Prioridade: ${priorityInfo(Number(state.priority)).text}`, clear: () => patch({ priority: '' }) });
  if (state.responsible) chips.push({ key: 'responsible', label: `Responsável: ${state.responsible}`, clear: () => patch({ responsible: '' }) });
  if (state.featureId) chips.push({ key: 'feature', label: `Feature: ${featureNames.get(state.featureId) ?? shortId(state.featureId)}`, clear: () => patch({ featureId: '' }) });
  if (state.flag) chips.push({ key: 'flag', label: flagLabels[state.flag], clear: () => patch({ flag: '' }) });
  if (state.createdAfter) chips.push({ key: 'createdAfter', label: `Criada desde ${state.createdAfter}`, clear: () => patch({ createdAfter: '' }) });
  if (state.createdBefore) chips.push({ key: 'createdBefore', label: `Criada até ${state.createdBefore}`, clear: () => patch({ createdBefore: '' }) });
  if (state.updatedAfter) chips.push({ key: 'updatedAfter', label: `Atualizada desde ${state.updatedAfter}`, clear: () => patch({ updatedAfter: '' }) });
  if (state.updatedBefore) chips.push({ key: 'updatedBefore', label: `Atualizada até ${state.updatedBefore}`, clear: () => patch({ updatedBefore: '' }) });
  const clearAll = () => patch({ ...viewPatch(builtInViews[0]), createdAfter: '', createdBefore: '', updatedAfter: '', updatedBefore: '' });

  const bulkActions = [
    ...(selectedForApproval.length ? [{ key: 'approve', label: `Aprovar (${selectedForApproval.length})`, className: buttonPrimarySmall, onClick: () => void approveSelected() }] : []),
    ...(selectedForChecking.length ? [{ key: 'check', label: `Conferir (${selectedForChecking.length})`, className: buttonSecondarySmall, onClick: () => void updateSelectedChecks(true) }] : []),
    ...(selectedForUnchecking.length ? [{ key: 'uncheck', label: `Desfazer conferência (${selectedForUnchecking.length})`, className: buttonGhostSmall, onClick: () => void updateSelectedChecks(false) }] : [])
  ];

  return <>
    <TaskKpiBar
      counts={{ total: tasks.length, running: countStatus('em_execucao'), review: countStatus('em_revisao'), done: countStatus('concluida'), checked: tasks.filter(task => task.checked).length }}
      sync={syncReportQuery.data ? { questions: syncReportQuery.data.summary.openQuestionCount, unread: syncReportQuery.data.summary.unreadTaskCount, diff: diffCount } : undefined}
      syncState={syncState}
      onSyncRetry={() => void syncReportQuery.refetch()}
      statusFilter={state.status}
      flagFilter={state.flag}
      onStatus={status => patch({ status })}
      onFlag={flag => patch({ flag })}
      onClear={clearAll}
      noFilters={noFilters}
    />

    <section className={panelClass} aria-label="Fila de trabalho">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4 max-[760px]:px-3.5 max-[760px]:pt-[15px] max-[760px]:pb-3">
        <div><h2 className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]">Fila de trabalho</h2><p className="text-ui-xs text-muted-strong" aria-live="polite">{filtered.length} de {tasks.length} tarefa(s){chips.length ? ' · filtradas' : ''}</p></div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-[760px]:justify-start">
          <span className="text-ui-xs whitespace-nowrap text-muted-strong" title={Number.isFinite(syncedAt) ? new Date(syncedAt).toLocaleString('pt-BR') : undefined}>{Number.isFinite(syncedAt) ? `Atualizado ${relativeTime(new Date(syncedAt).toISOString(), now)}` : 'Aguardando primeira carga'}</span>
          <button type="button" className={`${buttonSecondarySmall} ${toolbarFlex}`} onClick={refreshAll} disabled={refreshing || isPending} aria-label="Atualizar lista, resumo e indicadores"><IconRefresh size={13} className={refreshing || syncReportQuery.isFetching ? 'animate-[spin_.8s_linear_infinite]' : undefined} /> Atualizar</button>
          <button type="button" className={`${buttonSecondarySmall} ${toolbarFlex}`} onClick={() => { setCreatedFeatureNotice(''); setCreateFeatureOpen(true); }}>+ Nova feature</button>
          <button type="button" className={`${buttonPrimarySmall} ${toolbarFlex}`} onClick={() => { setCreatedTaskNotice(''); setCreateTaskOpen(true); }}>+ Nova task</button>
        </div>
      </div>
      {createdTaskNotice && <div className={notice.success} role="status">{createdTaskNotice}</div>}
      {createdFeatureNotice && <div className={notice.success} role="status">{createdFeatureNotice}</div>}

      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3 max-[760px]:px-3.5" role="group" aria-label="Visões da fila">
        <span className="mr-0.5 text-ui-xs font-bold text-muted-strong">Visões</span>
        {views.map(view => {
          const active = view.id === 'mine' ? mineActive : matchesView(state, view);
          return <span className="inline-flex items-center" key={view.id}>
            <button type="button" className={`${viewPill} ${view.custom ? 'rounded-l-full rounded-r-none' : 'rounded-full'} ${active ? viewPillActive : viewPillIdle}`} aria-pressed={active} title={view.description} onClick={() => applyView(view)}>{view.label}</button>
            {view.custom && <button type="button" className="min-h-[28px] w-[24px] rounded-r-full border-y border-r border-line-strong bg-white text-[14px] leading-none text-muted-strong hover:bg-tone-red-bg hover:text-tone-red" aria-label={`Remover visão ${view.label}`} title="Remover visão" onClick={() => removeView(view.id)}>×</button>}
          </span>;
        })}
        {!myEmail && <button type="button" className={`${viewPill} rounded-full ${identityOpen ? viewPillActive : viewPillIdle}`} aria-expanded={identityOpen} title="Informe seu e-mail para filtrar as tasks sob sua responsabilidade" onClick={() => { setIdentityDraft(''); chooseMine(); }}>Minhas tasks</button>}
        {myEmail && <button type="button" className={textButton} title={`Responsável: ${myEmail}. Clique para trocar.`} onClick={() => { setIdentityDraft(myEmail); setIdentityOpen(open => !open); }}>trocar responsável</button>}
        <button type="button" className={`${viewPill} rounded-full border-dashed bg-white text-muted-strong`} aria-expanded={viewFormOpen} disabled={noFilters} title={noFilters ? 'Aplique filtros para salvar uma visão' : 'Salvar os filtros atuais como visão'} onClick={() => setViewFormOpen(open => !open)}>+ Salvar visão</button>
      </div>
      {identityOpen && <form className={inlineForm} onSubmit={saveIdentity}><AssigneePicker label="Quem é você? (responsável cadastrado)" assignees={responsibleOptions} isPending={assigneesQuery.isPending} isError={assigneesQuery.isError} defaultValue={myEmail} allowCustom={false} emptyLabel="Selecione seu nome" onChange={setIdentityDraft} /><button className={buttonPrimarySmall} disabled={!identityDraft.trim()}>Usar</button><button type="button" className={buttonGhostSmall} onClick={() => setIdentityOpen(false)}>Cancelar</button><small className={inlineNote}>Fica salvo só neste navegador. Falta o seu nome? Cadastre em Administração › Responsáveis.</small></form>}
      {viewFormOpen && <form className={inlineForm} onSubmit={saveCurrentView}><label className={inlineLabel}>Nome da visão<input className={inlineInput} name="viewName" required autoFocus maxLength={40} placeholder="Ex.: Backend em revisão" /></label><button className={buttonPrimarySmall}>Salvar</button><button type="button" className={buttonGhostSmall} onClick={() => setViewFormOpen(false)}>Cancelar</button><small className={inlineNote}>Guarda busca, status, área, tipo, prioridade, responsável, feature e ordenação.</small></form>}

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3.5 max-[760px]:grid max-[760px]:grid-cols-[1fr_1fr] max-[760px]:px-3.5 max-[760px]:pb-3">
        <label className="flex h-[34px] min-w-[260px] flex-1 items-center gap-2 rounded-[7px] border border-[#e3e7ef] px-2.5 text-[#9ba5b4] focus-within:border-[#929ef2] focus-within:shadow-[0_0_0_3px_#596ce31a] max-[760px]:col-[1/-1] max-[760px]:min-w-0"><span className="grid place-items-center text-[17px]" aria-hidden="true"><IconSearch size={15} /></span><input ref={searchRef} className="w-full min-w-0 border-0 text-ui-sm text-[#394558] shadow-none outline-0" value={state.search} onChange={event => patch({ search: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { if (state.search) patch({ search: '' }); else event.currentTarget.blur(); } }} placeholder="Buscar por tarefa, ID ou responsável" aria-label="Buscar tarefas" aria-keyshortcuts="/" /><kbd className={kbd} aria-hidden="true">/</kbd></label>
        <select className={filterSelect} aria-label="Filtrar por status" value={state.status} onChange={event => patch({ status: event.target.value })}><option value="todos">Todos os status</option>{filterOptions.status.map(({ value, count }) => <option key={value} value={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <select className={filterSelect} aria-label="Filtrar por área" value={state.area} onChange={event => patch({ area: event.target.value })}><option value="todos">Todas as áreas</option>{filterOptions.area.map(({ value, count }) => <option key={value} value={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <select className={filterSelect} aria-label="Filtrar por tipo" value={state.type} onChange={event => patch({ type: event.target.value })}><option value="todos">Todos os tipos</option>{filterOptions.type.map(({ value, count }) => <option value={value} key={value}>{typeLabel(value)} ({count})</option>)}</select>
        <select className={filterSelect} aria-label="Ordenar tarefas" value={state.sort} onChange={event => patch({ sort: event.target.value })}>{Object.entries(sortLabels).map(([value, label]) => <option value={value} key={value}>Ordem: {label}</option>)}</select>
        <button type="button" className={buttonGhost} onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>{advancedOpen ? '−' : '+'} Mais filtros</button>
      </div>
      {advancedOpen && <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-4">
        <label className={advancedLabel}>Prioridade<select className={advancedControl} aria-label="Filtrar por prioridade" value={state.priority} onChange={event => patch({ priority: event.target.value })}><option value="">Todas</option>{filterOptions.priority.map(({ value, count }) => <option value={value} key={value}>{priorityInfo(Number(value)).text} ({count})</option>)}</select></label>
        <label className={advancedLabel}>Responsável<select className={advancedControl} aria-label="Filtrar por responsável" value={state.responsible} onChange={event => patch({ responsible: event.target.value })}><option value="">Todos</option>{state.responsible && !responsibleOptions.some(item => item.email === state.responsible) && <option value={state.responsible}>{state.responsible}</option>}{responsibleOptions.map(item => <option value={item.email} key={item.email}>{item.email}{item.kind === 'agente' ? ' (agente)' : ''}</option>)}</select></label>
        <label className={advancedLabel}>Feature<select className={advancedControl} aria-label="Filtrar por feature" value={state.featureId} onChange={event => patch({ featureId: event.target.value })}><option value="">Todas</option>{state.featureId && !featureNames.has(state.featureId) && <option value={state.featureId}>{`Feature ${shortId(state.featureId)}`}</option>}{(featuresQuery.data ?? []).map(feature => <option value={feature._id} key={feature._id}>{feature.name}</option>)}</select></label>
        <label className={advancedLabel}>Criada de<input className={advancedControl} type="date" value={state.createdAfter} onChange={event => patch({ createdAfter: event.target.value })} /></label>
        <label className={advancedLabel}>Criada até<input className={advancedControl} type="date" value={state.createdBefore} onChange={event => patch({ createdBefore: event.target.value })} /></label>
        <label className={advancedLabel}>Atualizada de<input className={advancedControl} type="date" value={state.updatedAfter} onChange={event => patch({ updatedAfter: event.target.value })} /></label>
        <label className={advancedLabel}>Atualizada até<input className={advancedControl} type="date" value={state.updatedBefore} onChange={event => patch({ updatedBefore: event.target.value })} /></label>
        <button type="button" className={`${textButton} self-end`} onClick={() => patch({ priority: '', responsible: '', featureId: '', createdAfter: '', createdBefore: '', updatedAfter: '', updatedBefore: '' })}>Limpar avançados</button>
      </div>}
      {chips.length > 0 && <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3 max-[760px]:px-3.5" role="group" aria-label="Filtros ativos">
        {chips.map(chip => <button type="button" className="group/chip inline-flex min-h-[26px] items-center gap-1.5 rounded-full border border-[#cfd6fa] bg-tone-blue-bg pr-1.5 pl-2.5 text-ui-xs font-semibold text-tone-blue hover:bg-[#e2e6ff]" key={chip.key} onClick={chip.clear} aria-label={`Remover filtro ${chip.label}`} title="Remover filtro">{chip.label}<span className="grid size-4 place-items-center rounded-[50%] text-[13px] leading-none group-hover/chip:bg-[#c8d0fb]" aria-hidden="true">×</span></button>)}
        <button type="button" className={textButton} onClick={clearAll}>Limpar tudo</button>
      </div>}
      {selectedTasks.length > 0 && <div className="mx-5 mb-3 flex flex-wrap items-center gap-2.5 rounded-[8px] border border-[#dfe4ff] bg-[#f7f8ff] px-3 py-2.5 text-ui-xs text-[#4b58b8] max-[760px]:mx-3"><span>{selectedTasks.length} tarefa(s) selecionada(s)</span>{selectedForApproval.length > 0 && <input className="min-w-[150px] flex-1 rounded-ui-sm border border-[#e1e5f4] px-[9px] py-[7px] text-[10px] text-[#364154]" value={approvalReason} onChange={event => setApprovalReason(event.target.value)} placeholder="Motivo da aprovação (opcional)" aria-label="Motivo para aprovar tarefas selecionadas" />}<div className="ml-auto flex flex-wrap items-center gap-[7px] max-[760px]:ml-0 max-[760px]:w-full">{bulkActions.map(action => <button type="button" key={action.key} className={action.className} disabled={saving} onClick={action.onClick}>{action.label}</button>)}</div><button type="button" className={textButton} disabled={saving} onClick={() => setSelectedIds([])}>Limpar seleção</button></div>}

      {isPending ? <TableSkeleton /> : isError ? <div className="px-6 pt-3 pb-4"><ErrorNotice title="Não foi possível carregar as tarefas" error={error} onRetry={refreshAll} /></div> : visibleTasks.length ? <div className="overflow-x-auto max-[760px]:overflow-visible"><table className="w-full border-collapse text-left min-[760px]:max-[1100px]:min-w-[820px] max-[760px]:block">
        <thead className="max-[760px]:hidden"><tr><th className={`${th} w-9 px-3`}><input className={checkbox} type="checkbox" aria-label="Selecionar tarefas elegíveis nesta página" disabled={saving || selectableTasks.length === 0} checked={selectableTasks.length > 0 && selectableTasks.every(task => selectedIds.includes(task._id))} onChange={event => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...selectableTasks.map(task => task._id)])) : selectedIds.filter(id => !selectableTasks.some(task => task._id === id)))} /></th><th className={`${th} px-3`}>Tarefa</th><th className={`${th} px-3`}>Status</th><th className={`${th} px-3`}>Prioridade</th><th className={`${th} px-3`}>Responsável</th><th className={`${th} px-3`}>Atualizada</th><th className={`${th} w-[1%] pr-5 pl-3`}><span className="sr-only">Ações</span></th></tr></thead>
        <tbody className="max-[760px]:grid max-[760px]:gap-2 max-[760px]:px-[9px]" onKeyDown={moveRowFocus}>{visibleTasks.map(task => {
          const taskSync = syncTasks.get(task._id);
          const openQuestions = taskSync?.openQuestions ?? [];
          const unread = taskSync?.unread.count ?? 0;
          const featureName = task.featureId ? featureNames.get(task.featureId) : undefined;
          const priority = priorityInfo(task.priority);
          const primary = primaryActionFor(task);
          return <tr key={task._id} className={selectedIds.includes(task._id) ? rowSelected : rowIdle} data-status={task.status}>
          <td className={tdFirst}><input className={checkbox} type="checkbox" aria-label={'Selecionar ' + task.name} disabled={!selectionAllowed(task) || saving} checked={selectedIds.includes(task._id)} onChange={event => toggleSelected(task._id, event.target.checked)} /></td>
          <td className={`${tdMiddle} min-w-[300px] max-[760px]:col-[2/4]`}>
            <a className="block max-w-[560px] overflow-hidden text-left text-ui-md font-bold text-ellipsis whitespace-nowrap text-ink no-underline hover:text-tone-blue hover:underline focus-visible:rounded-[4px] focus-visible:outline-offset-[3px] max-[760px]:leading-[1.4] max-[760px]:whitespace-normal" data-row-focus href={taskHref(projectId, task._id)} title={task.name} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenTask(task); }}>{task.name}</a>
            <div className="mt-1.5 flex flex-wrap items-center gap-[5px]">
              <code className="inline-block rounded-[5px] bg-[#f3f4f8] px-1.5 py-px font-code text-[10px] leading-[normal] font-semibold text-muted-strong" title={task._id}>{shortId(task._id)}</code>
              {task.area ? <FilterLink param="area" value={task.area} projectId={projectId} className={`${chip} max-w-full ${chipLink} ${areaChipTone(task.area)}`} title={`Filtrar pela área ${areaLabel(task.area)}`}>{areaLabel(task.area)}</FilterLink> : <span className={`${chip} max-w-full ${chipSlate}`}>{areaLabel(task.area)}</span>}
              {(task.acceptance?.length ?? 0) > 0 && (() => { const total = task.acceptance!.length; const done = task.acceptance!.filter((_item, index) => task.acceptanceProgress?.[index] === true).length; return <button type="button" className={`${flagButton} ${done === total ? 'bg-tone-green-bg text-tone-green' : chipSlate}`} title={`Critérios de aceite: ${done} de ${total} atendidos. Abrir critérios`} aria-label={`Ver critérios de aceite de ${task.name}, ${done} de ${total} atendidos`} onClick={() => onOpenTask(task, 'criteria')}><IconCheck size={12} />{done}/{total} critérios</button>; })()}
              {task.type && <FilterLink param="type" value={task.type} projectId={projectId} className={`${chip} max-w-full ${chipLink} bg-[#f4effc] text-[#603d99]`} title={`Filtrar pelo tipo ${typeLabel(task.type)}`}>{typeLabel(task.type)}</FilterLink>}
              {featureName && task.featureId && <FeatureLink featureId={task.featureId} projectId={projectId} className={`${chip} max-w-[240px] ${chipLink} border border-line-strong bg-white text-ink-2`} title={`Ver todas as tarefas da feature “${featureName}”`}><IconFeature size={11} /><span className="overflow-hidden text-ellipsis">{featureName}</span></FeatureLink>}
              {unread > 0 && <button type="button" className={`${flagButton} bg-tone-amber-bg text-tone-amber`} title={`${plural(unread, 'atividade não lida', 'atividades não lidas')}. Abrir detalhes`} aria-label={`Abrir detalhes de ${task.name}, ${plural(unread, 'atividade não lida', 'atividades não lidas')}`} onClick={() => onOpenTask(task)}><IconMail size={12} />{unread}</button>}
              {openQuestions.length > 0 && <button type="button" className={`${flagButton} bg-tone-blue-bg text-tone-blue`} title={`${plural(openQuestions.length, 'pergunta aberta', 'perguntas abertas')}. Abrir conversa`} aria-label={`Abrir conversa de ${task.name}, ${plural(openQuestions.length, 'pergunta aberta', 'perguntas abertas')}`} onClick={() => onOpenTaskConversation(task)}><IconQuestion size={12} />{openQuestions.length}</button>}
              {Boolean(taskSync?.gitDiff) && <span className={`${flagChip} bg-tone-green-bg text-tone-green`} title="Há diff Git publicado nesta tarefa" role="img" aria-label="Diff Git publicado"><IconDiff size={12} />diff</span>}
            </div>
            {task.checked && <small className="mt-1.5 inline-flex items-center gap-1 text-ui-xs font-semibold text-tone-green"><IconCheck size={11} /> Conferida por {task.checkedBy || 'membro'}</small>}
          </td>
          <td className={`${tdMiddle} max-[760px]:col-[2] max-[760px]:row-[2]`}><Badge tone={statusTone[task.status]}>{statusLabels[task.status] ?? task.status}</Badge></td>
          <td className={`${tdMiddle} max-[760px]:col-[3] max-[760px]:row-[2] max-[760px]:justify-self-end`}><span className={`inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap ${priorityTone(priority.tone)}`} title={priority.text}>{priority.text}</span></td>
          <td className={`${tdMiddle} max-[760px]:col-[2] max-[760px]:row-[3]`}><Person identity={task.responsible} /></td>
          <td className={`${tdMiddle} max-[760px]:col-[3] max-[760px]:row-[3] max-[760px]:justify-self-end`}><time className="text-ui-xs whitespace-nowrap text-muted-strong" dateTime={task.updatedAt} title={formatDate(task.updatedAt)}>{relativeTime(task.updatedAt, now)}</time></td>
          <td className={`${tdLast} max-[760px]:col-[2/4] max-[760px]:row-[4] max-[760px]:justify-self-stretch`}><div className="flex items-center justify-end gap-1.5 max-[760px]:justify-start"><button type="button" className={`${rowButton} ${primary.emphasis ? primaryTone : secondaryTone}`} aria-label={`${primary.label}: ${task.name}`} disabled={primary.id === 'check' && saving} onClick={() => runTaskAction(task, primary.id)}>{primary.label}</button><TaskActionsMenu task={task} canHardDelete={canHardDelete} saving={saving} onAction={action => runTaskAction(task, action)} /></div></td>
        </tr>;
        })}</tbody>
      </table></div> : <div className={emptyState}>
        {chips.length ? <><h3 className={emptyTitle}>Nenhuma tarefa com esses filtros</h3><p className={emptyText}>Remova algum filtro ou volte para a visão “Todas”.</p><button type="button" className={buttonSecondarySmall} onClick={clearAll}>Limpar filtros</button></>
          : tasks.length ? <><h3 className={emptyTitle}>Nenhuma tarefa nesta página</h3><p className={emptyText}>Volte para a primeira página da lista.</p></>
            : <><h3 className={emptyTitle}>Este projeto ainda não tem tarefas</h3><p className={emptyText}>Crie uma feature e depois as tasks de back e front que a compõem.</p><button type="button" className={buttonPrimarySmall} onClick={() => { setCreatedTaskNotice(''); setCreateTaskOpen(true); }}>+ Nova task</button></>}
      </div>}
      {state.flag && syncState === 'pending' && <p className="px-6 pt-3 pb-4 text-muted-strong">Aguardando os indicadores de colaboração para aplicar o filtro “{flagLabels[state.flag]}”…</p>}

      <footer className="flex flex-wrap items-center justify-between gap-[14px] px-5 py-3 text-ui-xs text-muted-strong max-[760px]:px-[13px] max-[760px]:py-[11px]"><span>Mostrando {pagination.firstItem}–{pagination.lastItem} de {filtered.length}</span><span className="inline-flex items-center gap-1 text-ui-xs text-muted-strong max-[760px]:hidden" aria-hidden="true"><kbd className={kbd}>/</kbd> buscar · <kbd className={kbd}>↑</kbd><kbd className={kbd}>↓</kbd> navegar · <kbd className={kbd}>Enter</kbd> abrir · <kbd className={kbd}>Esc</kbd> fechar</span><div className="flex items-center gap-2.5 text-ui-xs max-[760px]:ml-auto"><label className="flex items-center gap-1.5">Por página <select className={pageSelect} value={state.pageSize} onChange={event => { setState(current => ({ ...current, pageSize: Number(event.target.value), page: 1 })); setSelectedIds([]); }}><option>10</option><option>25</option><option>50</option><option>100</option></select></label><button type="button" className={pageButton} disabled={currentPage <= 1} onClick={() => { setState(current => ({ ...current, page: currentPage - 1 })); setSelectedIds([]); }} aria-label="Página anterior">‹</button><span>Página {currentPage} de {pages}</span><button type="button" className={pageButton} disabled={currentPage >= pages} onClick={() => { setState(current => ({ ...current, page: currentPage + 1 })); setSelectedIds([]); }} aria-label="Próxima página">›</button></div></footer>
    </section>
    {createTaskOpen && <CreateTaskDialog key={projectId} token={token} nonce={nonce} projectId={projectId} repositories={repositories ?? []} areas={projectAreas} tasks={tasks} defaultFeatureId={state.featureId} systemAdmin={systemAdmin} close={() => setCreateTaskOpen(false)} onCreated={task => { setCreateTaskOpen(false); setCreatedTaskNotice(`Task “${task.name}” criada.`); }} />}
    {createFeatureOpen && <CreateFeatureDialog key={projectId} token={token} nonce={nonce} projectId={projectId} close={() => setCreateFeatureOpen(false)} onCreated={feature => { setCreateFeatureOpen(false); setCreatedFeatureNotice(`Feature “${feature.name}” criada.`); }} />}
  </>;
}
