import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function ConfirmDialog({ open, title, description, confirmLabel, pendingLabel = 'Processando…', pending = false, onOpenChange, onConfirm }: ConfirmDialogProps) {
  return <Dialog open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="break-words">{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>{pending ? pendingLabel : confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export { ConfirmDialog };
export type { ConfirmDialogProps };
