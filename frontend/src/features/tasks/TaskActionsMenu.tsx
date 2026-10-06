import type { Task } from '../../api';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { IconMore } from '../../components/ui/icons';
import { buildTaskMenu, type TaskRowAction } from './task-actions';

export function TaskActionsMenu({ task, canHardDelete, saving, onAction }: { task: Task; canHardDelete: boolean; saving: boolean; onAction: (action: TaskRowAction) => void }) {
  return <DropdownMenu items={buildTaskMenu(task, { canHardDelete, saving })} onSelect={onAction} ariaLabel={'Mais ações para ' + task.name} title="Mais ações" triggerClassName="small-icon task-action-menu-trigger"><IconMore size={16} /></DropdownMenu>;
}
