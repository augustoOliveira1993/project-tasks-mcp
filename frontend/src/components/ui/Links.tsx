import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { routeUrl } from '../../route-state';

/** Navegação interna entre entidades (tarefa, conversa, feature). Sem provedor, os links funcionam como âncoras comuns. */
export type EntityNavigation = {
  projectId: string;
  openTask: (taskId: string, projectId?: string | null) => void;
  openConversation: (conversationId: string) => void;
  filterByFeature: (featureId: string) => void;
  /** Aplica um filtro da fila (area, type...) e abre a lista de tarefas. */
  filterBy: (param: string, value: string) => void;
};

export const EntityNavigationContext = createContext<EntityNavigation | null>(null);

export const taskHref = (projectId: string, taskId: string) => routeUrl('tasks', `taskId=${encodeURIComponent(taskId)}`, projectId);
export const conversationHref = (projectId: string, conversationId: string) => routeUrl('conversations', `conversationId=${encodeURIComponent(conversationId)}`, projectId);
export const featureHref = (projectId: string, featureId: string) => routeUrl('tasks', `featureId=${encodeURIComponent(featureId)}`, projectId);

function plainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export const filterHref = (projectId: string, param: string, value: string) => routeUrl('tasks', `${param}=${encodeURIComponent(value)}`, projectId);

type LinkBase = { className?: string; title?: string; children: ReactNode; projectId?: string | null };

const entityLink = 'font-semibold text-tone-blue underline decoration-[#b9c1f5] underline-offset-2 wrap-anywhere hover:text-[#2a39ad] hover:decoration-current';
const entityChip = 'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-ui-sm bg-tone-slate-bg px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap text-tone-slate no-underline hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue';

export function TaskLink({ taskId, projectId, className = entityLink, title, children }: LinkBase & { taskId: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={taskHref(target, taskId)} title={title ?? 'Abrir tarefa'} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.openTask(taskId, target); } }}>{children}</a>;
}

export function ConversationLink({ conversationId, projectId, className = entityLink, title, children }: LinkBase & { conversationId: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={conversationHref(target, conversationId)} title={title ?? 'Abrir conversa'} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.openConversation(conversationId); } }}>{children}</a>;
}

export function FeatureLink({ featureId, projectId, className = entityLink, title, children }: LinkBase & { featureId: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={featureHref(target, featureId)} title={title ?? 'Ver todas as tarefas desta feature'} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.filterByFeature(featureId); } }}>{children}</a>;
}

/** Chip que filtra a fila de tarefas por um campo (área, tipo...). */
export function FilterLink({ param, value, projectId, className = entityChip, title, children }: LinkBase & { param: string; value: string }) {
  const navigation = useContext(EntityNavigationContext);
  const target = projectId || navigation?.projectId || '';
  return <a className={className} href={filterHref(target, param, value)} title={title ?? 'Filtrar tarefas por este valor'} onClick={event => { if (navigation && plainClick(event)) { event.preventDefault(); event.stopPropagation(); navigation.filterBy(param, value); } }}>{children}</a>;
}
