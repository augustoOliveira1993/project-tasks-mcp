import { useMemo, useState } from 'react';
import type { Task } from '../../api';
import { errorMessage } from '../../lib/format';

export type ActivityEvent = {
  _id?: string;
  sequence?: number;
  projectId?: string | null;
  projectName?: string;
  taskId?: string | null;
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
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onRefresh: () => void;
  onLoadMore?: () => void;
};

const emptyFilters: ActivityFilters = { search: '', kind: '', author: '', origin: '', taskId: '', projectId: '', from: '', to: '' };
const eventKindLabels: Record<string, string> = {
  'project.create_project': 'Criou projeto',
  'project.create_feature': 'Criou funcionalidade',
  'project.claim_task': 'Assumiu tarefa',
  'project.create_task': 'Criou tarefa',
  'project.record_progress': 'Atualizou andamento',
  'project.submit_task': 'Enviou para revisão',
  'project.set_task_status': 'Alterou status',
  'project.record_task_diff': 'Enviou mudança',
  'task.diff.published': 'Enviou mudança',
  'project.send_task_message': 'Enviou mensagem',
  'project.create_conversation': 'Iniciou conversa',
  'project.send_conversation_message': 'Enviou resposta'
};

function kindLabel(kind?: string) {
  if (!kind) return 'Evento do projeto';
  const known = eventKindLabels[kind];
  if (known) return known;
  const readable = kind.replace(/^(project|task)\./, '').replace(/[._-]+/g, ' ').trim();
  return readable ? readable[0].toLocaleUpperCase('pt-BR') + readable.slice(1) : 'Evento do projeto';
}

function initials(value: string) {
  const parts = value.trim().split(/[\s.@_-]+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR') || '?';
}

function avatarTone(value: string) {
  return Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0) % 4;
}

function activityTimestamp(value?: string) {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
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

export function ActivityPage({ events, tasks, projects, isGlobal = false, canViewGlobal = false, onScopeChange, isPending, isError, error, hasMore = false, isLoadingMore = false, onRefresh, onLoadMore }: ActivityPageProps) {
  const [filters, setFilters] = useState<ActivityFilters>(emptyFilters);
  const tasksById = useMemo(() => new Map(tasks.map(task => [task._id, task])), [tasks]);
  const kindOptions = useMemo(() => [...new Set(events.map(event => event.kind).filter((kind): kind is string => Boolean(kind)))].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), 'pt-BR')), [events]);
  const authorOptions = useMemo(() => [...new Set(events.map(event => event.author?.trim() || '__unknown__'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [events]);
  const originOptions = useMemo(() => [...new Set(events.map(event => event.origin?.trim() || '__unknown__'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [events]);
  const projectOptions = useMemo(() => {
    const names = new Map(projects.map(project => [project._id, project.name]));
    for (const event of events) if (event.projectId && event.projectName) names.set(event.projectId, event.projectName);
    if (events.some(event => !event.projectId)) names.set('__system__', 'Administração do sistema');
    return [...names].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [events, projects]);
  const taskOptions = useMemo(() => [...new Set(events.map(event => event.taskId).filter((taskId): taskId is string => Boolean(taskId)))].sort((a, b) => (tasksById.get(a)?.name ?? a).localeCompare(tasksById.get(b)?.name ?? b, 'pt-BR')), [events, tasksById]);
  const sortedEvents = useMemo(() => [...events].sort((a, b) => new Date(b.at ?? '').valueOf() - new Date(a.at ?? '').valueOf()), [events]);
  const filteredEvents = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('pt-BR');
    return sortedEvents.filter(event => {
      const author = event.author?.trim() || '__unknown__';
      const origin = event.origin?.trim() || '__unknown__';
      const kind = event.kind || '';
      const task = event.taskId ? tasksById.get(event.taskId) : undefined;
      const taskLabel = task?.name ?? event.taskId ?? '';
      const searchable = [event.summary, kind, kindLabel(kind), event.author, event.origin, event.projectName, taskLabel, event.taskId].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return (!filters.kind || kind === filters.kind)
        && (!filters.author || author === filters.author)
        && (!filters.origin || origin === filters.origin)
        && (!filters.taskId || event.taskId === filters.taskId)
        && (!filters.projectId || (filters.projectId === '__system__' ? !event.projectId : event.projectId === filters.projectId))
        && (!needle || searchable.includes(needle))
        && isWithinDateRange(event.at, filters.from, filters.to);
    });
  }, [filters, sortedEvents, tasksById]);
  const hasFilters = Object.values(filters).some(Boolean);
  const updateFilter = (field: keyof ActivityFilters, value: string) => setFilters(current => ({ ...current, [field]: value }));

  return <section className="panel-card activity-panel">
    <div className="section-heading activity-heading">
      <div><h2>{isGlobal ? 'Atividade recente em todos os projetos' : 'Atividade recente'}</h2><p className="muted-text">{isGlobal ? 'Visão administrativa das atividades do workspace' : 'Novidades compartilhadas neste projeto'}</p></div>
      <button className="button secondary" onClick={onRefresh} disabled={isPending}>↻ Atualizar</button>
    </div>
    <div className="activity-filter-panel">
      <div className="activity-filter-heading"><div><strong>Filtros avançados</strong><span>{filteredEvents.length} de {events.length} eventos carregados</span></div><button className="text-button" onClick={() => setFilters(emptyFilters)} disabled={!hasFilters}>Limpar filtros</button></div>
      <div className="activity-filter-grid">
        {canViewGlobal && onScopeChange && <label>Escopo da atividade<select aria-label="Escopo da atividade" value={isGlobal ? 'global' : 'project'} onChange={event => onScopeChange(event.target.value === 'global')}><option value="project">Projeto atual</option><option value="global">Todos os projetos</option></select></label>}
        <label>Buscar no evento<input type="search" value={filters.search} onChange={event => updateFilter('search', event.target.value)} placeholder="Resumo, autor ou tarefa" /></label>
        <label>Tipo de evento<select value={filters.kind} onChange={event => updateFilter('kind', event.target.value)}><option value="">Todos os tipos</option>{kindOptions.map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></label>
        <label>Autor<select value={filters.author} onChange={event => updateFilter('author', event.target.value)}><option value="">Todos os autores</option>{authorOptions.map(author => <option key={author} value={author}>{author === '__unknown__' ? 'Autor não identificado' : author}</option>)}</select></label>
        <label>Origem<select value={filters.origin} onChange={event => updateFilter('origin', event.target.value)}><option value="">Todas as origens</option>{originOptions.map(origin => <option key={origin} value={origin}>{origin === '__unknown__' ? 'Origem não identificada' : origin}</option>)}</select></label>
        {isGlobal && <label>Projeto<select value={filters.projectId} onChange={event => updateFilter('projectId', event.target.value)}><option value="">Todos os projetos</option>{projectOptions.map(([projectId, name]) => <option key={projectId} value={projectId}>{name}</option>)}</select></label>}
        <label>Tarefa<select value={filters.taskId} onChange={event => updateFilter('taskId', event.target.value)}><option value="">Todas as tarefas</option>{taskOptions.map(taskId => <option key={taskId} value={taskId}>{tasksById.get(taskId)?.name ?? `Tarefa ${taskId.slice(0, 8)}`}</option>)}</select></label>
        <label>De<input type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} /></label>
        <label>Até<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => updateFilter('to', event.target.value)} /></label>
      </div>
    </div>
    {isPending ? <div className="loading">Carregando eventos…</div>
      : isError ? <div className="activity-feedback"><div className="notice error" role="alert">{errorMessage(error)}</div><button className="button secondary" onClick={onRefresh}>Tentar novamente</button></div>
        : events.length === 0 ? <div className="empty-state compact"><h3>Sem novidades recentes</h3><p>Eventos de colaboração aparecerão aqui.</p></div>
          : filteredEvents.length === 0 ? <div className="empty-state compact"><h3>Nenhum evento encontrado</h3><p>Ajuste os filtros ou limpe a busca para ver outras atividades.</p><button className="button secondary" onClick={() => setFilters(emptyFilters)}>Limpar filtros</button></div>
            : <div className="activity-events" aria-live="polite">{filteredEvents.map((event, index) => {
              const author = event.author?.trim() || 'Autor não identificado';
              const origin = event.origin?.trim() || 'Origem não identificada';
              const task = event.taskId ? tasksById.get(event.taskId) : undefined;
              return <article className="activity-event" key={event.sequence ?? event._id ?? `${event.at}-${event.kind}-${index}`}>
                <span className={`activity-avatar activity-avatar-tone-${avatarTone(author)}`} aria-hidden="true">{initials(author)}</span>
                <div className="activity-event-content">
                  <div className="activity-event-heading"><strong className="activity-event-author">{author}</strong><span className="activity-kind-badge">{kindLabel(event.kind)}</span><span className="activity-origin-badge">{origin}</span>{isGlobal && <span className="activity-project-badge">{event.projectName || 'Projeto indisponível'}</span>}{event.taskId && <span className="activity-task-badge">{task?.name ?? `Tarefa ${event.taskId.slice(0, 8)}`}</span>}</div>
                  <p className="activity-event-summary">{event.summary || 'Atualização do projeto'}</p>
                </div>
                <time className="activity-event-date" dateTime={event.at}>{activityTimestamp(event.at)}</time>
              </article>;
            })}</div>}
    {isGlobal && hasMore && <div className="activity-load-more"><button className="button secondary" onClick={onLoadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Carregando…' : 'Carregar mais atividades'}</button></div>}
  </section>;
}
