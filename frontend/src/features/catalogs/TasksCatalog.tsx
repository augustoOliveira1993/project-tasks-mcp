import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { TaskEditorDialog } from '../../components/tasks/TaskEditorDialog';
import { CreateTaskDialog } from '../tasks/CreateTaskDialog';
import { CatalogRecordDialog } from './FeaturesCatalog';
import { taskPageUrl } from '../../route-state';

type Feature = { _id: string; name: string };
const terminalTaskStates = ['concluida', 'cancelada'];

export function TasksCatalog({ token, nonce, project, tasks, notify, onChanged }: {
  token: string; nonce: string; project?: Project; tasks: Task[]; notify: (message: string, kind?: string) => void; onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const projectId = project?._id ?? '';
  const client = useQueryClient();
  const features = useQuery({
    queryKey: ['project-features', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId, archived: false })
  });
  const archive = useMutation({
    mutationFn: (task: Task) => request(token, '/admin/archive', { body: { operationId: operationId(), projectId, kind: 'task', id: task._id, version: task.version } }),
    onSuccess: async (_result, task) => {
      await client.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] });
      await client.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      notify(`Tarefa “${task.name}” arquivada.`, 'success');
      onChanged();
    },
    onError: error => notify(errorMessage(error), 'error')
  });
  const featureNames = new Map((features.data ?? []).map(feature => [feature._id, feature.name]));
  const repositories = project?.repositories ?? [];
  const areas = project?.areas?.length ? project.areas : ['backend', 'frontend', 'outro'];

  return <section className="catalog-record-screen">
    <div className="catalog-screen-heading"><div><h2>Tarefas</h2><p className="muted-text">Consulte, edite e arquive tarefas do projeto selecionado.</p></div><button className="button primary" type="button" disabled={!project || repositories.length === 0} onClick={() => setCreating(true)}>Nova tarefa</button></div>
    {!project ? <p className="notice">Selecione um projeto para consultar as tarefas.</p> : features.isError ? <p className="notice error" role="alert">Não foi possível carregar as features: {errorMessage(features.error)}</p> : <section className="panel-card catalog-table-card"><div className="section-heading"><div><h3>Tarefas cadastradas</h3><p className="muted-text">{tasks.length} tarefa(s)</p></div></div>
      {tasks.length ? <div className="table-scroll"><table className="catalog-table"><thead><tr><th>Tarefa</th><th>Feature</th><th>Área</th><th>Status</th><th>Responsável</th><th>Ações</th></tr></thead><tbody>
        {tasks.map(task => <tr key={task._id}><td><strong>{task.name}</strong><small className="catalog-row-id">{task._id}</small></td><td>{task.featureId ? featureNames.get(task.featureId) ?? 'Feature indisponível' : 'Sem feature'}</td><td>{task.area ?? '—'}</td><td>{task.status}</td><td>{task.responsible ?? '—'}</td><td><div className="catalog-row-actions"><button className="text-button" type="button" onClick={() => setSelected(task)}>Ver</button><button className="text-button" type="button" onClick={() => setEditing(task)}>Editar</button><button className="text-button danger-text" type="button" disabled={!terminalTaskStates.includes(task.status) || archive.isPending} title={terminalTaskStates.includes(task.status) ? 'Arquivar tarefa' : 'Só é possível arquivar tarefas concluídas ou canceladas.'} onClick={() => { if (window.confirm(`Arquivar a tarefa “${task.name}”?`)) archive.mutate(task); }}>Arquivar</button></div></td></tr>)}
      </tbody></table></div> : <div className="empty-state compact"><h3>Nenhuma tarefa</h3><p>Cadastre a primeira tarefa deste projeto.</p></div>}
      {archive.isError && <p className="notice error" role="alert">{errorMessage(archive.error)}</p>}
    </section>}
    {creating && project && <CreateTaskDialog key={projectId} token={token} nonce={nonce} projectId={projectId} repositories={repositories} areas={areas} tasks={tasks} defaultFeatureId="" close={() => setCreating(false)} onCreated={task => { setCreating(false); notify(`Tarefa “${task.name}” criada.`, 'success'); onChanged(); }} />}
    {selected && <CatalogRecordDialog title={selected.name} subtitle={`Tarefa · ${selected.status}`} close={() => setSelected(null)}><div className="catalog-detail-grid"><div><dt>Área</dt><dd>{selected.area ?? '—'}</dd></div><div><dt>Tipo</dt><dd>{selected.type ?? 'feature'}</dd></div><div><dt>Feature</dt><dd>{selected.featureId ? featureNames.get(selected.featureId) ?? 'Indisponível' : 'Sem feature'}</dd></div><div><dt>Prioridade</dt><dd>{selected.priority ?? '—'}</dd></div><div><dt>Responsável</dt><dd>{selected.responsible || 'Não atribuído'}</dd></div><div><dt>Atualizada</dt><dd>{formatDate(selected.updatedAt)}</dd></div></div><p><a className="text-button" href={taskPageUrl(projectId, selected._id)}>Abrir página da tarefa</a></p><div className="catalog-detail-section"><h3>Instruções</h3><MarkdownView content={selected.instructions ?? selected.description ?? ''} /></div><div className="catalog-detail-section"><h3>Critérios de aceite</h3><ul className="catalog-acceptance-list">{(selected.acceptance ?? []).map((criterion, index) => <li key={index}><MarkdownView content={criterion} /><small>{selected.acceptanceProgress?.[index] ? 'Atendido' : 'Pendente'}</small></li>)}</ul></div></CatalogRecordDialog>}
    {editing && project && <TaskEditorDialog token={token} nonce={nonce} project={project} tasks={tasks} features={features.data ?? []} task={editing} close={() => setEditing(null)} notify={notify} onSaved={() => { setEditing(null); onChanged(); }} />}
  </section>;
}
