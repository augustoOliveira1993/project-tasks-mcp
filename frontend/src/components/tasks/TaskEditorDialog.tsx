import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { AssigneePicker } from '../ui/AssigneePicker';
import { useAssignees } from '../../features/tasks/assignees';

type Feature = { _id: string; name: string };
const taskTypes = ['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'];

export function TaskEditorDialog({ token, nonce, project, tasks, features, task, systemAdmin = false, close, notify, onSaved }: {
  systemAdmin?: boolean;
  token: string; nonce: string; project: Project; tasks: Task[]; features: Feature[]; task: Task; close: () => void; notify: (message: string, kind?: string) => void; onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const assignees = useAssignees(token, nonce, project._id, systemAdmin);
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
        <div><AssigneePicker name="responsible" assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} defaultValue={task.responsible} allowEmpty={!task.responsible} /><small>Escolha entre as credenciais ativas de pessoas e agentes. O responsável só pode ser trocado, não removido.</small></div>
      </div>
      <div className="dependency-picker" role="group" aria-labelledby="edit-task-dependencies-label"><strong id="edit-task-dependencies-label">Dependências</strong><div className="dependency-options">{tasks.filter(item => item._id !== task._id).map(item => <label className="dependency-option" key={item._id}><input type="checkbox" checked={dependencies.includes(item._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, item._id] : current.filter(id => id !== item._id))} /><span>{item.name} · {item.status}</span></label>)}</div></div>
      <div className="button-row end-row"><button type="button" className="button secondary" onClick={close} disabled={mutation.isPending}>Cancelar</button><button className="button primary" disabled={mutation.isPending || repositories.length === 0}>{mutation.isPending ? 'Salvando…' : 'Salvar tarefa'}</button></div>
    </form>
  </dialog>;
}
