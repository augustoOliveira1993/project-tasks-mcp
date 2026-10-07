import { AgentClientIcon } from '../ui/AgentClientIcon';
import type { TaskActivity } from './conversation-types';

export { AgentClientIcon };

export function HumanAuthorIcon() {
  return <svg className="size-[15px] flex-[0_0_15px] text-[#5669b8]" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 20c.55-3.35 2.85-5.25 6.5-5.25s5.95 1.9 6.5 5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

export function UnknownAuthorIcon() {
  return <svg className="size-[15px] flex-[0_0_15px] text-[#8892a1]" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9.5 9a2.6 2.6 0 1 1 4.35 1.9c-1.1.95-1.85 1.25-1.85 2.6m0 3h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

export function authorDisplayName(author: string) {
  const identity = author.trim();
  const localPart = identity.includes('@') ? identity.slice(0, identity.indexOf('@')) : identity;
  const firstName = localPart.split(/[._+-]/).find(Boolean) ?? localPart;
  return firstName ? firstName[0].toLocaleUpperCase('pt-BR') + firstName.slice(1) : 'Desconhecido';
}

export function taskMessageTypeLabel(type: string) {
  return type === 'resposta' ? 'Resposta' : type === 'pergunta' ? 'Pergunta' : type || 'Atualização';
}

/** `head` = autor dentro do cabeçalho de mensagem da gaveta da tarefa (texto maior e ocupa a linha); `aside` = painel de critérios da conversa. */
export function TaskMessageAuthor({ message, variant = 'aside' }: { message: TaskActivity['messages'][number]; variant?: 'aside' | 'head' }) {
  const isAgent = message.authorType === 'agent';
  const isHuman = message.authorType === 'human';
  const label = isAgent ? message.clientName?.trim() || 'IA' : isHuman ? 'Pessoa' : message.clientName?.trim() ? `Cliente MCP · ${message.clientName.trim()}` : 'Origem desconhecida';
  const head = variant === 'head';

  return <div className={'grid min-w-0 gap-px text-[#536176]' + (head ? ' flex-1' : '')}>
    <strong className={'inline-flex min-w-0 flex-wrap items-center gap-[5px] text-[#334155] wrap-anywhere ' + (head ? 'text-ui-sm' : 'text-[10px]')}>
      {isAgent ? <AgentClientIcon clientName={message.clientName} /> : isHuman ? <HumanAuthorIcon /> : <UnknownAuthorIcon />}
      <span>{label} · {authorDisplayName(message.author)}</span>
    </strong>
    <small className={'pl-5 text-[#8791a1] wrap-anywhere ' + (head ? 'text-ui-xs' : 'text-[9px]')} title={message.author}>{message.author}</small>
  </div>;
}
