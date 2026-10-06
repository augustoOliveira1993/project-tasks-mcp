import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem<Id extends string = string> = { id: Id; label: string; danger?: boolean; disabled?: boolean; dividerBefore?: boolean };

export function DropdownMenu<Id extends string>({ items, onSelect, ariaLabel, title, triggerClassName, children }: {
  items: Array<MenuItem<Id>>; onSelect: (id: Id) => void; ariaLabel: string; title?: string; triggerClassName: string; children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: -1000, left: -1000 });

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
      const preferredTop = below >= bounds.height || below >= above ? anchor.bottom + gap : anchor.top - bounds.height - gap;
      const top = Math.min(Math.max(margin, preferredTop), window.innerHeight - bounds.height - margin);
      const left = Math.max(margin, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - margin));
      setPosition({ top, left });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    const outside = (target: Node) => !menuRef.current?.contains(target) && !triggerRef.current?.contains(target);
    const onPointerDown = (event: PointerEvent) => { if (outside(event.target as Node)) setOpen(false); };
    const onFocusIn = (event: FocusEvent) => { if (outside(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Captura: o Esc fecha só o menu, nunca o painel que o contém.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const enabled = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
      if (!enabled.length) return;
      if (event.key === 'Tab') { setOpen(false); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' || (index < 0 && event.key === 'ArrowUp') ? enabled.length - 1 : index < 0 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className={triggerClassName} title={title} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{children}</button>
    {open && createPortal(<div ref={menuRef} className="task-action-menu" role="menu" aria-label={ariaLabel} style={{ top: position.top, left: position.left }}>
      {items.map(item => <Fragment key={item.id}>{item.dividerBefore && <div className="task-action-menu-divider" role="separator" />}<button type="button" role="menuitem" className={item.danger ? 'task-action-menu-item danger' : 'task-action-menu-item'} disabled={item.disabled} onClick={() => { setOpen(false); onSelect(item.id); }}>{item.label}</button></Fragment>)}
    </div>, document.body)}
  </>;
}
