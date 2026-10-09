import { createContext, useContext, useState, type MouseEvent, type ReactNode } from 'react';
import { routeUrl } from '../../route-state';
import { copyToClipboard } from '../../lib/clipboard';
import { IconCheck, IconCopy } from './icons';

/** Navegação interna entre entidades (tarefa, conversa, feature). Sem provedor, os links funcionam como âncoras comuns. */
export type EntityNavigation = {
  projectId: string;
  openTask: (taskId: string, projectId?: string | null) => void;
  openConversation: (conversationId: string) => void;
  filterByFeature: (featureId: string) => void;
  /** Aplica um filtro da fila (area, type...) e abre a lista de tarefas. */
  filterBy: (param: string, value: string) => void;
  /** Abre a lista de tarefas já com vários filtros aplicados (começa limpa). */
  openTasks?: (filters: Record<string, string>) => void;
};

export const EntityNavigationContext = createContext<EntityNavigation | null>(null);

export const taskHref = (projectId: string, taskId: string) => routeUrl('tasks', `taskId=${encodeURIComponent(taskId)}`, projectId);
export const conversationHref = (projectId: string, conversationId: string) => routeUrl('conversations', `conversationId=${encodeURIComponent(conversationId)}`, projectId);
export const featureHref = (projectId: string, featureId: string) => routeUrl('tasks', `featureId=${encodeURIComponent(featureId)}`, projectId);

function plainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export const tasksFiltersHref = (projectId: string, filters: Record<string, string>) => routeUrl('tasks', new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString(), projectId);

export const filterHref = (projectId: string, param: string, value: string) => routeUrl('tasks', `${param}=${encodeURIComponent(value)}`, projectId);

type LinkBase = { className?: string; title?: string; children: ReactNode; projectId?: string | null; 'aria-label'?: string };

const entityLink = 'font-semibold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2 wrap-anywhere hover:text-[#2a39ad] hover:decoration-current';
const entityChip = 'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-ui-sm bg-tone-slate-bg px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap text-tone-slate no-underline hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue';
const entityLinkGroup = 'inline-flex min-w-0 max-w-full items-center gap-1 align-middle';

export function EntityIdCopyButton({ id, name, kind }: { id: string; name: string; kind: 'tarefa' | 'feature' }) {
  const [status, setStatus] = useState<'copied' | 'error' | null>(null);
  const accessibleName = `Copiar UUID da ${kind} “${name}”`;
  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setStatus(await copyToClipboard(id) ? 'copied' : 'error');
  }

  return <span className="inline-flex shrink-0 items-center gap-1">
    <button type="button" className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-ui-sm border border-transparent text-muted-strong transition-colors hover:border-line-strong hover:bg-white hover:text-tone-blue focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#4b4fcb]" title={status === 'copied' ? 'UUID copiado' : `Copiar UUID completo: ${id}`} aria-label={accessibleName} onClick={copy}>
      {status === 'copied' ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
    {status && <span role="status" aria-live="polite" className={`text-[10px] leading-none ${status === 'copied' ? 'text-tone-green' : 'text-tone-red'}`}>{status === 'copied' ? 'Copiado' : 'Falha ao copiar'}</span>}
  </span>;
}

export function TaskLink({ taskId, name, projectId, className = entityLink, title, children, onOpen, rowFocus }: LinkBase & { taskId: string; name: string; onOpen?: () => void; rowFocus?: boolean }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <span className={entityLinkGroup}><a className={`${className} min-w-0`} data-row-focus={rowFocus ? '' : undefined} href={taskHref(target, taskId)} title={title ?? 'Abrir tarefa'} onClick={event => { if (!plainClick(event)) return; if (onOpen) { event.preventDefault(); event.stopPropagation(); onOpen(); } else if (navigation) { event.preventDefault(); event.stopPropagation(); navigation.openTask(taskId, target); } }}>{children}</a><EntityIdCopyButton id={taskId} name={name} kind="tarefa" /></span>;
}

export function ConversationLink({ conversationId, projectId, className = entityLink, title, children }: LinkBase & { conversationId: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={conversationHref(target, conversationId)} title={title ?? 'Abrir conversa'} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.openConversation(conversationId); } }}>{children}</a>;
}

export function FeatureLink({ featureId, name, projectId, className = entityLink, title, children }: LinkBase & { featureId: string; name: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <span className={entityLinkGroup}><a className={`${className} min-w-0`} href={featureHref(target, featureId)} title={title ?? 'Ver todas as tarefas desta feature'} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.filterByFeature(featureId); } }}>{children}</a><EntityIdCopyButton id={featureId} name={name} kind="feature" /></span>;
}

/** Chip que filtra a fila de tarefas por um campo (área, tipo...). */
export function FilterLink({ param, value, projectId, className = entityChip, title, children, 'aria-label': ariaLabel }: LinkBase & { param: string; value: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={filterHref(target, param, value)} title={title ?? 'Filtrar tarefas por este valor'} aria-label={ariaLabel} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.filterBy(param, value); } }}>{children}</a>;
}

/** Link para a lista de tarefas com um conjunto de filtros; navega sem recarregar quando há provedor de navegação. */
export function TasksLink({ filters, projectId, className = entityLink, title, children }: LinkBase & { filters: Record<string, string> }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={tasksFiltersHref(target, filters)} title={title ?? 'Ver estas tarefas na lista'} onClick={event => { if (navigation?.openTasks && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.openTasks(filters); } }}>{children}</a>;
}
