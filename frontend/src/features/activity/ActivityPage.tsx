import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../../api';
import { Avatar } from '../../components/ui/Person';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { IconChevron, IconRefresh } from '../../components/ui/icons';
import { AgentClientIcon, isKnownAgentClient } from '../../components/ui/AgentClientIcon';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { Skeleton } from '../../components/ui/Skeleton';
import { eventKindLabel, eventSummary, isTechnicalEvent, originLabel, toolLabel } from '../../lib/activity';
import { personName, plural } from '../../lib/labels';
import { ConversationLink, TaskLink } from '../../components/ui/Links';
import { buttonBase, buttonSecondary, textButton } from '../../components/ui/classes';

const badge = 'inline-flex max-w-full rounded-[4px] px-[7px] py-[3px] text-[10.5px] leading-[1.3] [overflow-wrap:anywhere]';
const taskBadge = 'inline-flex max-w-[280px] cursor-pointer overflow-hidden rounded-[4px] border border-line-strong bg-white px-[7px] py-[3px] text-[10.5px] leading-[1.3] text-ellipsis whitespace-nowrap text-ink-2 no-underline [overflow-wrap:anywhere] hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue';
const eventBox = 'grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 border-b border-b-[#edf0f5] px-5 py-[14px] last:border-b-0 max-[560px]:gap-[10px]';
const filterLabel = 'grid min-w-0 gap-[5px] text-ui-xs font-semibold text-[#596576]';
const filterControl = 'h-9 w-full min-w-0 rounded-[7px] border border-[#e0e5ee] bg-white px-[10px] text-ui-xs text-[#394558]';
const emptyBox = 'grid justify-items-center gap-2 px-[14px] py-[30px] text-center';
const emptyTitle = 'font-display text-[13px] leading-[normal] font-bold text-[#394558]';
const emptyText = 'mb-2 text-[11px] text-[#8993a3]';

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

const zone = 'America/Sao_Paulo';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone });

function timeOnly(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: zone }).format(date);
}

function dayKey(value?: string) {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.valueOf()) ? dayFormat.format(date) : 'sem-data';
}

function dayLabel(key: string, now = new Date()) {
  if (key === 'sem-data') return 'Data não informada';
  const date = new Date(`${key}T00:00:00Z`);
  const today = new Date(`${dayFormat.format(now)}T00:00:00Z`);
  const diff = Math.round((today.valueOf() - date.valueOf()) / 86_400_000);
  const formatted = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date);
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

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="mb-[11px] flex items-center justify-between gap-[14px] px-5 py-[18px] max-[560px]:items-start">
      <div><h2 className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]">{isGlobal ? 'Atividade recente em todos os projetos' : 'Histórico de atividades do projeto'}</h2><p className="text-[10px] text-muted-strong">{isGlobal ? 'Visão administrativa das atividades do workspace' : 'Mudanças de status, progresso, revisões e colaboração neste projeto'}</p></div>
      <button type="button" className={buttonSecondary} onClick={onRefresh} disabled={isPending}><IconRefresh size={13} /> Atualizar</button>
    </div>
    <div className="flex flex-wrap items-center gap-3 px-5 pb-3 max-[560px]:px-3">
      {canViewGlobal && onScopeChange && <label className="inline-flex items-center gap-1.5 text-ui-xs font-bold text-muted-strong">Escopo<select className="min-h-[34px] rounded-ui-sm border border-line-strong px-2 text-ui-xs" aria-label="Escopo da atividade" value={isGlobal ? 'global' : 'project'} onChange={event => onScopeChange(event.target.value === 'global')}><option value="project">Projeto atual</option><option value="global">Todos os projetos</option></select></label>}
      <label className="flex h-[34px] min-w-[200px] flex-[1_1_260px] items-center gap-2 rounded-[7px] border border-[#e3e7ef] px-[10px] text-[#9ba5b4] focus-within:border-[#929ef2] focus-within:shadow-[0_0_0_3px_#596ce31a]"><input className="w-full min-w-0 border-0 text-ui-sm text-[#394558]" type="search" value={filters.search} onChange={event => updateFilter('search', event.target.value)} placeholder="Buscar no histórico (resumo, autor, tarefa)" aria-label="Buscar no histórico" /></label>
      <button type="button" className={filtersOpen ? `${buttonBase} min-h-[29px] px-2.5 border-focus bg-tone-blue-bg text-tone-blue` : `${buttonBase} min-h-[29px] px-2.5 border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`} aria-expanded={filtersOpen} aria-controls="activity-filters" onClick={() => setFiltersOpen(open => !open)}>Filtros{activeFilterCount > 0 && <span className="min-w-[18px] rounded-[9px] bg-tone-slate-bg px-[5px] text-center text-[10px] leading-[18px] font-bold text-tone-slate">{activeFilterCount}</span>}<IconChevron size={12} className={filtersOpen ? 'rotate-180' : undefined} /></button>
      <label className="inline-flex items-center gap-1.5 text-ui-xs text-muted-strong"><input type="checkbox" checked={showTechnical} onChange={event => setShowTechnical(event.target.checked)} /> Mostrar chamadas MCP e heartbeats{technicalCount > 0 && <span className="text-muted-strong">({technicalCount})</span>}</label>
    </div>
    {filtersOpen && <div className="border-t border-t-line border-b border-b-[#edf0f5] bg-[#fafbfe] px-5 pt-4 pb-[18px]" id="activity-filters">
      <div className="mb-[13px] flex items-center justify-between gap-3 max-[560px]:flex-wrap max-[560px]:items-start"><div className="flex flex-wrap items-baseline gap-[10px]"><strong className="text-[12px] text-[#394558]">Filtros</strong><span className="text-ui-xs text-[#8792a3]">{filteredEvents.length} de {events.length} eventos carregados</span></div><button type="button" className={textButton} onClick={clearFilters} disabled={!hasFilters}>Limpar filtros</button></div>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3 max-[800px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[560px]:grid-cols-[minmax(0,1fr)]">
        <label className={filterLabel}>Tarefa (nome ou ID)<input className={filterControl} type="search" value={taskSearchInput} onChange={event => setTaskSearchInput(event.target.value)} placeholder="Digite o nome ou ID da tarefa" aria-label="Buscar atividade pelo nome ou ID da tarefa" /></label>
        <label className={filterLabel}>Tipo de evento<select className={filterControl} value={filters.kind} onChange={event => updateFilter('kind', event.target.value)}><option value="">Todos os tipos</option>{kindOptions.map(kind => <option key={kind} value={kind}>{eventKindLabel(kind)}</option>)}</select></label>
        <label className={filterLabel}>Autor<select className={filterControl} value={filters.author} onChange={event => updateFilter('author', event.target.value)}><option value="">Todos os autores</option>{authorOptions.map(author => <option key={author} value={author}>{author === '__unknown__' ? 'Autor não identificado' : author}</option>)}</select></label>
        <label className={filterLabel}>Origem<select className={filterControl} value={filters.origin} onChange={event => updateFilter('origin', event.target.value)}><option value="">Todas as origens</option>{originOptions.map(origin => <option key={origin} value={origin}>{origin === '__unknown__' ? 'Origem não identificada' : originLabel(origin)}</option>)}</select></label>
        {isGlobal && <label className={filterLabel}>Projeto<select className={filterControl} value={filters.projectId} onChange={event => updateFilter('projectId', event.target.value)}><option value="">Todos os projetos</option>{projectOptions.map(([projectId, name]) => <option key={projectId} value={projectId}>{name}</option>)}</select></label>}
        <label className={filterLabel}>Tarefa do histórico<select className={filterControl} value={filters.taskId} onChange={event => updateFilter('taskId', event.target.value)}><option value="">Todas as tarefas</option>{taskOptions.map(taskId => <option key={taskId} value={taskId}>{taskNamesById.get(taskId) ?? tasksById.get(taskId)?.name ?? `Tarefa ${taskId.slice(0, 8)}`}</option>)}</select></label>
        <label className={filterLabel}>De<input className={filterControl} type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} /></label>
        <label className={filterLabel}>Até<input className={filterControl} type="date" value={filters.to} min={filters.from || undefined} onChange={event => updateFilter('to', event.target.value)} /></label>
      </div>
    </div>}
    {hasFilters && !filtersOpen && <div className="flex items-center justify-between gap-3 border-y border-y-line bg-[#f7f8ff] px-5 py-2 text-ui-xs font-semibold text-tone-blue max-[560px]:px-3"><span>{plural(activeFilterCount, 'filtro ativo', 'filtros ativos')} · {filteredEvents.length} de {events.length} eventos</span><button type="button" className={textButton} onClick={clearFilters}>Limpar filtros</button></div>}
    {isPending ? <Skeleton rows={6} label="Carregando eventos…" />
      : isError ? <div className="grid justify-items-start gap-3 px-5 py-[18px]"><ErrorNotice error={error} onRetry={onRefresh} title="Não foi possível carregar a atividade" /></div>
        : events.length === 0 ? <div className={emptyBox}><h3 className={emptyTitle}>{taskSearchInput.trim() ? 'Nenhuma atividade encontrada para essa tarefa' : 'Sem atividades neste histórico'}</h3><p className={emptyText}>{taskSearchInput.trim() ? 'Confira o nome ou ID digitado.' : 'Progresso, revisões e colaboração aparecerão aqui.'}</p></div>
        : filteredEvents.length === 0 ? <div className={emptyBox}><h3 className={emptyTitle}>{isGlobal && hasMore && taskSearchInput.trim() ? 'Nenhuma atividade correspondente nas páginas carregadas' : 'Nenhum evento encontrado'}</h3><p className={emptyText}>{isGlobal && hasMore && taskSearchInput.trim() ? 'Carregue mais páginas para continuar procurando no histórico global.' : !showTechnical && technicalCount > 0 && !hasFilters ? `Só há chamadas técnicas (${technicalCount}) neste trecho. Marque “Mostrar chamadas MCP e heartbeats” para vê-las.` : 'Ajuste os filtros ou limpe a busca para ver outras atividades.'}</p>{hasFilters && <button type="button" className={buttonSecondary} onClick={clearFilters}>Limpar filtros</button>}</div>
          : <div className="grid" aria-live="polite">{groups.map(([key, dayEvents]) => <section className="grid" key={key} aria-label={dayLabel(key)}>
            <h3 className="sticky top-[56px] z-[5] flex items-baseline justify-between gap-2 border-y border-y-line bg-[#f5f6fb] px-5 py-2 font-display text-ui-xs leading-[normal] font-bold text-ink-2 max-[560px]:px-3">{dayLabel(key)}<span className="font-semibold text-muted-strong">{plural(dayEvents.length, 'evento', 'eventos')}</span></h3>
            {dayEvents.map((event, index) => {
              const author = event.author?.trim() || 'Autor não identificado';
              const known = author !== 'Autor não identificado';
              const task = event.taskId ? tasksById.get(event.taskId) : undefined;
              const taskName = event.taskName ?? task?.name;
              const technical = isTechnicalEvent(event);
              return <article className={technical ? `${eventBox} bg-[#fcfcfd] opacity-[.78]` : eventBox} key={event.sequence ?? event._id ?? `${event.at}-${event.kind}-${index}`}>
                <Avatar identity={known ? author : '?'} size={34} />
                <div className="grid min-w-0 gap-1.5 max-[560px]:col-start-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-[7px]"><strong className="max-w-full text-ui-sm text-[#273245] [overflow-wrap:anywhere]" title={author}>{known ? personName(author) : 'Autor não identificado'}</strong><span className={`${badge} bg-[#e8efff] text-[#2c4ea8]`}>{eventKindLabel(event.kind)}</span>{event.toolName && <span className={`${badge} bg-[#f0eaff] font-code text-[#6944a2]`} title={`Ferramenta MCP: ${event.toolName}`}>{event.toolName}</span>}<span className={`${badge} items-center gap-1 bg-[#f1f3f7] text-ink-2`} title="Origem do evento">{isKnownAgentClient(event.origin) && <AgentClientIcon clientName={event.origin} />}<span>{originLabel(event.origin)}</span></span>{isGlobal && <span className={`${badge} bg-[#e8f5ee] text-[#286344]`}>{event.projectName || 'Projeto indisponível'}</span>}{event.taskId && <TaskLink taskId={event.taskId} name={taskName ?? `Tarefa ${event.taskId.slice(0, 8)}`} projectId={event.projectId} className={taskBadge} title={`Abrir tarefa: ${taskName ?? event.taskId}`}>{taskName ?? `Tarefa ${event.taskId.slice(0, 8)}`}<span aria-hidden="true"> ↗</span></TaskLink>}{event.conversationId && <ConversationLink conversationId={event.conversationId} projectId={event.projectId} className={taskBadge} title="Abrir a conversa deste evento">Conversa <span aria-hidden="true">↗</span></ConversationLink>}</div>
                  {eventSummary(event) !== eventKindLabel(event.kind) && <p className="text-ui-sm leading-[1.55] text-ink-2 [overflow-wrap:anywhere]">{eventSummary(event)}</p>}
                  {event.detail && <div className="max-h-[240px] overflow-auto border-l-2 border-l-[#d9e0ed] pl-[9px] text-[#697587]"><MarkdownView content={event.detail} variant="event" /></div>}
                </div>
                <time className="pt-[3px] text-ui-xs whitespace-nowrap text-muted-strong tabular-nums max-[560px]:col-start-2 max-[560px]:row-start-2 max-[560px]:pt-0" dateTime={event.at} title={event.at ? new Date(event.at).toLocaleString('pt-BR') : undefined}>{timeOnly(event.at)}</time>
              </article>;
            })}
          </section>)}</div>}
    {hasMore && <div className="flex justify-center border-t border-t-[#edf0f5] px-5 py-[14px]"><button type="button" className={buttonSecondary} onClick={onLoadMore} disabled={isLoadingMore}>{isLoadingMore ? 'Carregando…' : 'Carregar mais atividades'}</button></div>}
  </section>;
}
