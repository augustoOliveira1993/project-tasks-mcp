import type { FormEvent } from 'react';
import type { Task } from '../../../api';
import { statusLabels } from '../status';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';

export function TaskStatusDialog({ task, saving, onClose, onSubmit }: { task: Task; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isBlocking = task.status === 'em_execucao';
  const statuses = isBlocking ? ['bloqueada'] : ['pendente', 'em_revisao', 'concluida', 'cancelada'];
  const initialStatus = isBlocking ? 'bloqueada' : task.status;

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-border px-5 py-5 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ação administrativa</p>
        <DialogTitle className="mt-1">{isBlocking ? 'Bloquear tarefa' : 'Alterar status'}</DialogTitle>
        <DialogDescription className="break-words">{task.name}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4 p-5 sm:p-6" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="task-status">Novo status</Label>
          <Select name="status" defaultValue={initialStatus}>
            <SelectTrigger id="task-status" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(statusLabels).filter(([key]) => statuses.includes(key)).map(([key, label]) => <SelectItem value={key} key={key}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="task-status-reason">{isBlocking ? 'Motivo do bloqueio' : 'Motivo'}</Label>
          <Textarea id="task-status-reason" name="reason" required rows={3} placeholder={isBlocking ? 'Explique por que esta tarefa deve ser bloqueada' : 'Descreva o motivo da alteração'} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{isBlocking ? 'Bloquear tarefa' : 'Salvar status'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
