import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const menuClass = 'fixed z-[70] grid max-h-[min(420px,calc(100vh-20px))] w-[min(220px,calc(100vw-20px))] gap-0.5 overflow-y-auto rounded-ui-md border border-[#e1e5ed] bg-white p-[5px] shadow-[0_12px_32px_#18223026]';
const itemClass = 'min-h-[34px] w-full cursor-pointer rounded-ui-sm bg-transparent px-2.5 py-[7px] text-left text-ui-sm focus-visible:outline-none disabled:cursor-not-allowed';
const itemTone = 'text-[#475467] hover:bg-[#f3f5ff] hover:text-[#4c5bc9] focus-visible:bg-[#f3f5ff] focus-visible:text-[#4c5bc9] disabled:text-[#a0a7b2]';
const itemDanger = 'text-[#ad414b] hover:bg-[#fff5f5] hover:text-[#8f303a] focus-visible:bg-[#fff5f5] focus-visible:text-[#8f303a]';

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
    {open && createPortal(<div ref={menuRef} className={menuClass} role="menu" aria-label={ariaLabel} style={{ top: position.top, left: position.left }}>
      {items.map(item => <Fragment key={item.id}>{item.dividerBefore && <div className="mx-[5px] my-[3px] h-px bg-[#eceff4]" role="separator" />}<button type="button" role="menuitem" className={`${itemClass} ${item.danger ? itemDanger : itemTone}`} disabled={item.disabled} onClick={() => { setOpen(false); onSelect(item.id); }}>{item.label}</button></Fragment>)}
    </div>, document.body)}
  </>;
}
