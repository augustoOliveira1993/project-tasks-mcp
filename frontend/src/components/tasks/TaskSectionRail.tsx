import type { KeyboardEvent, ReactNode } from 'react';

export type TaskSection<Id extends string = string> = { id: Id; label: string; count?: string };

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

  return <nav className={'task-rail task-rail-' + orientation} aria-label="Seções da tarefa">
    <div className="drawer-tabs task-rail-tabs" role="tablist" aria-label="Seções da tarefa" aria-orientation={orientation}>
      {sections.map(item => {
        const selected = active === item.id;
        return <button key={item.id} id={`task-tab-${item.id}`} type="button" role="tab" aria-selected={selected} aria-controls="task-tabpanel" tabIndex={selected || active === null && item === sections[0] ? 0 : -1} className={'drawer-tab' + (selected ? ' active' : '')} onClick={() => onSelect(item.id)} onKeyDown={event => move(event, item.id)}>{item.label}{item.count && <span className="tab-count">{item.count}</span>}</button>;
      })}
    </div>
    {footer}
  </nav>;
}
