import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { AssigneePicker } from '../ui/AssigneePicker';
import { useAssignees } from '../../features/tasks/assignees';
import { buttonPrimary, buttonSecondary, eyebrow, notice } from '../ui/classes';

type Feature = { _id: string; name: string };
const taskTypes = ['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'];

const dialogClass = 'm-auto max-h-[min(850px,calc(100dvh-28px))] w-[min(100%-28px,720px)] overflow-auto rounded-ui-lg border border-[#dfe4ed] bg-white p-0 text-[#455164] shadow-[0_24px_70px_#18223040] open:block backdrop:bg-[#18203388] backdrop:backdrop-blur-[3px]';
const headerClass = 'flex items-start justify-between gap-4 border-b border-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const titleClass = 'mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]';
const iconButton = 'inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const formClass = 'grid max-h-[calc(100dvh-175px)] gap-[13px] overflow-y-auto px-[22px] pt-4 pb-5 max-[760px]:px-4 max-[480px]:pt-[13px] max-[480px]:pb-4';
const hint = 'text-[9px] leading-normal font-normal text-[#8a94a4]';
const fieldLabel = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const control = 'w-full rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054]';
const textareaControl = `${control} resize-y`;

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

  return <dialog ref={dialogRef} className={dialogClass} aria-labelledby="edit-task-title" onCancel={event => { event.preventDefault(); if (!mutation.isPending) close(); }}>
    <header className={headerClass}><div><p className={eyebrow}>TAREFA · EDIÇÃO</p><h2 className={titleClass} id="edit-task-title">Editar tarefa</h2><p className="text-[10px] text-muted-strong">{task._id} · versão {task.version}</p></div><button className={iconButton} type="button" onClick={close} disabled={mutation.isPending} aria-label="Fechar">×</button></header>
    {mutation.isError && <p className={`${notice.error} mx-[22px] mt-[13px]`} role="alert">{errorMessage(mutation.error)}</p>}
    <form className={formClass} onSubmit={submit}>
      <label className={fieldLabel}>Nome<input className={control} name="name" required maxLength={20000} defaultValue={task.name} /></label>
      <label className={fieldLabel}>Instruções<textarea className={textareaControl} name="instructions" required maxLength={20000} rows={4} defaultValue={task.instructions ?? task.description ?? ''} /></label>
      <label className={fieldLabel}>Critérios de aceite<textarea className={textareaControl} name="acceptance" required rows={5} defaultValue={(task.acceptance ?? []).join('\n')} /><small className={hint}>Um critério por linha. Alterar os critérios reinicia o progresso deles.</small></label>
      <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-[1fr]">
        <label className={fieldLabel}>Área<select className={control} name="area" required defaultValue={task.area ?? areas[0]}>{areas.map(area => <option key={area} value={area}>{area}</option>)}</select></label>
        <label className={fieldLabel}>Repositório<select className={control} name="repositoryId" required defaultValue={task.repositoryId ?? ''}><option value="" disabled>Selecione</option>{repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select></label>
        <label className={fieldLabel}>Feature<select className={control} name="featureId" defaultValue={task.featureId ?? ''}><option value="">Sem feature</option>{features.map(feature => <option key={feature._id} value={feature._id}>{feature.name}</option>)}</select></label>
        <label className={fieldLabel}>Tipo<select className={control} name="type" defaultValue={task.type ?? 'feature'}>{taskTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className={fieldLabel}>Prioridade<select className={control} name="priority" defaultValue={task.priority ?? 2}>{[0, 1, 2, 3, 4, 5].map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></label>
        <div><AssigneePicker name="responsible" assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} defaultValue={task.responsible} allowEmpty={!task.responsible} /><small className={hint}>Escolha entre as credenciais ativas de pessoas e agentes. O responsável só pode ser trocado, não removido.</small></div>
      </div>
      <div className="grid gap-[7px] text-[10px] text-[#566275]" role="group" aria-labelledby="edit-task-dependencies-label"><strong className="font-semibold" id="edit-task-dependencies-label">Dependências</strong><div className="grid max-h-[150px] gap-1 overflow-y-auto rounded-[7px] border border-[#e1e5ed] p-[7px]">{tasks.filter(item => item._id !== task._id).map(item => <label className="flex cursor-pointer items-center gap-2 px-0.5 py-1 text-[10px] font-normal text-[#566275]" key={item._id}><input className="m-0 size-[14px] flex-none rounded-[7px] border border-[#e1e5ed] bg-white p-0 text-[11px] text-[#344054] accent-accent" type="checkbox" checked={dependencies.includes(item._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, item._id] : current.filter(id => id !== item._id))} /><span>{item.name} · {item.status}</span></label>)}</div></div>
      <div className="mt-1 flex items-center justify-end gap-2"><button type="button" className={buttonSecondary} onClick={close} disabled={mutation.isPending}>Cancelar</button><button className={buttonPrimary} disabled={mutation.isPending || repositories.length === 0}>{mutation.isPending ? 'Salvando…' : 'Salvar tarefa'}</button></div>
    </form>
  </dialog>;
}
