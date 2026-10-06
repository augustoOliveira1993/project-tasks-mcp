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
    ...(selectedForApproval.length ? [{ key: 'approve', label: `Aprovar (${selectedForApproval.length})`, className: 'button primary small-button', onClick: () => void approveSelected() }] : []),
    ...(selectedForChecking.length ? [{ key: 'check', label: `Conferir (${selectedForChecking.length})`, className: 'button secondary small-button', onClick: () => void updateSelectedChecks(true) }] : []),
    ...(selectedForUnchecking.length ? [{ key: 'uncheck', label: `Desfazer conferência (${selectedForUnchecking.length})`, className: 'button ghost small-button', onClick: () => void updateSelectedChecks(false) }] : [])
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

    <section className="panel-card task-panel" aria-label="Fila de trabalho">
      <div className="task-panel-heading">
        <div><h2>Fila de trabalho</h2><p className="muted-text" aria-live="polite">{filtered.length} de {tasks.length} tarefa(s){chips.length ? ' · filtradas' : ''}</p></div>
        <div className="task-toolbar-actions">
          <span className="sync-stamp" title={Number.isFinite(syncedAt) ? new Date(syncedAt).toLocaleString('pt-BR') : undefined}>{Number.isFinite(syncedAt) ? `Atualizado ${relativeTime(new Date(syncedAt).toISOString(), now)}` : 'Aguardando primeira carga'}</span>
          <button type="button" className="button secondary small-button" onClick={refreshAll} disabled={refreshing || isPending} aria-label="Atualizar lista, resumo e indicadores"><IconRefresh size={13} className={refreshing || syncReportQuery.isFetching ? 'spin' : undefined} /> Atualizar</button>
          <button type="button" className="button secondary small-button" onClick={() => { setCreatedFeatureNotice(''); setCreateFeatureOpen(true); }}>+ Nova feature</button>
          <button type="button" className="button primary small-button" onClick={() => { setCreatedTaskNotice(''); setCreateTaskOpen(true); }}>+ Nova task</button>
        </div>
      </div>
      {createdTaskNotice && <div className="notice success" role="status">{createdTaskNotice}</div>}
      {createdFeatureNotice && <div className="notice success" role="status">{createdFeatureNotice}</div>}

      <div className="views-bar" role="group" aria-label="Visões da fila">
        <span className="views-label">Visões</span>
        {views.map(view => {
          const active = view.id === 'mine' ? mineActive : matchesView(state, view);
          return <span className={'view-pill-wrap' + (view.custom ? ' custom' : '')} key={view.id}>
            <button type="button" className={'view-pill' + (active ? ' active' : '')} aria-pressed={active} title={view.description} onClick={() => applyView(view)}>{view.label}</button>
            {view.custom && <button type="button" className="view-pill-remove" aria-label={`Remover visão ${view.label}`} title="Remover visão" onClick={() => removeView(view.id)}>×</button>}
          </span>;
        })}
        {!myEmail && <button type="button" className={'view-pill' + (identityOpen ? ' active' : '')} aria-expanded={identityOpen} title="Informe seu e-mail para filtrar as tasks sob sua responsabilidade" onClick={() => { setIdentityDraft(''); chooseMine(); }}>Minhas tasks</button>}
        {myEmail && <button type="button" className="text-button" title={`Responsável: ${myEmail}. Clique para trocar.`} onClick={() => { setIdentityDraft(myEmail); setIdentityOpen(open => !open); }}>trocar responsável</button>}
        <button type="button" className="view-pill view-pill-add" aria-expanded={viewFormOpen} disabled={noFilters} title={noFilters ? 'Aplique filtros para salvar uma visão' : 'Salvar os filtros atuais como visão'} onClick={() => setViewFormOpen(open => !open)}>+ Salvar visão</button>
      </div>
      {identityOpen && <form className="inline-form" onSubmit={saveIdentity}><AssigneePicker label="Quem é você? (responsável cadastrado)" assignees={responsibleOptions} isPending={assigneesQuery.isPending} isError={assigneesQuery.isError} defaultValue={myEmail} allowCustom={false} emptyLabel="Selecione seu nome" onChange={setIdentityDraft} /><button className="button primary small-button" disabled={!identityDraft.trim()}>Usar</button><button type="button" className="button ghost small-button" onClick={() => setIdentityOpen(false)}>Cancelar</button><small>Fica salvo só neste navegador. Falta o seu nome? Cadastre em Administração › Responsáveis.</small></form>}
      {viewFormOpen && <form className="inline-form" onSubmit={saveCurrentView}><label>Nome da visão<input name="viewName" required autoFocus maxLength={40} placeholder="Ex.: Backend em revisão" /></label><button className="button primary small-button">Salvar</button><button type="button" className="button ghost small-button" onClick={() => setViewFormOpen(false)}>Cancelar</button><small>Guarda busca, status, área, tipo, prioridade, responsável, feature e ordenação.</small></form>}

      <div className="filters-row">
        <label className="search-field"><span aria-hidden="true"><IconSearch size={15} /></span><input ref={searchRef} value={state.search} onChange={event => patch({ search: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { if (state.search) patch({ search: '' }); else event.currentTarget.blur(); } }} placeholder="Buscar por tarefa, ID ou responsável" aria-label="Buscar tarefas" aria-keyshortcuts="/" /><kbd className="kbd-hint" aria-hidden="true">/</kbd></label>
        <select aria-label="Filtrar por status" value={state.status} onChange={event => patch({ status: event.target.value })}><option value="todos">Todos os status</option>{filterOptions.status.map(({ value, count }) => <option key={value} value={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <select aria-label="Filtrar por área" value={state.area} onChange={event => patch({ area: event.target.value })}><option value="todos">Todas as áreas</option>{filterOptions.area.map(({ value, count }) => <option key={value} value={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <select aria-label="Filtrar por tipo" value={state.type} onChange={event => patch({ type: event.target.value })}><option value="todos">Todos os tipos</option>{filterOptions.type.map(({ value, count }) => <option value={value} key={value}>{typeLabel(value)} ({count})</option>)}</select>
        <select aria-label="Ordenar tarefas" value={state.sort} onChange={event => patch({ sort: event.target.value })}>{Object.entries(sortLabels).map(([value, label]) => <option value={value} key={value}>Ordem: {label}</option>)}</select>
        <button type="button" className="button ghost filter-toggle" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>{advancedOpen ? '−' : '+'} Mais filtros</button>
      </div>
      {advancedOpen && <div className="advanced-filters">
        <label>Prioridade<select aria-label="Filtrar por prioridade" value={state.priority} onChange={event => patch({ priority: event.target.value })}><option value="">Todas</option>{filterOptions.priority.map(({ value, count }) => <option value={value} key={value}>{priorityInfo(Number(value)).text} ({count})</option>)}</select></label>
        <label>Responsável<select aria-label="Filtrar por responsável" value={state.responsible} onChange={event => patch({ responsible: event.target.value })}><option value="">Todos</option>{state.responsible && !responsibleOptions.some(item => item.email === state.responsible) && <option value={state.responsible}>{state.responsible}</option>}{responsibleOptions.map(item => <option value={item.email} key={item.email}>{item.email}{item.kind === 'agente' ? ' (agente)' : ''}</option>)}</select></label>
        <label>Feature<select aria-label="Filtrar por feature" value={state.featureId} onChange={event => patch({ featureId: event.target.value })}><option value="">Todas</option>{state.featureId && !featureNames.has(state.featureId) && <option value={state.featureId}>{`Feature ${shortId(state.featureId)}`}</option>}{(featuresQuery.data ?? []).map(feature => <option value={feature._id} key={feature._id}>{feature.name}</option>)}</select></label>
        <label>Criada de<input type="date" value={state.createdAfter} onChange={event => patch({ createdAfter: event.target.value })} /></label>
        <label>Criada até<input type="date" value={state.createdBefore} onChange={event => patch({ createdBefore: event.target.value })} /></label>
        <label>Atualizada de<input type="date" value={state.updatedAfter} onChange={event => patch({ updatedAfter: event.target.value })} /></label>
        <label>Atualizada até<input type="date" value={state.updatedBefore} onChange={event => patch({ updatedBefore: event.target.value })} /></label>
        <button type="button" className="text-button clear-advanced" onClick={() => patch({ priority: '', responsible: '', featureId: '', createdAfter: '', createdBefore: '', updatedAfter: '', updatedBefore: '' })}>Limpar avançados</button>
      </div>}
      {chips.length > 0 && <div className="filter-chips" role="group" aria-label="Filtros ativos">
        {chips.map(chip => <button type="button" className="filter-chip" key={chip.key} onClick={chip.clear} aria-label={`Remover filtro ${chip.label}`} title="Remover filtro">{chip.label}<span aria-hidden="true">×</span></button>)}
        <button type="button" className="text-button" onClick={clearAll}>Limpar tudo</button>
      </div>}
      {selectedTasks.length > 0 && <div className="bulk-bar"><span>{selectedTasks.length} tarefa(s) selecionada(s)</span>{selectedForApproval.length > 0 && <input value={approvalReason} onChange={event => setApprovalReason(event.target.value)} placeholder="Motivo da aprovação (opcional)" aria-label="Motivo para aprovar tarefas selecionadas" />}<div className="bulk-actions">{bulkActions.map(action => <button type="button" key={action.key} className={action.className} disabled={saving} onClick={action.onClick}>{action.label}</button>)}</div><button type="button" className="text-button" disabled={saving} onClick={() => setSelectedIds([])}>Limpar seleção</button></div>}

      {isPending ? <TableSkeleton /> : isError ? <div className="panel-pad"><ErrorNotice title="Não foi possível carregar as tarefas" error={error} onRetry={refreshAll} /></div> : visibleTasks.length ? <div className="table-scroll"><table className="task-table">
        <thead><tr><th><input type="checkbox" aria-label="Selecionar tarefas elegíveis nesta página" disabled={saving || selectableTasks.length === 0} checked={selectableTasks.length > 0 && selectableTasks.every(task => selectedIds.includes(task._id))} onChange={event => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...selectableTasks.map(task => task._id)])) : selectedIds.filter(id => !selectableTasks.some(task => task._id === id)))} /></th><th>Tarefa</th><th>Status</th><th>Prioridade</th><th>Responsável</th><th>Atualizada</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody onKeyDown={moveRowFocus}>{visibleTasks.map(task => {
          const taskSync = syncTasks.get(task._id);
          const openQuestions = taskSync?.openQuestions ?? [];
          const unread = taskSync?.unread.count ?? 0;
          const featureName = task.featureId ? featureNames.get(task.featureId) : undefined;
          const priority = priorityInfo(task.priority);
          const primary = primaryActionFor(task);
          return <tr key={task._id} className={selectedIds.includes(task._id) ? 'selected-row' : undefined} data-status={task.status}>
          <td><input type="checkbox" aria-label={'Selecionar ' + task.name} disabled={!selectionAllowed(task) || saving} checked={selectedIds.includes(task._id)} onChange={event => toggleSelected(task._id, event.target.checked)} /></td>
          <td className="task-cell">
            <a className="task-name" data-row-focus href={taskHref(projectId, task._id)} title={task.name} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenTask(task); }}>{task.name}</a>
            <div className="task-meta">
              <code className="task-id" title={task._id}>{shortId(task._id)}</code>
              {task.area ? <FilterLink param="area" value={task.area} projectId={projectId} className={`chip chip-area chip-area-${task.area} entity-chip`} title={`Filtrar pela área ${areaLabel(task.area)}`}>{areaLabel(task.area)}</FilterLink> : <span className="chip chip-area chip-area-none">{areaLabel(task.area)}</span>}
              {(task.acceptance?.length ?? 0) > 0 && (() => { const total = task.acceptance!.length; const done = task.acceptance!.filter((_item, index) => task.acceptanceProgress?.[index] === true).length; return <button type="button" className={'flag-chip flag-criteria' + (done === total ? ' complete' : '')} title={`Critérios de aceite: ${done} de ${total} atendidos. Abrir critérios`} aria-label={`Ver critérios de aceite de ${task.name}, ${done} de ${total} atendidos`} onClick={() => onOpenTask(task, 'criteria')}><IconCheck size={12} />{done}/{total} critérios</button>; })()}
              {task.type && <FilterLink param="type" value={task.type} projectId={projectId} className="chip chip-type entity-chip" title={`Filtrar pelo tipo ${typeLabel(task.type)}`}>{typeLabel(task.type)}</FilterLink>}
              {featureName && task.featureId && <FeatureLink featureId={task.featureId} projectId={projectId} className="chip chip-feature entity-chip" title={`Ver todas as tarefas da feature “${featureName}”`}><IconFeature size={11} /><span>{featureName}</span></FeatureLink>}
              {unread > 0 && <button type="button" className="task-unread-link flag-chip flag-unread" title={`${plural(unread, 'atividade não lida', 'atividades não lidas')}. Abrir detalhes`} aria-label={`Abrir detalhes de ${task.name}, ${plural(unread, 'atividade não lida', 'atividades não lidas')}`} onClick={() => onOpenTask(task)}><IconMail size={12} />{unread}</button>}
              {openQuestions.length > 0 && <button type="button" className="task-question-link flag-chip flag-question" title={`${plural(openQuestions.length, 'pergunta aberta', 'perguntas abertas')}. Abrir conversa`} aria-label={`Abrir conversa de ${task.name}, ${plural(openQuestions.length, 'pergunta aberta', 'perguntas abertas')}`} onClick={() => onOpenTaskConversation(task)}><IconQuestion size={12} />{openQuestions.length}</button>}
              {Boolean(taskSync?.gitDiff) && <span className="flag-chip flag-diff" title="Há diff Git publicado nesta tarefa" role="img" aria-label="Diff Git publicado"><IconDiff size={12} />diff</span>}
            </div>
            {task.checked && <small className="checked-label"><IconCheck size={11} /> Conferida por {task.checkedBy || 'membro'}</small>}
          </td>
          <td><Badge tone={statusTone[task.status]}>{statusLabels[task.status] ?? task.status}</Badge></td>
          <td><span className={`priority priority-${priority.tone}`} title={priority.text}>{priority.text}</span></td>
          <td><Person identity={task.responsible} /></td>
          <td><time dateTime={task.updatedAt} title={formatDate(task.updatedAt)}>{relativeTime(task.updatedAt, now)}</time></td>
          <td><div className="row-actions"><button type="button" className={primary.emphasis ? 'button primary small-button row-primary' : 'button secondary small-button row-primary'} aria-label={`${primary.label}: ${task.name}`} disabled={primary.id === 'check' && saving} onClick={() => runTaskAction(task, primary.id)}>{primary.label}</button><TaskActionsMenu task={task} canHardDelete={canHardDelete} saving={saving} onAction={action => runTaskAction(task, action)} /></div></td>
        </tr>;
        })}</tbody>
      </table></div> : <div className="empty-state compact">
        {chips.length ? <><h3>Nenhuma tarefa com esses filtros</h3><p>Remova algum filtro ou volte para a visão “Todas”.</p><button type="button" className="button secondary small-button" onClick={clearAll}>Limpar filtros</button></>
          : tasks.length ? <><h3>Nenhuma tarefa nesta página</h3><p>Volte para a primeira página da lista.</p></>
            : <><h3>Este projeto ainda não tem tarefas</h3><p>Crie uma feature e depois as tasks de back e front que a compõem.</p><button type="button" className="button primary small-button" onClick={() => { setCreatedTaskNotice(''); setCreateTaskOpen(true); }}>+ Nova task</button></>}
      </div>}
      {state.flag && syncState === 'pending' && <p className="panel-pad muted-text">Aguardando os indicadores de colaboração para aplicar o filtro “{flagLabels[state.flag]}”…</p>}

      <footer className="table-footer"><span>Mostrando {pagination.firstItem}–{pagination.lastItem} de {filtered.length}</span><span className="shortcut-hint" aria-hidden="true"><kbd>/</kbd> buscar · <kbd>↑</kbd><kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</span><div className="pagination"><label>Por página <select value={state.pageSize} onChange={event => { setState(current => ({ ...current, pageSize: Number(event.target.value), page: 1 })); setSelectedIds([]); }}><option>10</option><option>25</option><option>50</option><option>100</option></select></label><button type="button" className="small-icon" disabled={currentPage <= 1} onClick={() => { setState(current => ({ ...current, page: currentPage - 1 })); setSelectedIds([]); }} aria-label="Página anterior">‹</button><span>Página {currentPage} de {pages}</span><button type="button" className="small-icon" disabled={currentPage >= pages} onClick={() => { setState(current => ({ ...current, page: currentPage + 1 })); setSelectedIds([]); }} aria-label="Próxima página">›</button></div></footer>
    </section>
    {createTaskOpen && <CreateTaskDialog key={projectId} token={token} nonce={nonce} projectId={projectId} repositories={repositories ?? []} areas={projectAreas} tasks={tasks} defaultFeatureId={state.featureId} systemAdmin={systemAdmin} close={() => setCreateTaskOpen(false)} onCreated={task => { setCreateTaskOpen(false); setCreatedTaskNotice(`Task “${task.name}” criada.`); }} />}
    {createFeatureOpen && <CreateFeatureDialog key={projectId} token={token} nonce={nonce} projectId={projectId} close={() => setCreateFeatureOpen(false)} onCreated={feature => { setCreateFeatureOpen(false); setCreatedFeatureNotice(`Feature “${feature.name}” criada.`); }} />}
  </>;
}
