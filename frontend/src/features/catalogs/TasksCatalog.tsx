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
import { buttonPrimary, notice, textButton } from '../../components/ui/classes';
import {
  acceptanceItem, acceptanceList, acceptanceStatus, cellStrong, dangerTextButton, detailGrid, detailItem, detailSection, detailSectionTitle, detailTerm, detailValue,
  emptyState, emptyText, emptyTitle, rowActions, rowHover, rowId, screen, screenAction, screenDescription, screenHeading, screenTitle, sectionDescription, sectionHeading,
  sectionTitle, table, tableCard, tableScroll, tdCell, textButtonNowrap, thCell
} from './catalogClasses';

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

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Tarefas</h2><p className={screenDescription}>Consulte, edite e arquive tarefas do projeto selecionado.</p></div><button className={`${buttonPrimary} ${screenAction}`} type="button" disabled={!project || repositories.length === 0} onClick={() => setCreating(true)}>Nova tarefa</button></div>
    {!project ? <p className={notice.info}>Selecione um projeto para consultar as tarefas.</p> : features.isError ? <p className={notice.error} role="alert">Não foi possível carregar as features: {errorMessage(features.error)}</p> : <section className={tableCard}><div className={sectionHeading}><div><h3 className={sectionTitle}>Tarefas cadastradas</h3><p className={sectionDescription}>{tasks.length} tarefa(s)</p></div></div>
      {tasks.length ? <div className={tableScroll}><table className={table}><thead><tr><th className={thCell}>Tarefa</th><th className={thCell}>Feature</th><th className={thCell}>Área</th><th className={thCell}>Status</th><th className={thCell}>Responsável</th><th className={thCell}>Ações</th></tr></thead><tbody>
        {tasks.map(task => <tr key={task._id} className={rowHover}><td className={tdCell}><strong className={cellStrong}>{task.name}</strong><small className={rowId}>{task._id}</small></td><td className={tdCell}>{task.featureId ? featureNames.get(task.featureId) ?? 'Feature indisponível' : 'Sem feature'}</td><td className={tdCell}>{task.area ?? '—'}</td><td className={tdCell}>{task.status}</td><td className={tdCell}>{task.responsible ?? '—'}</td><td className={tdCell}><div className={rowActions}><button className={textButtonNowrap} type="button" onClick={() => setSelected(task)}>Ver</button><button className={textButtonNowrap} type="button" onClick={() => setEditing(task)}>Editar</button><button className={dangerTextButton} type="button" disabled={!terminalTaskStates.includes(task.status) || archive.isPending} title={terminalTaskStates.includes(task.status) ? 'Arquivar tarefa' : 'Só é possível arquivar tarefas concluídas ou canceladas.'} onClick={() => { if (window.confirm(`Arquivar a tarefa “${task.name}”?`)) archive.mutate(task); }}>Arquivar</button></div></td></tr>)}
      </tbody></table></div> : <div className={emptyState}><h3 className={emptyTitle}>Nenhuma tarefa</h3><p className={emptyText}>Cadastre a primeira tarefa deste projeto.</p></div>}
      {archive.isError && <p className={notice.error} role="alert">{errorMessage(archive.error)}</p>}
    </section>}
    {creating && project && <CreateTaskDialog key={projectId} token={token} nonce={nonce} projectId={projectId} repositories={repositories} areas={areas} tasks={tasks} defaultFeatureId="" close={() => setCreating(false)} onCreated={task => { setCreating(false); notify(`Tarefa “${task.name}” criada.`, 'success'); onChanged(); }} />}
    {selected && <CatalogRecordDialog title={selected.name} subtitle={`Tarefa · ${selected.status}`} close={() => setSelected(null)}><div className={detailGrid}><div className={detailItem}><dt className={detailTerm}>Área</dt><dd className={detailValue}>{selected.area ?? '—'}</dd></div><div className={detailItem}><dt className={detailTerm}>Tipo</dt><dd className={detailValue}>{selected.type ?? 'feature'}</dd></div><div className={detailItem}><dt className={detailTerm}>Feature</dt><dd className={detailValue}>{selected.featureId ? featureNames.get(selected.featureId) ?? 'Indisponível' : 'Sem feature'}</dd></div><div className={detailItem}><dt className={detailTerm}>Prioridade</dt><dd className={detailValue}>{selected.priority ?? '—'}</dd></div><div className={detailItem}><dt className={detailTerm}>Responsável</dt><dd className={detailValue}>{selected.responsible || 'Não atribuído'}</dd></div><div className={detailItem}><dt className={detailTerm}>Atualizada</dt><dd className={detailValue}>{formatDate(selected.updatedAt)}</dd></div></div><p><a className={textButton} href={taskPageUrl(projectId, selected._id)}>Abrir página da tarefa</a></p><div className={detailSection}><h3 className={detailSectionTitle}>Instruções</h3><MarkdownView content={selected.instructions ?? selected.description ?? ''} /></div><div className={detailSection}><h3 className={detailSectionTitle}>Critérios de aceite</h3><ul className={acceptanceList}>{(selected.acceptance ?? []).map((criterion, index) => <li key={index} className={acceptanceItem}><MarkdownView content={criterion} /><small className={acceptanceStatus}>{selected.acceptanceProgress?.[index] ? 'Atendido' : 'Pendente'}</small></li>)}</ul></div></CatalogRecordDialog>}
    {editing && project && <TaskEditorDialog token={token} nonce={nonce} project={project} tasks={tasks} features={features.data ?? []} task={editing} close={() => setEditing(null)} notify={notify} onSaved={() => { setEditing(null); onChanged(); }} />}
  </section>;
}
