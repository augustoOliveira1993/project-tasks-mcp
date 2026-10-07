import { Badge } from '../ui/Badge';
import { TaskLink } from '../ui/Links';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { areaLabel } from '../../lib/labels';

export type ChainTask = { _id: string; name: string; status: string; area?: string };

function ChainGroup({ label, items, projectId }: { label: string; items: ChainTask[]; projectId: string }) {
  if (!items.length) return null;
  return <div className="chain-group">
    <span className="chain-label">{label}</span>
    <ul className="chain-list">{items.map(item => <li key={item._id}>
      <TaskLink taskId={item._id} projectId={projectId}>{item.name}</TaskLink>
      <Badge tone={statusTone[item.status]}>{statusLabels[item.status] ?? item.status}</Badge>
      {item.area && <span className={`chip chip-area chip-area-${item.area}`}>{areaLabel(item.area)}</span>}
    </li>)}</ul>
  </div>;
}

/** Dependências ("Depende de") e dependentes ("Libera") de uma tarefa; não renderiza nada quando ambos estão vazios. */
export function TaskChainList({ projectId, dependencies, dependents }: { projectId: string; dependencies: ChainTask[]; dependents: ChainTask[] }) {
  if (!dependencies.length && !dependents.length) return null;
  return <section className="drawer-section" aria-label="Encadeamento de tarefas">
    <h3>Encadeamento</h3>
    <ChainGroup label="Depende de" items={dependencies} projectId={projectId} />
    <ChainGroup label="Libera" items={dependents} projectId={projectId} />
  </section>;
}
