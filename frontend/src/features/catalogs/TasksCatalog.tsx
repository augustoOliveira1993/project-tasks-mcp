import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { CreateTaskDialog } from '../tasks/CreateTaskDialog';
import { CatalogRecordDialog } from './FeaturesCatalog';

type Feature = { _id: string; name: string };
const taskTypes = ['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'];
const editableTaskStates = ['pendente', 'bloqueada'];
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
        {tasks.map(task => <tr key={task._id}><td><strong>{task.name}</strong><small className="catalog-row-id">{task._id}</small></td><td>{task.featureId ? featureNames.get(task.featureId) ?? 'Feature indisponível' : 'Sem feature'}</td><td>{task.area ?? '—'}</td><td>{task.status}</td><td>{task.responsible ?? '—'}</td><td><div className="catalog-row-actions"><button className="text-button" type="button" onClick={() => setSelected(task)}>Ver</button><button className="text-button" type="button" disabled={!editableTaskStates.includes(task.status)} title={editableTaskStates.includes(task.status) ? 'Editar tarefa' : 'Só é possível editar tarefas pendentes ou bloqueadas.'} onClick={() => setEditing(task)}>Editar</button><button className="text-button danger-text" type="button" disabled={!terminalTaskStates.includes(task.status) || archive.isPending} title={terminalTaskStates.includes(task.status) ? 'Arquivar tarefa' : 'Só é possível arquivar tarefas concluídas ou canceladas.'} onClick={() => { if (window.confirm(`Arquivar a tarefa “${task.name}”?`)) archive.mutate(task); }}>Arquivar</button></div></td></tr>)}
      </tbody></table></div> : <div className="empty-state compact"><h3>Nenhuma tarefa</h3><p>Cadastre a primeira tarefa deste projeto.</p></div>}
      {archive.isError && <p className="notice error" role="alert">{errorMessage(archive.error)}</p>}
    </section>}
    {creating && project && <CreateTaskDialog key={projectId} token={token} nonce={nonce} projectId={projectId} repositories={repositories} areas={areas} tasks={tasks} defaultFeatureId="" close={() => setCreating(false)} onCreated={task => { setCreating(false); notify(`Tarefa “${task.name}” criada.`, 'success'); onChanged(); }} />}
    {selected && <CatalogRecordDialog title={selected.name} subtitle={`Tarefa · ${selected.status}`} close={() => setSelected(null)}><div className="catalog-detail-grid"><div><dt>Área</dt><dd>{selected.area ?? '—'}</dd></div><div><dt>Tipo</dt><dd>{selected.type ?? 'feature'}</dd></div><div><dt>Feature</dt><dd>{selected.featureId ? featureNames.get(selected.featureId) ?? 'Indisponível' : 'Sem feature'}</dd></div><div><dt>Prioridade</dt><dd>{selected.priority ?? '—'}</dd></div><div><dt>Responsável</dt><dd>{selected.responsible || 'Não atribuído'}</dd></div><div><dt>Atualizada</dt><dd>{formatDate(selected.updatedAt)}</dd></div></div><div className="catalog-detail-section"><h3>Instruções</h3><MarkdownView content={selected.instructions ?? selected.description ?? ''} /></div><div className="catalog-detail-section"><h3>Critérios de aceite</h3><ul className="catalog-acceptance-list">{(selected.acceptance ?? []).map((criterion, index) => <li key={index}><MarkdownView content={criterion} /><small>{selected.acceptanceProgress?.[index] ? 'Atendido' : 'Pendente'}</small></li>)}</ul></div></CatalogRecordDialog>}
    {editing && project && <TaskEditor token={token} nonce={nonce} project={project} tasks={tasks} features={features.data ?? []} task={editing} close={() => setEditing(null)} notify={notify} onSaved={() => { setEditing(null); onChanged(); }} />}
  </section>;
}

function TaskEditor({ token, nonce, project, tasks, features, task, close, notify, onSaved }: {
  token: string; nonce: string; project: Project; tasks: Task[]; features: Feature[]; task: Task; close: () => void; notify: (message: string, kind?: string) => void; onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const [dependencies, setDependencies] = useState<string[]>(task.dependencies ?? []);
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => request<Task>(token, '/admin/records/edit', { body: { operationId: operationId(), projectId: project._id, kind: 'task', id: task._id, version: task.version, data } }),
    onSuccess: async result => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project-tasks', nonce, project._id] }),
        client.invalidateQueries({ queryKey: ['task-context', nonce, project._id, task._id] }),
        client.invalidateQueries({ queryKey: ['admin-projects', nonce] })
      ]);
      notify(`Tarefa “${result.name}” atualizada.`, 'success');
      onSaved();
    }
  });
  const repositories = project.repositories ?? [];
  const areas = project.areas?.length ? project.areas : ['backend', 'frontend', 'outro'];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const instructions = String(form.get('instructions') ?? '').trim();
    const acceptance = String(form.get('acceptance') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
    if (!acceptance.length) return notify('Informe pelo menos um critério de aceite.', 'error');
    const responsible = String(form.get('responsible') ?? '').trim();
    if (task.responsible && !responsible) return notify('O contrato atual não permite limpar o responsável. Informe outro responsável ou mantenha o valor existente.', 'error');
    const originalAcceptance = task.acceptance ?? [];
    const acceptanceChanged = acceptance.length !== originalAcceptance.length || acceptance.some((value, index) => value !== originalAcceptance[index]);
    const data: Record<string, unknown> = {
      name, instructions, area: String(form.get('area') ?? ''), repositoryId: String(form.get('repositoryId') ?? ''),
      featureId: String(form.get('featureId') ?? '') || null, type: String(form.get('type') ?? 'feature'),
      priority: Number(form.get('priority') ?? 2), dependencies,
      ...(responsible ? { responsible } : {})
    };
    if (acceptanceChanged) data.acceptance = acceptance;
    mutation.mutate(data);
  }

  return <dialog ref={dialogRef} className="dialog create-task-dialog catalog-record-dialog" aria-labelledby="edit-task-title" onCancel={event => { event.preventDefault(); if (!mutation.isPending) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">TAREFA · EDIÇÃO</p><h2 id="edit-task-title">Editar tarefa</h2><p className="muted-text">{task._id} · versão {task.version}</p></div><button className="icon-button" type="button" onClick={close} disabled={mutation.isPending} aria-label="Fechar">×</button></header>
    {mutation.isError && <p className="notice error" role="alert">{errorMessage(mutation.error)}</p>}
    <form className="stack-form create-task-form catalog-edit-form" onSubmit={submit}>
      <label>Nome<input name="name" required maxLength={20000} defaultValue={task.name} /></label>
      <label>Instruções<textarea name="instructions" required maxLength={20000} rows={4} defaultValue={task.instructions ?? task.description ?? ''} /></label>
      <label>Critérios de aceite<textarea name="acceptance" required rows={5} defaultValue={(task.acceptance ?? []).join('\n')} /><small>Um critério por linha. Alterar os critérios reinicia o progresso deles.</small></label>
      <div className="create-task-fields">
        <label>Área<select name="area" required defaultValue={task.area ?? areas[0]}>{areas.map(area => <option key={area} value={area}>{area}</option>)}</select></label>
        <label>Repositório<select name="repositoryId" required defaultValue={task.repositoryId ?? ''}><option value="" disabled>Selecione</option>{repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select></label>
        <label>Feature<select name="featureId" defaultValue={task.featureId ?? ''}><option value="">Sem feature</option>{features.map(feature => <option key={feature._id} value={feature._id}>{feature.name}</option>)}</select></label>
        <label>Tipo<select name="type" defaultValue={task.type ?? 'feature'}>{taskTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label>Prioridade<select name="priority" defaultValue={task.priority ?? 2}>{[0, 1, 2, 3, 4, 5].map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></label>
        <label>Responsável<input name="responsible" maxLength={320} defaultValue={task.responsible ?? ''} /><small>Deixe vazio somente quando o campo já estiver sem responsável.</small></label>
      </div>
      <div className="dependency-picker" role="group" aria-labelledby="edit-task-dependencies-label"><strong id="edit-task-dependencies-label">Dependências</strong><div className="dependency-options">{tasks.filter(item => item._id !== task._id).map(item => <label className="dependency-option" key={item._id}><input type="checkbox" checked={dependencies.includes(item._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, item._id] : current.filter(id => id !== item._id))} /><span>{item.name} · {item.status}</span></label>)}</div></div>
      <div className="button-row end-row"><button type="button" className="button secondary" onClick={close} disabled={mutation.isPending}>Cancelar</button><button className="button primary" disabled={mutation.isPending || repositories.length === 0}>{mutation.isPending ? 'Salvando…' : 'Salvar tarefa'}</button></div>
    </form>
  </dialog>;
}
