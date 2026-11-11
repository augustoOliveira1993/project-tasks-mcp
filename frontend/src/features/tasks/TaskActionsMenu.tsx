import type { Task } from '../../api';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { IconMore } from '../../components/ui/icons';
import { buildTaskMenu, type TaskRowAction } from './task-actions';

export function TaskActionsMenu({ task, canHardDelete, saving, onAction }: { task: Task; canHardDelete: boolean; saving: boolean; onAction: (action: TaskRowAction) => void }) {
  const items = buildTaskMenu(task, { canHardDelete, saving });
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" size="icon" className="size-8" aria-label={`Mais ações para ${task.name}`} title="Mais ações"><IconMore aria-hidden="true" size={16} /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" aria-label={`Ações de ${task.name}`}>
      {items.map(item => <div key={item.id}>
        {item.dividerBefore && <DropdownMenuSeparator />}
        <DropdownMenuItem disabled={item.disabled} variant={item.danger ? 'destructive' : 'default'} onSelect={() => onAction(item.id)}>{item.label}</DropdownMenuItem>
      </div>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
