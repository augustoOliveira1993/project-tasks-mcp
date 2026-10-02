import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { query } from '../../api';
import type { Project, Task } from '../../api';
import { Badge } from '../../components/ui/Badge';
import { CreateTaskDialog } from './CreateTaskDialog';
import { CreateFeatureDialog } from './CreateFeatureDialog';
import { MetricCard } from '../../components/ui/MetricCard';
import { errorMessage, formatDate } from '../../lib/format';
import { routeUrl } from '../../route-state';
import { statusLabels, statusTone } from './status';
import { readTaskQueryState, syncTaskQueryState } from './task-query-params';
import { filterTasks, getTaskFilterOptions, taskFilterOptionLabel, type TaskFilters } from './task-filters';
import { getSelectedVisibleItems, paginateItems } from './task-pagination';

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
  onRefresh: () => void;
  onOpenTask: (task: Task, action?: 'details' | 'edit' | 'summary' | 'json') => void;
  onOpenTaskConversation: (task: Task) => void;
  onTransferTask: (task: Task) => void;
  onOpenQuestionChat: (conversationId: string | null) => void;
  onChangeStatus: (task: Task) => void;
  onToggleChecked: (task: Task) => void;
  canHardDelete: boolean;
  onRequestHardDeleteTask: (task: Task) => void;
  onArchiveTask: (task: Task) => void;
  onApproveSelected: (taskIds: string[], reason: string) => Promise<boolean>;
  onSetTasksChecked: (taskIds: string[], checked: boolean) => Promise<string[]>;
};

export function TaskWorkspace({ token, nonce, projectId, repositories = [], projectAreas = ['backend', 'frontend', 'outro'], tasks, isPending, isError, error, saving, onRefresh, onOpenTask, onOpenTaskConversation, onTransferTask, onOpenQuestionChat, onChangeStatus, onToggleChecked, canHardDelete, onRequestHardDeleteTask, onArchiveTask, onApproveSelected, onSetTasksChecked }: TaskWorkspaceProps) {
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createFeatureOpen, setCreateFeatureOpen] = useState(false);
  const [createdTaskNotice, setCreatedTaskNotice] = useState('');
  const [createdFeatureNotice, setCreatedFeatureNotice] = useState('');
  const [initialQuery] = useState(readTaskQueryState);
  const [search, setSearch] = useState(initialQuery.search);
  const [statusFilter, setStatusFilter] = useState(initialQuery.status);
  const [areaFilter, setAreaFilter] = useState(initialQuery.area);
  const [typeFilter, setTypeFilter] = useState(initialQuery.type);
  const [priorityFilter, setPriorityFilter] = useState(initialQuery.priority);
  const [responsibleFilter, setResponsibleFilter] = useState(initialQuery.responsible);
  const [featureFilter, setFeatureFilter] = useState(initialQuery.featureId);
  const [createdAfter, setCreatedAfter] = useState(initialQuery.createdAfter);
  const [createdBefore, setCreatedBefore] = useState(initialQuery.createdBefore);
  const [updatedAfter, setUpdatedAfter] = useState(initialQuery.updatedAfter);
  const [updatedBefore, setUpdatedBefore] = useState(initialQuery.updatedBefore);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initialQuery.priority || initialQuery.responsible || initialQuery.featureId || initialQuery.createdAfter || initialQuery.createdBefore || initialQuery.updatedAfter || initialQuery.updatedBefore));
  const [page, setPage] = useState(initialQuery.page);
  const [pageSize, setPageSize] = useState(initialQuery.pageSize);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [approvalReason, setApprovalReason] = useState('');
  const filters: TaskFilters = {
    search, status: statusFilter, area: areaFilter, type: typeFilter, priority: priorityFilter,
    responsible: responsibleFilter, featureId: featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore
  };
  const syncReportQuery = useQuery({
    queryKey: ['project-sync-report', nonce, projectId, featureFilter],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => query<{
      summary: { taskCount: number; unreadTaskCount: number; openQuestionCount: number };
      tasks: Array<{ taskId: string; unread: { count: number }; openQuestions: Array<{ conversationId: string | null; createdAt: string }>; gitDiff: unknown | null }>;
    }>(token, 'get_project_sync_report', { projectId, ...(featureFilter ? { featureId: featureFilter } : {}) })
  });
  const syncTasks = new Map((syncReportQuery.data?.tasks ?? []).map(item => [item.taskId, item]));

  const filtered = useMemo(() => filterTasks(tasks, filters)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))), [tasks, search, statusFilter, areaFilter, typeFilter, priorityFilter, responsibleFilter, featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore]);
  const filterOptions = useMemo(() => getTaskFilterOptions(tasks, filters, projectAreas), [tasks, projectAreas, search, statusFilter, areaFilter, typeFilter, priorityFilter, responsibleFilter, featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore]);
  const pagination = paginateItems(filtered, page, pageSize);
  const { page: currentPage, pageCount: pages, items: visibleTasks } = pagination;
  const countStatus = (status: string) => tasks.filter(task => task.status === status).length;
  const selectionAllowed = (task: Task) => task.status === 'em_revisao' || task.status === 'concluida';
  function runTaskAction(task: Task, action: string) {
    if (action === 'details') onOpenTask(task);
    else if (action === 'edit') onOpenTask(task, 'edit');
    else if (action === 'status') onChangeStatus(task);
    else if (action === 'conversation') onOpenTaskConversation(task);
    else if (action === 'transfer') onTransferTask(task);
    else if (action === 'summary') onOpenTask(task, 'summary');
    else if (action === 'json') onOpenTask(task, 'json');
    else if (action === 'check') onToggleChecked(task);
    else if (action === 'archive') onArchiveTask(task);
    else if (action === 'delete') onRequestHardDeleteTask(task);
  }
  const selectableTasks = visibleTasks.filter(selectionAllowed);
  const selectedTasks = getSelectedVisibleItems(visibleTasks, selectedIds, selectionAllowed);
  const selectedForApproval = selectedTasks.filter(task => task.status === 'em_revisao');
  const selectedForChecking = selectedTasks.filter(task => task.status === 'concluida' && !task.checked);
  const selectedForUnchecking = selectedTasks.filter(task => task.status === 'concluida' && task.checked);

  useEffect(() => {
    syncTaskQueryState({ search, status: statusFilter, area: areaFilter, type: typeFilter, priority: priorityFilter, responsible: responsibleFilter, featureId: featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore, page: currentPage, pageSize });
  }, [search, statusFilter, areaFilter, typeFilter, priorityFilter, responsibleFilter, featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore, currentPage, pageSize]);

  useEffect(() => {
    if (projectId && !isPending && page !== currentPage) {
      setPage(currentPage);
      setSelectedIds([]);
    }
  }, [projectId, isPending, page, currentPage]);

  useEffect(() => {
    setSelectedIds([]);
  }, [projectId]);

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
      const state = readTaskQueryState();
      setSearch(state.search);
      setStatusFilter(state.status);
      setAreaFilter(state.area);
      setTypeFilter(state.type);
      setPriorityFilter(state.priority);
      setResponsibleFilter(state.responsible);
      setFeatureFilter(state.featureId);
      setCreatedAfter(state.createdAfter);
      setCreatedBefore(state.createdBefore);
      setUpdatedAfter(state.updatedAfter);
      setUpdatedBefore(state.updatedBefore);
      setAdvancedOpen(Boolean(state.priority || state.responsible || state.featureId || state.createdAfter || state.createdBefore || state.updatedAfter || state.updatedBefore));
      setPage(state.page);
      setPageSize(state.pageSize);
      setSelectedIds([]);
    };
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
  }, []);

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
    setSelectedIds([]);
  }

  function updatePageSize(value: number) {
    setPageSize(value);
    setPage(1);
    setSelectedIds([]);
  }

  function updatePage(value: number) {
    setPage(paginateItems(filtered, value, pageSize).page);
    setSelectedIds([]);
  }

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
    const selectedTasks = checked ? selectedForChecking : selectedForUnchecking;
    const updatedIds = await onSetTasksChecked(selectedTasks.map(task => task._id), checked);
    if (updatedIds.length) setSelectedIds(current => current.filter(id => !updatedIds.includes(id)));
  }

  const bulkActions = [
    ...(selectedForApproval.length ? [{ key: 'approve', label: `Aprovar (${selectedForApproval.length})`, className: 'button primary small-button', onClick: () => void approveSelected() }] : []),
    ...(selectedForChecking.length ? [{ key: 'check', label: `Conferir (${selectedForChecking.length})`, className: 'button secondary small-button', onClick: () => void updateSelectedChecks(true) }] : []),
    ...(selectedForUnchecking.length ? [{ key: 'uncheck', label: `Desfazer conferência (${selectedForUnchecking.length})`, className: 'button ghost small-button', onClick: () => void updateSelectedChecks(false) }] : [])
  ];

  return <>
    <div className="metrics-grid">
      <MetricCard label="Total de tarefas" value={tasks.length} hint="No projeto ativo" />
      <MetricCard label="Em execução" value={countStatus('em_execucao')} hint="Trabalho ativo" />
      <MetricCard label="Em revisão" value={countStatus('em_revisao')} hint="Aguardando aprovação" />
      <MetricCard label="Concluídas" value={countStatus('concluida')} hint={tasks.filter(task => task.checked).length + ' conferidas'} />
    </div>

    <section className="sync-summary" aria-label="Resumo de sincronização da tarefa">
      {syncReportQuery.isPending ? <div className="loading">Carregando resumo de colaboração…</div> : syncReportQuery.isError ? <div className="notice error">{errorMessage(syncReportQuery.error)}</div> : <>
        <div><span className="sync-summary-value">{syncReportQuery.data?.summary.openQuestionCount ?? 0}</span><span className="sync-summary-label">Perguntas abertas</span></div>
        <div><span className="sync-summary-value">{syncReportQuery.data?.summary.unreadTaskCount ?? 0}</span><span className="sync-summary-label">Tasks não lidas</span></div>
        <div><span className="sync-summary-value">{syncReportQuery.data?.tasks.filter(item => item.gitDiff).length ?? 0}</span><span className="sync-summary-label">Tasks com diff Git</span></div>
        <button type="button" className="text-button" onClick={() => void syncReportQuery.refetch()}>Atualizar sincronização</button>
      </>}
    </section>

    <section className="panel-card task-panel">
      <div className="task-panel-heading"><div><h2>Fila de trabalho</h2><p className="muted-text">{filtered.length} tarefa(s) encontradas</p></div><div className="button-row"><button className="button secondary small-button" onClick={() => { setCreatedFeatureNotice(''); setCreateFeatureOpen(true); }}>+ Nova feature</button><button className="button primary small-button" onClick={() => { setCreatedTaskNotice(''); setCreateTaskOpen(true); }}>+ Nova task</button><button className="text-button" onClick={onRefresh}>↻ Atualizar lista</button></div></div>
      {createdTaskNotice && <div className="notice success" role="status">{createdTaskNotice}</div>}
      {createdFeatureNotice && <div className="notice success" role="status">{createdFeatureNotice}</div>}
      <div className="filters-row">
        <label className="search-field"><span>⌕</span><input value={search} onChange={event => updateFilter(setSearch, event.target.value)} placeholder="Buscar por tarefa, ID ou responsável" aria-label="Buscar tarefas" /></label>
        <select aria-label="Filtrar por status" value={statusFilter} onChange={event => updateFilter(setStatusFilter, event.target.value)}><option value="todos">Todos os status</option>{filterOptions.status.map(({ value, count }) => <option key={value} value={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <select aria-label="Filtrar por área" value={areaFilter} onChange={event => updateFilter(setAreaFilter, event.target.value)}><option value="todos">Todas as áreas</option>{filterOptions.area.map(({ value, count }) => <option key={value} value={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <select aria-label="Filtrar por tipo" value={typeFilter} onChange={event => updateFilter(setTypeFilter, event.target.value)}><option value="todos">Todos os tipos</option>{filterOptions.type.map(({ value, count }) => <option value={value} key={value}>{taskFilterOptionLabel(value, count)}</option>)}</select>
        <button className="button ghost filter-toggle" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>{advancedOpen ? '−' : '+'} Filtros avançados</button>
      </div>
      {advancedOpen && <div className="advanced-filters">
        <label>Prioridade<select aria-label="Filtrar por prioridade" value={priorityFilter} onChange={event => updateFilter(setPriorityFilter, event.target.value)}><option value="">Todas</option>{filterOptions.priority.map(({ value, count }) => <option value={value} key={value}>P{value} ({count})</option>)}</select></label>
        <label>Responsável<input value={responsibleFilter} onChange={event => updateFilter(setResponsibleFilter, event.target.value)} placeholder="E-mail ou nome" /></label>
        <label>Feature ID<input value={featureFilter} onChange={event => updateFilter(setFeatureFilter, event.target.value)} placeholder="UUID da feature" /></label>
        <label>Criada de<input type="date" value={createdAfter} onChange={event => updateFilter(setCreatedAfter, event.target.value)} /></label>
        <label>Criada até<input type="date" value={createdBefore} onChange={event => updateFilter(setCreatedBefore, event.target.value)} /></label>
        <label>Atualizada de<input type="date" value={updatedAfter} onChange={event => updateFilter(setUpdatedAfter, event.target.value)} /></label>
        <label>Atualizada até<input type="date" value={updatedBefore} onChange={event => updateFilter(setUpdatedBefore, event.target.value)} /></label>
        <button className="text-button clear-advanced" onClick={() => { setPriorityFilter(''); setResponsibleFilter(''); setFeatureFilter(''); setCreatedAfter(''); setCreatedBefore(''); setUpdatedAfter(''); setUpdatedBefore(''); setPage(1); setSelectedIds([]); }}>Limpar avançados</button>
      </div>}
      {selectedTasks.length > 0 && <div className="bulk-bar"><span>{selectedTasks.length} tarefa(s) selecionada(s)</span>{selectedForApproval.length > 0 && <input value={approvalReason} onChange={event => setApprovalReason(event.target.value)} placeholder="Motivo da aprovação (opcional)" aria-label="Motivo para aprovar tarefas selecionadas" />}<div className="bulk-actions">{bulkActions.map(action => <button key={action.key} className={action.className} disabled={saving} onClick={action.onClick}>{action.label}</button>)}</div><button className="text-button" disabled={saving} onClick={() => setSelectedIds([])}>Limpar seleção</button></div>}

      {isPending ? <div className="loading">Carregando tarefas…</div> : isError ? <div className="notice error">{errorMessage(error)}</div> : visibleTasks.length ? <div className="table-scroll"><table className="task-table">
        <thead><tr><th><input type="checkbox" aria-label="Selecionar tarefas elegíveis nesta página" disabled={saving || selectableTasks.length === 0} checked={selectableTasks.length > 0 && selectableTasks.every(task => selectedIds.includes(task._id))} onChange={event => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...selectableTasks.map(task => task._id)])) : selectedIds.filter(id => !selectableTasks.some(task => task._id === id)))} /></th><th>Tarefa</th><th>Status</th><th>Área</th><th>Responsável</th><th>Atualizada</th><th>Ações</th></tr></thead>
        <tbody>{visibleTasks.map(task => {
          const taskSync = syncTasks.get(task._id);
          const openQuestions = taskSync?.openQuestions ?? [];
          const latestQuestion = openQuestions.at(-1);
          const conversationParams = new URLSearchParams();
          if (latestQuestion?.conversationId) conversationParams.set('conversationId', latestQuestion.conversationId);
          const conversationHref = routeUrl('conversations', conversationParams.toString(), projectId);
          return <tr key={task._id}>
          <td><input type="checkbox" aria-label={'Selecionar ' + task.name} disabled={!selectionAllowed(task) || saving} checked={selectedIds.includes(task._id)} onChange={event => toggleSelected(task._id, event.target.checked)} /></td>
          <td><button className="task-name" onClick={() => onOpenTask(task)}>{task.name}</button><span className="task-id">{task._id.slice(0, 8)} · P{task.priority ?? '—'}</span><span className="task-sync-flags">{(taskSync?.unread.count ?? 0) > 0 && <Badge tone="amber">{taskSync?.unread.count} não lida(s)</Badge>}{openQuestions.length > 0 && <a className="badge inline-flex items-center rounded-full px-2 py-1 text-[9px] font-semibold bg-indigo-50 text-indigo-700 task-question-link" href={conversationHref} aria-label={`Abrir chat sobre ${openQuestions.length} pergunta(s) aberta(s) de ${task.name}`} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenQuestionChat(latestQuestion?.conversationId ?? null); }}>{openQuestions.length} pergunta(s)</a>}{Boolean(taskSync?.gitDiff) && <Badge tone="green">Diff Git</Badge>}</span>{task.checked && <small className="checked-label">✓ Conferida por {task.checkedBy || 'membro'}</small>}</td>
          <td><Badge tone={statusTone[task.status]}>{statusLabels[task.status] ?? task.status}</Badge></td>
          <td><span className="area-label">{task.area ?? '—'}</span></td>
          <td>{task.responsible || <span className="muted-text">Não atribuído</span>}</td>
          <td>{formatDate(task.updatedAt)}</td>
          <td><div className="row-actions"><button type="button" className="small-icon" title="Visualizar detalhes" aria-label={'Visualizar detalhes de ' + task.name} onClick={() => runTaskAction(task, 'details')}>↗</button><button type="button" className="task-status-direct" title="Alterar status" aria-label={'Alterar status de ' + task.name} onClick={() => runTaskAction(task, 'status')}>Status</button><TaskActionsMenu task={task} canHardDelete={canHardDelete} saving={saving} onAction={action => runTaskAction(task, action)} /></div></td>
        </tr>;
        })}</tbody>
      </table></div> : <div className="empty-state compact"><h3>Nenhuma tarefa encontrada</h3><p>Altere os filtros ou selecione outro projeto.</p></div>}

      <footer className="table-footer"><span>Mostrando {pagination.firstItem}–{pagination.lastItem} de {filtered.length}</span><div className="pagination"><label>Por página <select value={pageSize} onChange={event => updatePageSize(Number(event.target.value))}><option>10</option><option>25</option><option>50</option><option>100</option></select></label><button className="small-icon" disabled={currentPage <= 1} onClick={() => updatePage(currentPage - 1)} aria-label="Página anterior">‹</button><span>Página {currentPage} de {pages}</span><button className="small-icon" disabled={currentPage >= pages} onClick={() => updatePage(currentPage + 1)} aria-label="Próxima página">›</button></div></footer>
    </section>
    {createTaskOpen && <CreateTaskDialog key={projectId} token={token} nonce={nonce} projectId={projectId} repositories={repositories ?? []} areas={projectAreas} tasks={tasks} defaultFeatureId={featureFilter} close={() => setCreateTaskOpen(false)} onCreated={task => { setCreateTaskOpen(false); setCreatedTaskNotice(`Task “${task.name}” criada.`); }} />}
    {createFeatureOpen && <CreateFeatureDialog key={projectId} token={token} nonce={nonce} projectId={projectId} close={() => setCreateFeatureOpen(false)} onCreated={feature => { setCreateFeatureOpen(false); setCreatedFeatureNotice(`Feature “${feature.name}” criada.`); }} />}
  </>;
}

type TaskRowAction = 'edit' | 'conversation' | 'transfer' | 'summary' | 'json' | 'check' | 'archive' | 'delete';

function TaskActionsMenu({ task, canHardDelete, saving, onAction }: { task: Task; canHardDelete: boolean; saving: boolean; onAction: (action: TaskRowAction) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: -1000, left: -1000 });
  const actions: Array<{ id: TaskRowAction; label: string; danger?: boolean; disabled?: boolean; dividerBefore?: boolean }> = [
    { id: 'edit', label: 'Editar tarefa' },
    { id: 'conversation', label: 'Abrir conversa' },
    { id: 'transfer', label: 'Transferir tarefa' },
    { id: 'summary', label: 'Resumo completo', dividerBefore: true },
    { id: 'json', label: 'Ver JSON' },
    ...(task.status === 'concluida' ? [{ id: 'check' as const, label: task.checked ? 'Remover conferência' : 'Conferir tarefa', disabled: saving, dividerBefore: true }] : []),
    ...(['concluida', 'cancelada'].includes(task.status) ? [{ id: 'archive' as const, label: 'Arquivar', disabled: saving, dividerBefore: task.status !== 'concluida' }] : []),
    ...(canHardDelete ? [{ id: 'delete' as const, label: 'Excluir', danger: true, disabled: saving, dividerBefore: true }] : [])
  ];

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const anchor = trigger.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      const margin = 10;
      const gap = 6;
      const below = window.innerHeight - anchor.bottom - margin;
      const above = anchor.top - margin;
      const preferredTop = below >= bounds.height || below >= above
        ? anchor.bottom + gap
        : anchor.top - bounds.height - gap;
      const top = Math.min(Math.max(margin, preferredTop), window.innerHeight - bounds.height - margin);
      const left = Math.max(margin, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - margin));
      setPosition({ top, left });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (!items.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' || (index < 0 && event.key === 'ArrowUp') ? items.length - 1 : index < 0 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className="small-icon task-action-menu-trigger" title="Mais ações" aria-label={'Mais ações para ' + task.name} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>⋯</button>
    {open && createPortal(<div ref={menuRef} className="task-action-menu" role="menu" aria-label={'Mais ações para ' + task.name} style={{ top: position.top, left: position.left }}>
      {actions.map(action => <Fragment key={action.id}>{action.dividerBefore && <div className="task-action-menu-divider" role="separator" />}<button type="button" role="menuitem" className={action.danger ? 'task-action-menu-item danger' : 'task-action-menu-item'} disabled={action.disabled} onClick={() => { setOpen(false); onAction(action.id); }}>{action.label}</button></Fragment>)}
    </div>, document.body)}
  </>;
}
