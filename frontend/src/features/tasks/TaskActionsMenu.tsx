import type { Task } from '../../api';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { IconMore } from '../../components/ui/icons';
import { buildTaskMenu, type TaskRowAction } from './task-actions';

const trigger = 'inline-grid size-8 flex-none place-items-center rounded-[7px] border border-line-strong bg-transparent text-[15px] text-[#8792a2] hover:bg-[#f6f7fc] hover:text-[#4c5bc9] aria-expanded:bg-[#f5f6ff] aria-expanded:text-[#4c5bc9] aria-expanded:hover:bg-[#f6f7fc]';

export function TaskActionsMenu({ task, canHardDelete, saving, onAction }: { task: Task; canHardDelete: boolean; saving: boolean; onAction: (action: TaskRowAction) => void }) {
  return <DropdownMenu items={buildTaskMenu(task, { canHardDelete, saving })} onSelect={onAction} ariaLabel={'Mais ações para ' + task.name} title="Mais ações" triggerClassName={trigger}><IconMore size={16} /></DropdownMenu>;
}
