import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../../api';
import type { Project, Task } from '../../../api';
import { errorMessage } from '../../../lib/format';
import { plannedDateInput, plannedDateTime } from '../task-create';
import { AssigneePicker } from '../../../components/ui/AssigneePicker';
import { useAssignees } from '../assignees';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';

type Feature = { _id: string; name: string };
const taskTypes = ['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'];

const hint = 'text-xs leading-5 text-muted-foreground';

export function TaskEditorDialog({ token, nonce, project, tasks, features, task, systemAdmin = false, close, notify, onSaved }: {
  systemAdmin?: boolean;
  token: string; nonce: string; project: Project; tasks: Task[]; features: Feature[]; task: Task; close: () => void; notify: (message: string, kind?: string) => void; onSaved: () => void;
}) {
  const client = useQueryClient();
  const assignees = useAssignees(token, nonce, project._id, systemAdmin);
  const [dependencies, setDependencies] = useState<string[]>(task.dependencies ?? []);
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => request<Task>(token, '/admin/records/edit', { body: { operationId: operationId(), projectId: project._id, kind: 'task', id: task._id, version: task.version, data } }),
    onSuccess: async result => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project-tasks', nonce, project._id] }),
        client.invalidateQueries({ queryKey: ['project-dashboard', nonce, project._id] }),
        client.invalidateQueries({ queryKey: ['portfolio-dashboard', nonce] }),
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
    const plannedStartAt = String(form.get('plannedStartAt') ?? '');
    const plannedDueAt = String(form.get('plannedDueAt') ?? '');
    const repositoryId = String(form.get('repositoryId') ?? '');
    if (!repositories.some(repository => repository.id === repositoryId)) return notify('Selecione um repositório para esta tarefa.', 'error');
    const dueControl = event.currentTarget.elements.namedItem('plannedDueAt') as HTMLInputElement;
    if (plannedStartAt && plannedDueAt && plannedStartAt > plannedDueAt) {
      dueControl.setCustomValidity('A entrega planejada precisa ser no mesmo dia ou depois do início.');
      dueControl.reportValidity();
      return;
    }
    dueControl.setCustomValidity('');
    const responsible = String(form.get('responsible') ?? '').trim();
    if (task.responsible && !responsible) return notify('O contrato atual não permite limpar o responsável. Informe outro responsável ou mantenha o valor existente.', 'error');
    const originalAcceptance = task.acceptance ?? [];
    const acceptanceChanged = acceptance.length !== originalAcceptance.length || acceptance.some((value, index) => value !== originalAcceptance[index]);
    const data: Record<string, unknown> = {
      name, instructions, area: String(form.get('area') ?? ''), repositoryId,
      featureId: String(form.get('featureId') ?? '') === 'none' ? null : String(form.get('featureId') ?? '') || null, type: String(form.get('type') ?? 'feature'),
      priority: Number(form.get('priority') ?? 2), dependencies,
      plannedStartAt: plannedDateTime(plannedStartAt), plannedDueAt: plannedDateTime(plannedDueAt),
      ...(responsible ? { responsible } : {})
    };
    if (acceptanceChanged) data.acceptance = acceptance;
    mutation.mutate(data);
  }

  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) close(); }}>
    <DialogContent className="flex max-h-[min(90dvh,850px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tarefa · edição</p>
        <DialogTitle className="mt-1">Editar tarefa</DialogTitle>
        <DialogDescription className="break-all">{task._id} · versão {task.version}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mutation.isError && <Alert variant="destructive" className="mx-5 mt-4 sm:mx-6"><AlertDescription>{errorMessage(mutation.error)}</AlertDescription></Alert>}
        <form className="grid gap-4 p-5 sm:p-6" onSubmit={submit}>
          <div className="grid gap-2"><Label htmlFor="edit-task-name">Nome</Label><Input id="edit-task-name" name="name" required maxLength={20000} defaultValue={task.name} /></div>
          <div className="grid gap-2"><Label htmlFor="edit-task-instructions">Instruções</Label><Textarea id="edit-task-instructions" name="instructions" required maxLength={20000} rows={4} defaultValue={task.instructions ?? task.description ?? ''} /></div>
          <div className="grid gap-2"><Label htmlFor="edit-task-acceptance">Critérios de aceite</Label><Textarea id="edit-task-acceptance" name="acceptance" required rows={5} defaultValue={(task.acceptance ?? []).join('\n')} /><p className={hint}>Um critério por linha. Alterar os critérios reinicia o progresso deles.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="edit-task-area">Área</Label><Select name="area" defaultValue={task.area ?? areas[0]}><SelectTrigger id="edit-task-area" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{areas.map(area => <SelectItem key={area} value={area}>{area}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="edit-task-repository">Repositório</Label><Select name="repositoryId" defaultValue={task.repositoryId ?? 'unassigned'} required><SelectTrigger id="edit-task-repository" className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="unassigned" disabled>Selecione</SelectItem>{repositories.map(repository => <SelectItem key={repository.id} value={repository.id}>{repository.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="edit-task-feature">Feature</Label><Select name="featureId" defaultValue={task.featureId ?? 'none'}><SelectTrigger id="edit-task-feature" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem feature</SelectItem>{features.map(feature => <SelectItem key={feature._id} value={feature._id}>{feature.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="edit-task-type">Tipo</Label><Select name="type" defaultValue={task.type ?? 'feature'}><SelectTrigger id="edit-task-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{taskTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="edit-task-priority">Prioridade</Label><Select name="priority" defaultValue={String(task.priority ?? 2)}><SelectTrigger id="edit-task-priority" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4, 5].map(priority => <SelectItem key={priority} value={String(priority)}>{priority}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><AssigneePicker className="text-[10px] font-semibold text-[#566275] [&_select]:font-normal [&_select]:text-[#344054]" name="responsible" assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} defaultValue={task.responsible} allowEmpty={!task.responsible} /><p className={hint}>Escolha entre credenciais ativas. O responsável só pode ser trocado, não removido.</p></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2" role="group" aria-label="Cronograma planejado da tarefa">
            <div className="grid gap-2"><Label htmlFor="edit-task-start">Início planejado</Label><Input id="edit-task-start" type="date" name="plannedStartAt" defaultValue={plannedDateInput(task.plannedStartAt)} /></div>
            <div className="grid gap-2"><Label htmlFor="edit-task-due">Entrega planejada</Label><Input id="edit-task-due" type="date" name="plannedDueAt" defaultValue={plannedDateInput(task.plannedDueAt)} /><p className={hint}>Limpe os campos para remover as datas planejadas.</p></div>
          </div>
          <fieldset className="grid gap-2"><legend className="font-display text-[12px] font-bold text-[#36445a]">Dependências</legend><div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-border p-2">{tasks.filter(item => item._id !== task._id).map(item => <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-accent" key={item._id}><Checkbox checked={dependencies.includes(item._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, item._id] : current.filter(id => id !== item._id))} /><span className="min-w-0 break-words">{item.name} · {item.status}</span></label>)}</div></fieldset>
          <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>Cancelar</Button><Button type="submit" disabled={mutation.isPending || repositories.length === 0}>{mutation.isPending ? 'Salvando…' : 'Salvar tarefa'}</Button></DialogFooter>
        </form>
      </div>
    </DialogContent>
  </Dialog>;
}
