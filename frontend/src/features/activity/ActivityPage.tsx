import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../../api';
import { Avatar } from '../../components/ui/Person';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { IconChevron, IconRefresh } from '../../components/ui/icons';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { Skeleton } from '../../components/ui/Skeleton';
import { eventKindLabel, eventSummary, isTechnicalEvent, originLabel, toolLabel } from '../../lib/activity';
import { personName, plural } from '../../lib/labels';
import { ConversationLink, TaskLink } from '../../components/ui/Links';

export type ActivityEvent = {
  _id?: string;
  sequence?: number;
  projectId?: string | null;
  projectName?: string;
  taskId?: string | null;
  taskName?: string | null;
  channel?: string;
  toolName?: string | null;
  detail?: string | null;
  conversationId?: string | null;
  kind?: string;
  summary?: string;
  author?: string;
  origin?: string;
  at?: string;
};

type ActivityFilters = {
  search: string;
  kind: string;
  author: string;
  origin: string;
  taskId: string;
  projectId: string;
  from: string;
  to: string;
};

type ActivityPageProps = {
  events: ActivityEvent[];
  tasks: Task[];
  projects: Array<{ _id: string; name: string }>;
  isGlobal?: boolean;
  canViewGlobal?: boolean;
  onScopeChange?: (isGlobal: boolean) => void;
  taskSearch: string;
  onTaskSearchChange: (value: string) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onRefresh: () => void;
  onLoadMore?: () => void;
};

const emptyFilters: ActivityFilters = { search: '', kind: '', author: '', origin: '', taskId: '', projectId: '', from: '', to: '' };

function timeOnly(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(date);
}

function dayKey(value?: string) {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.valueOf()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : 'sem-data';
}

function dayLabel(key: string, now = new Date()) {
  if (key === 'sem-data') return 'Data não informada';
  const date = new Date(`${key}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.valueOf() - date.valueOf()) / 86_400_000);
  const formatted = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return diff === 0 ? `Hoje · ${formatted}` : diff === 1 ? `Ontem · ${formatted}` : formatted[0].toLocaleUpperCase('pt-BR') + formatted.slice(1);
}

function isWithinDateRange(value: string | undefined, from: string, to: string) {
  if (!from && !to) return true;
  if (!value) return false;
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) return false;
  if (from && timestamp < new Date(`${from}T00:00:00`).valueOf()) return false;
  if (to) {
    const until = new Date(`${to}T00:00:00`);
    until.setDate(until.getDate() + 1);
    if (timestamp >= until.valueOf()) return false;
  }
  return true;
}

export function ActivityPage({ events, tasks, projects, isGlobal = false, canViewGlobal = false, onScopeChange, taskSearch, onTaskSearchChange, isPending, isError, error, hasMore = false, isLoadingMore = false, onRefresh, onLoadMore }: ActivityPageProps) {
  const [filters, setFilters] = useState<ActivityFilters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [taskSearchInput, setTaskSearchInput] = useState(taskSearch);
  useEffect(() => { setTaskSearchInput(taskSearch); }, [taskSearch]);
  useEffect(() => {
    const timeout = window.setTimeout(() => onTaskSearchChange(taskSearchInput.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [onTaskSearchChange, taskSearchInput]);
  const tasksById = useMemo(() => new Map(tasks.map(task => [task._id, task])), [tasks]);
  const taskNamesById = useMemo(() => new Map(events.filter(event => event.taskId && event.taskName).map(event => [event.taskId!, event.taskName!])), [events]);
  const visibleSource = useMemo(() => showTechnical ? events : events.filter(event => !isTechnicalEvent(event)), [events, showTechnical]);
  const technicalCount = events.length - events.filter(event => !isTechnicalEvent(event)).length;
  const kindOptions = useMemo(() => [...new Set(visibleSource.map(event => event.kind).filter((kind): kind is string => Boolean(kind)))].sort((a, b) => eventKindLabel(a).localeCompare(eventKindLabel(b), 'pt-BR')), [visibleSource]);
  const authorOptions = useMemo(() => [...new Set(visibleSource.map(event => event.author?.trim() || '__unknown__'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [visibleSource]);
  const originOptions = useMemo(() => [...new Set(visibleSource.map(event => event.origin?.trim() || '__unknown__'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [visibleSource]);
  const projectOptions = useMemo(() => {
    const names = new Map(projects.map(project => [project._id, project.name]));
    for (const event of events) if (event.projectId && event.projectName) names.set(event.projectId, event.projectName);
    if (events.some(event => !event.projectId)) names.set('__system__', 'Administração do sistema');
    return [...names].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [events, projects]);
  const taskOptions = useMemo(() => [...new Set(visibleSource.map(event => event.taskId).filter((taskId): taskId is string => Boolean(taskId)))].sort((a, b) => (taskNamesById.get(a) ?? tasksById.get(a)?.name ?? a).localeCompare(taskNamesById.get(b) ?? tasksById.get(b)?.name ?? b, 'pt-BR')), [visibleSource, taskNamesById, tasksById]);
  const sortedEvents = useMemo(() => [...visibleSource].sort((a, b) => new Date(b.at ?? '').valueOf() - new Date(a.at ?? '').valueOf()), [visibleSource]);
  const filteredEvents = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('pt-BR');
    return sortedEvents.filter(event => {
      const author = event.author?.trim() || '__unknown__';
      const origin = event.origin?.trim() || '__unknown__';
      const kind = event.kind || '';
      const task = event.taskId ? tasksById.get(event.taskId) : undefined;
      const taskLabel = event.taskName ?? task?.name ?? event.taskId ?? '';
      const searchable = [event.summary, eventSummary(event), event.detail, event.toolName, toolLabel(event.toolName), kind, eventKindLabel(kind), event.author, event.origin, event.projectName, taskLabel, event.taskId].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      const taskNeedle = taskSearchInput.trim().toLocaleLowerCase('pt-BR');
      const searchableTask = [event.taskName, task?.name, event.taskId].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return (!filters.kind || kind === filters.kind)
        && (!filters.author || author === filters.author)
        && (!filters.origin || origin === filters.origin)
        && (!filters.taskId || event.taskId === filters.taskId)
        && (!filters.projectId || (filters.projectId === '__system__' ? !event.projectId : event.projectId === filters.projectId))
        && (!isGlobal || !taskNeedle || searchableTask.includes(taskNeedle))
        && (!needle || searchable.includes(needle))
        && isWithinDateRange(event.at, filters.from, filters.to);
    });
  }, [filters, isGlobal, sortedEvents, taskSearchInput, tasksById]);
  const groups = useMemo(() => {
    const byDay = new Map<string, ActivityEvent[]>();
    for (const event of filteredEvents) {
      const key = dayKey(event.at);
      byDay.set(key, [...(byDay.get(key) ?? []), event]);
    }
    return [...byDay];
  }, [filteredEvents]);
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (taskSearchInput.trim() ? 1 : 0);
  const hasFilters = activeFilterCount > 0;
  const updateFilter = (field: keyof ActivityFilters, value: string) => setFilters(current => ({ ...current, [field]: value }));
  const clearFilters = () => { setFilters(emptyFilters); setTaskSearchInput(''); onTaskSearchChange(''); };

  return <section className="panel-card activity-panel">
    <div className="section-heading activity-heading">
      <div><h2>{isGlobal ? 'Atividade recente em todos os projetos' : 'Histórico de atividades do projeto'}</h2><p className="muted-text">{isGlobal ? 'Visão administrativa das atividades do workspace' : 'Mudanças de status, progresso, revisões e colaboração neste projeto'}</p></div>
      <button type="button" className="button secondary" onClick={onRefresh} disabled={isPending}><IconRefresh size={13} /> Atualizar</button>
    </div>
    <div className="activity-toolbar">
      {canViewGlobal && onScopeChange && <label className="activity-scope">Escopo<select aria-label="Escopo da atividade" value={isGlobal ? 'global' : 'project'} onChange={event => onScopeChange(event.target.value === 'global')}><option value="project">Projeto atual</option><option value="global">Todos os projetos</option></select></label>}
      <label className="search-field activity-search"><input type="search" value={filters.search} onChange={event => updateFilter('search', event.target.value)} placeholder="Buscar no histórico (resumo, autor, tarefa)" aria-label="Buscar no histórico" /></label>
      <button type="button" className={'button secondary small-button' + (filtersOpen ? ' pressed' : '')} aria-expanded={filtersOpen} aria-controls="activity-filters" onClick={() => setFiltersOpen(open => !open)}>Filtros{activeFilterCount > 0 && <span className="tab-count">{activeFilterCount}</span>}<IconChevron size={12} className={filtersOpen ? 'flip' : undefined} /></button>
      <label className="toggle-line"><input type="checkbox" checked={showTechnical} onChange={event => setShowTechnical(event.target.checked)} /> Mostrar chamadas MCP e heartbeats{technicalCount > 0 && <span className="muted-text">({technicalCount})</span>}</label>
    </div>
    {filtersOpen && <div className="activity-filter-panel" id="activity-filters">
      <div className="activity-filter-heading"><div><strong>Filtros</strong><span>{filteredEvents.length} de {events.length} eventos carregados</span></div><button type="button" className="text-button" onClick={clearFilters} disabled={!hasFilters}>Limpar filtros</button></div>
      <div className="activity-filter-grid">
        <label>Tarefa (nome ou ID)<input type="search" value={taskSearchInput} onChange={event => setTaskSearchInput(event.target.value)} placeholder="Digite o nome ou ID da tarefa" aria-label="Buscar atividade pelo nome ou ID da tarefa" /></label>
        <label>Tipo de evento<select value={filters.kind} onChange={event => updateFilter('kind', event.target.value)}><option value="">Todos os tipos</option>{kindOptions.map(kind => <option key={kind} value={kind}>{eventKindLabel(kind)}</option>)}</select></label>
        <label>Autor<select value={filters.author} onChange={event => updateFilter('author', event.target.value)}><option value="">Todos os autores</option>{authorOptions.map(author => <option key={author} value={author}>{author === '__unknown__' ? 'Autor não identificado' : author}</option>)}</select></label>
        <label>Origem<select value={filters.origin} onChange={event => updateFilter('origin', event.target.value)}><option value="">Todas as origens</option>{originOptions.map(origin => <option key={origin} value={origin}>{origin === '__unknown__' ? 'Origem não identificada' : originLabel(origin)}</option>)}</select></label>
        {isGlobal && <label>Projeto<select value={filters.projectId} onChange={event => updateFilter('projectId', event.target.value)}><option value="">Todos os projetos</option>{projectOptions.map(([projectId, name]) => <option key={projectId} value={projectId}>{name}</option>)}</select></label>}
        <label>Tarefa do histórico<select value={filters.taskId} onChange={event => updateFilter('taskId', event.target.value)}><option value="">Todas as tarefas</option>{taskOptions.map(taskId => <option key={taskId} value={taskId}>{taskNamesById.get(taskId) ?? tasksById.get(taskId)?.name ?? `Tarefa ${taskId.slice(0, 8)}`}</option>)}</select></label>
        <label>De<input type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} /></label>
        <label>Até<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => updateFilter('to', event.target.value)} /></label>
      </div>
    </div>}
    {hasFilters && !filtersOpen && <div className="activity-active-filters"><span>{plural(activeFilterCount, 'filtro ativo', 'filtros ativos')} · {filteredEvents.length} de {events.length} eventos</span><button type="button" className="text-button" onClick={clearFilters}>Limpar filtros</button></div>}
    {isPending ? <Skeleton rows={6} label="Carregando eventos…" />
      : isError ? <div className="activity-feedback"><ErrorNotice error={error} onRetry={onRefresh} title="Não foi possível carregar a atividade" /></div>
        : events.length === 0 ? <div className="empty-state compact"><h3>{taskSearchInput.trim() ? 'Nenhuma atividade encontrada para essa tarefa' : 'Sem atividades neste histórico'}</h3><p>{taskSearchInput.trim() ? 'Confira o nome ou ID digitado.' : 'Progresso, revisões e colaboração aparecerão aqui.'}</p></div>
        : filteredEvents.length === 0 ? <div className="empty-state compact"><h3>{isGlobal && hasMore && taskSearchInput.trim() ? 'Nenhuma atividade correspondente nas páginas carregadas' : 'Nenhum evento encontrado'}</h3><p>{isGlobal && hasMore && taskSearchInput.trim() ? 'Carregue mais páginas para continuar procurando no histórico global.' : !showTechnical && technicalCount > 0 && !hasFilters ? `Só há chamadas técnicas (${technicalCount}) neste trecho. Marque “Mostrar chamadas MCP e heartbeats” para vê-las.` : 'Ajuste os filtros ou limpe a busca para ver outras atividades.'}</p>{hasFilters && <button type="button" className="button secondary" onClick={clearFilters}>Limpar filtros</button>}</div>
          : <div className="activity-events" aria-live="polite">{groups.map(([key, dayEvents]) => <section className="activity-day" key={key} aria-label={dayLabel(key)}>
            <h3 className="activity-day-heading">{dayLabel(key)}<span>{plural(dayEvents.length, 'evento', 'eventos')}</span></h3>
            {dayEvents.map((event, index) => {
              const author = event.author?.trim() || 'Autor não identificado';
              const known = author !== 'Autor não identificado';
              const task = event.taskId ? tasksById.get(event.taskId) : undefined;
              const taskName = event.taskName ?? task?.name;
              const technical = isTechnicalEvent(event);
              return <article className={'activity-event' + (technical ? ' technical' : '')} key={event.sequence ?? event._id ?? `${event.at}-${event.kind}-${index}`}>
                <Avatar identity={known ? author : '?'} size={34} />
                <div className="activity-event-content">
                  <div className="activity-event-heading"><strong className="activity-event-author" title={author}>{known ? personName(author) : 'Autor não identificado'}</strong><span className="activity-kind-badge">{eventKindLabel(event.kind)}</span>{event.toolName && <span className="activity-tool-badge" title={`Ferramenta MCP: ${event.toolName}`}>{event.toolName}</span>}<span className="activity-origin-badge" title="Origem do evento">{originLabel(event.origin)}</span>{isGlobal && <span className="activity-project-badge">{event.projectName || 'Projeto indisponível'}</span>}{event.taskId && <TaskLink taskId={event.taskId} projectId={event.projectId} className="activity-task-badge activity-task-link" title={`Abrir tarefa: ${taskName ?? event.taskId}`}>{taskName ?? `Tarefa ${event.taskId.slice(0, 8)}`}<span aria-hidden="true"> ↗</span></TaskLink>}{event.conversationId && <ConversationLink conversationId={event.conversationId} projectId={event.projectId} className="activity-task-badge activity-task-link" title="Abrir a conversa deste evento">Conversa <span aria-hidden="true">↗</span></ConversationLink>}</div>
                  {eventSummary(event) !== eventKindLabel(event.kind) && <p className="activity-event-summary">{eventSummary(event)}</p>}
                  {event.detail && <div className="activity-event-detail"><MarkdownView content={event.detail} /></div>}
                </div>
                <time className="activity-event-date" dateTime={event.at} title={event.at ? new Date(event.at).toLocaleString('pt-BR') : undefined}>{timeOnly(event.at)}</time>
              </article>;
            })}
          </section>)}</div>}
    {hasMore && <div className="activity-load-more"><button type="button" className="button secondary" onClick={onLoadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Carregando…' : 'Carregar mais atividades'}</button></div>}
  </section>;
}
