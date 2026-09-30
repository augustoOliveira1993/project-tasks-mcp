import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../../api';
import { Badge } from '../../components/ui/Badge';
import { MetricCard } from '../../components/ui/MetricCard';
import { errorMessage, formatDate } from '../../lib/format';
import { statusLabels, statusTone } from './status';
import { readTaskQueryState, syncTaskQueryState } from './task-query-params';
import { filterTasks, getTaskFilterOptions, taskFilterOptionLabel, type TaskFilters } from './task-filters';
import { getSelectedVisibleItems, paginateItems } from './task-pagination';

type TaskWorkspaceProps = {
  projectId: string;
  tasks: Task[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  saving: boolean;
  onRefresh: () => void;
  onOpenTask: (task: Task) => void;
  onChangeStatus: (task: Task) => void;
  onToggleChecked: (task: Task) => void;
  canHardDelete: boolean;
  onRequestHardDeleteTask: (task: Task) => void;
  onArchiveTask: (task: Task) => void;
  onApproveSelected: (taskIds: string[], reason: string) => Promise<boolean>;
  onSetTasksChecked: (taskIds: string[], checked: boolean) => Promise<string[]>;
};

export function TaskWorkspace({ projectId, tasks, isPending, isError, error, saving, onRefresh, onOpenTask, onChangeStatus, onToggleChecked, canHardDelete, onRequestHardDeleteTask, onArchiveTask, onApproveSelected, onSetTasksChecked }: TaskWorkspaceProps) {
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

  const filtered = useMemo(() => filterTasks(tasks, filters)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))), [tasks, search, statusFilter, areaFilter, typeFilter, priorityFilter, responsibleFilter, featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore]);
  const filterOptions = useMemo(() => getTaskFilterOptions(tasks, filters), [tasks, search, statusFilter, areaFilter, typeFilter, priorityFilter, responsibleFilter, featureFilter, createdAfter, createdBefore, updatedAfter, updatedBefore]);
  const pagination = paginateItems(filtered, page, pageSize);
  const { page: currentPage, pageCount: pages, items: visibleTasks } = pagination;
  const countStatus = (status: string) => tasks.filter(task => task.status === status).length;
  const selectionAllowed = (task: Task) => task.status === 'em_revisao' || task.status === 'concluida';
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

    <section className="panel-card task-panel">
      <div className="task-panel-heading"><div><h2>Fila de trabalho</h2><p className="muted-text">{filtered.length} tarefa(s) encontradas</p></div><button className="text-button" onClick={onRefresh}>↻ Atualizar lista</button></div>
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
        <tbody>{visibleTasks.map(task => <tr key={task._id}>
          <td><input type="checkbox" aria-label={'Selecionar ' + task.name} disabled={!selectionAllowed(task) || saving} checked={selectedIds.includes(task._id)} onChange={event => toggleSelected(task._id, event.target.checked)} /></td>
          <td><button className="task-name" onClick={() => onOpenTask(task)}>{task.name}</button><span className="task-id">{task._id.slice(0, 8)} · P{task.priority ?? '—'}</span>{task.checked && <small className="checked-label">✓ Conferida por {task.checkedBy || 'membro'}</small>}</td>
          <td><Badge tone={statusTone[task.status]}>{statusLabels[task.status] ?? task.status}</Badge></td>
          <td><span className="area-label">{task.area ?? '—'}</span></td>
          <td>{task.responsible || <span className="muted-text">Não atribuído</span>}</td>
          <td>{formatDate(task.updatedAt)}</td>
          <td><div className="row-actions"><button className="small-icon" title="Ver detalhes" aria-label={'Ver detalhes de ' + task.name} onClick={() => onOpenTask(task)}>↗</button><button className="small-icon" title="Alterar status" aria-label={'Alterar status de ' + task.name} onClick={() => onChangeStatus(task)}>⋯</button>{task.status === 'concluida' && <button className={task.checked ? 'small-icon checked-action' : 'small-icon'} title={task.checked ? 'Remover conferência' : 'Conferir tarefa'} aria-label={task.checked ? 'Remover conferência de ' + task.name : 'Conferir tarefa ' + task.name} disabled={saving} onClick={() => onToggleChecked(task)}>{task.checked ? '✓' : '○'}</button>}{['concluida', 'cancelada'].includes(task.status) && <button type="button" className="row-label-action archive-row-action" disabled={saving} onClick={() => onArchiveTask(task)}>Arquivar</button>}{canHardDelete && <button type="button" className="row-label-action delete-row-action" disabled={saving} onClick={() => onRequestHardDeleteTask(task)} aria-label={'Excluir definitivamente a tarefa ' + task.name}>Excluir</button>}</div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state compact"><h3>Nenhuma tarefa encontrada</h3><p>Altere os filtros ou selecione outro projeto.</p></div>}

      <footer className="table-footer"><span>Mostrando {pagination.firstItem}–{pagination.lastItem} de {filtered.length}</span><div className="pagination"><label>Por página <select value={pageSize} onChange={event => updatePageSize(Number(event.target.value))}><option>10</option><option>25</option><option>50</option><option>100</option></select></label><button className="small-icon" disabled={currentPage <= 1} onClick={() => updatePage(currentPage - 1)} aria-label="Página anterior">‹</button><span>Página {currentPage} de {pages}</span><button className="small-icon" disabled={currentPage >= pages} onClick={() => updatePage(currentPage + 1)} aria-label="Próxima página">›</button></div></footer>
    </section>
  </>;
}
