import { Badge } from '../ui/Badge';
import { TaskLink } from '../ui/Links';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { areaLabel } from '../../lib/labels';

export type ChainTask = { _id: string; name: string; status: string; area?: string };

const chipArea: Record<string, string> = {
  backend: 'bg-[#eaeeff] text-[#3544a8]',
  frontend: 'bg-[#e1f4f1] text-[#136059]'
};
const chipAreaDefault = 'bg-tone-slate-bg text-tone-slate';

function ChainGroup({ label, items, projectId }: { label: string; items: ChainTask[]; projectId: string }) {
  if (!items.length) return null;
  return <div className="grid gap-1.5">
    <span className="text-ui-xs font-bold text-muted-strong">{label}</span>
    <ul className="m-0 grid list-none gap-1.5 p-0">{items.map(item => <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ui-sm border border-line bg-[#fbfcfe] px-2.5 py-2 text-ui-sm" key={item._id}>
      <TaskLink taskId={item._id} projectId={projectId}>{item.name}</TaskLink>
      <Badge tone={statusTone[item.status]}>{statusLabels[item.status] ?? item.status}</Badge>
      {item.area && <span className={`inline-flex max-w-full items-center gap-1 rounded-ui-sm px-2 py-0.5 text-[10.5px] leading-[1.5] font-semibold whitespace-nowrap ${chipArea[item.area] ?? chipAreaDefault}`}>{areaLabel(item.area)}</span>}
    </li>)}</ul>
  </div>;
}

/** Dependências ("Depende de") e dependentes ("Libera") de uma tarefa; não renderiza nada quando ambos estão vazios. */
export function TaskChainList({ projectId, dependencies, dependents }: { projectId: string; dependencies: ChainTask[]; dependents: ChainTask[] }) {
  if (!dependencies.length && !dependents.length) return null;
  return <section className="grid gap-3" aria-label="Encadeamento de tarefas">
    <h3 className="font-display text-[13px] leading-[normal] font-bold text-ink normal-case">Encadeamento</h3>
    <ChainGroup label="Depende de" items={dependencies} projectId={projectId} />
    <ChainGroup label="Libera" items={dependents} projectId={projectId} />
  </section>;
}
