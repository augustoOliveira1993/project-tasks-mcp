import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type SheetSide = 'top' | 'right' | 'bottom' | 'left';

const sideClasses: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 max-h-[85dvh] w-full border-b',
  right: 'inset-y-0 right-0 h-dvh w-[min(24rem,90vw)] border-l',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] w-full border-t',
  left: 'inset-y-0 left-0 h-dvh w-[min(24rem,90vw)] border-r'
};

function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({ side = 'right', className, children, showCloseButton = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { side?: SheetSide; showCloseButton?: boolean }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-black/45 transition-opacity" />
    <DialogPrimitive.Content
      data-slot="sheet-content"
      className={cn('fixed z-50 flex flex-col gap-4 overflow-y-auto overscroll-contain bg-background p-6 text-foreground shadow-lg outline-none', sideClasses[side], className)}
      {...props}
    >
      {children}
      {showCloseButton && <DialogPrimitive.Close data-slot="sheet-close-button" className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <X aria-hidden="true" className="size-4" />
        <span className="sr-only">Fechar painel</span>
      </DialogPrimitive.Close>}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />;
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />;
}

function SheetDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
