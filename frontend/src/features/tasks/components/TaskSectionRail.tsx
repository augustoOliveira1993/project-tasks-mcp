import type { KeyboardEvent, ReactNode } from 'react';

export type TaskSection<Id extends string = string> = { id: Id; label: string; count?: string; unread?: boolean };

const railClass = {
  horizontal: 'flex-none',
  vertical: 'sticky top-4 flex flex-col border-r border-line max-[960px]:static max-[960px]:border-r-0 max-[960px]:border-b'
};
const tabListClass = {
  horizontal: 'flex min-h-[41px] gap-0.5 overflow-x-auto border-b border-line bg-white px-4',
  vertical: 'flex min-h-0 flex-col gap-0.5 overflow-visible bg-white px-2 py-3 max-[960px]:flex-row max-[960px]:overflow-x-auto max-[960px]:px-3 max-[960px]:py-0'
};
const tabBase = 'inline-flex flex-none items-center gap-1.5 text-ui-sm font-semibold whitespace-nowrap hover:text-tone-blue';
const tabClass = {
  horizontal: {
    active: `${tabBase} min-h-10 border-b-2 border-b-focus px-3 text-tone-blue`,
    idle: `${tabBase} min-h-10 border-b-2 border-b-transparent px-3 text-muted-strong`
  },
  vertical: {
    active: `${tabBase} min-h-[38px] justify-between rounded-ui-sm border-l-[3px] border-l-focus bg-tone-blue-bg px-3 text-tone-blue max-[960px]:min-h-10 max-[960px]:rounded-none max-[960px]:border-l-0 max-[960px]:border-b-2 max-[960px]:border-b-focus max-[960px]:bg-transparent`,
    idle: `${tabBase} min-h-[38px] justify-between rounded-ui-sm border-l-[3px] border-l-transparent px-3 text-muted-strong max-[960px]:min-h-10 max-[960px]:rounded-none max-[960px]:border-l-0 max-[960px]:border-b-2 max-[960px]:border-b-transparent`
  }
};
const tabCountBase = 'min-w-[18px] rounded-[9px] px-[5px] text-center text-[10px] leading-[18px] font-bold';

/**
 * Trilho de seções da tarefa. Vertical na página (lateral esquerda) e horizontal no drawer.
 * Segue o padrão ARIA de tablist: setas, Home e End movem a seleção.
 */
export function TaskSectionRail<Id extends string>({ sections, active, orientation, onSelect, footer }: {
  sections: Array<TaskSection<Id>>;
  /** `null` quando uma visão especial (resumo completo, JSON) substitui o painel. */
  active: Id | null;
  orientation: 'vertical' | 'horizontal';
  onSelect: (id: Id) => void;
  footer?: ReactNode;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, current: Id) {
    const keys = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = sections.findIndex(item => item.id === current);
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (forward ? 1 : -1) + sections.length) % sections.length;
    onSelect(sections[next].id);
    document.getElementById(`task-tab-${sections[next].id}`)?.focus();
  }

  return <nav className={railClass[orientation]} aria-label="Seções da tarefa">
    <div className={tabListClass[orientation]} role="tablist" aria-label="Seções da tarefa" aria-orientation={orientation}>
      {sections.map(item => {
        const selected = active === item.id;
        return <button key={item.id} id={`task-tab-${item.id}`} type="button" role="tab" aria-selected={selected} aria-controls="task-tabpanel" aria-label={item.unread ? `${item.label}${item.count ? `, ${item.count} itens` : ''}, há novidades não lidas` : undefined} tabIndex={selected || active === null && item === sections[0] ? 0 : -1} className={tabClass[orientation][selected ? 'active' : 'idle']} onClick={() => onSelect(item.id)} onKeyDown={event => move(event, item.id)}>{item.label}{item.unread && <span className="size-2 rounded-full bg-[#d97706]" aria-hidden="true" />}{item.count && <span className={selected ? `${tabCountBase} bg-tone-blue-bg text-tone-blue` : `${tabCountBase} bg-tone-slate-bg text-tone-slate`}>{item.count}</span>}</button>;
      })}
    </div>
    {footer}
  </nav>;
}
