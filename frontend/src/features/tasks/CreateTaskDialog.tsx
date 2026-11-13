import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, searchTaskWorkspace } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { AssigneePicker } from '../../components/ui/AssigneePicker';
import { useAssignees } from './assignees';
import { plannedDateTime, submitNewTask } from './task-create';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';

type Feature = { _id: string; name: string; archived?: boolean };
type Repository = NonNullable<Project['repositories']>[number];

const hint = 'text-xs leading-5 text-muted-foreground';

export function CreateTaskDialog({ token, nonce, projectId, repositories, areas, defaultFeatureId, systemAdmin = false, close, onCreated }: {
  systemAdmin?: boolean;
  token: string;
  nonce: string;
  projectId: string;
  repositories: Repository[];
  areas: string[];
  defaultFeatureId: string;
  close: () => void;
  onCreated: (task: Task) => void;
}) {
  const client = useQueryClient();
  const assignees = useAssignees(token, nonce, projectId, systemAdmin);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [dependencySearch, setDependencySearch] = useState('');
  const defaultArea = areas.includes('frontend') ? 'frontend' : areas[0] ?? '';
  const features = useQuery({
    queryKey: ['project-features', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId, archived: false })
  });
  const dependencySuggestions = useInfiniteQuery({
    queryKey: ['task-dependency-suggestions', nonce, projectId, dependencySearch.trim()],
    enabled: Boolean(token && nonce && projectId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => searchTaskWorkspace(token, {
      projectId, quick: dependencySearch.trim() ? { search: dependencySearch.trim() } : {},
      sort: 'updated', limit: 25, ...(pageParam ? { after: pageParam } : {})
    }),
    getNextPageParam: page => page.next ?? undefined,
    staleTime: 15_000
  });
  const dependencyTasks = dependencySuggestions.data?.pages.flatMap(page => page.items) ?? [];
  const create = useMutation({
    mutationFn: (draft: Parameters<typeof submitNewTask>[2]) => submitNewTask(token, projectId, draft),
    onSuccess: async task => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['project-sync-report', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['project-dashboard', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['portfolio-dashboard', nonce] }),
        client.invalidateQueries({ queryKey: ['admin-projects', nonce] })
      ]);
      onCreated(task);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const plannedStartAt = String(form.get('plannedStartAt') ?? '');
    const plannedDueAt = String(form.get('plannedDueAt') ?? '');
    const dueControl = event.currentTarget.elements.namedItem('plannedDueAt') as HTMLInputElement;
    if (plannedStartAt && plannedDueAt && plannedStartAt > plannedDueAt) {
      dueControl.setCustomValidity('A entrega planejada precisa ser no mesmo dia ou depois do início.');
      dueControl.reportValidity();
      return;
    }
    dueControl.setCustomValidity('');
    create.mutate({
      name: String(form.get('name') ?? ''),
      instructions: String(form.get('instructions') ?? ''),
      acceptanceText: String(form.get('acceptance') ?? ''),
      area: String(form.get('area') ?? defaultArea),
      repositoryId: String(form.get('repositoryId') ?? ''),
      featureId: String(form.get('featureId') ?? '') === 'none' ? '' : String(form.get('featureId') ?? ''),
      type: String(form.get('type') ?? 'feature') as Parameters<typeof submitNewTask>[2]['type'],
      priority: Number(form.get('priority') ?? 2),
      dependencies,
      responsible: String(form.get('responsible') ?? ''),
      plannedStartAt: plannedDateTime(plannedStartAt) ?? undefined,
      plannedDueAt: plannedDateTime(plannedDueAt) ?? undefined
    });
  }

  return <Dialog open onOpenChange={open => { if (!open && !create.isPending) close(); }}>
    <DialogContent className="flex max-h-[min(90dvh,850px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Nova task</p>
        <DialogTitle className="mt-1">Criar tarefa</DialogTitle>
        <DialogDescription>Depois de criar, abra Conversas e selecione esta tarefa ao iniciar o chat.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-3 px-5 pt-4 sm:px-6">
          {repositories.length === 0 && <Alert variant="destructive"><AlertDescription>O projeto não possui repositório disponível para associar à task.</AlertDescription></Alert>}
          {features.isError && <Alert variant="destructive"><AlertDescription>Não foi possível carregar as features: {errorMessage(features.error)}</AlertDescription></Alert>}
          {create.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(create.error)}</AlertDescription></Alert>}
        </div>
        <form className="grid gap-4 p-5 sm:p-6" onSubmit={submit}>
          <div className="grid gap-2"><Label htmlFor="create-task-name">Nome</Label><Input id="create-task-name" name="name" required maxLength={20000} autoFocus placeholder="Ex.: Adicionar exportação CSV" /></div>
          <div className="grid gap-2"><Label htmlFor="create-task-instructions">Instruções</Label><Textarea id="create-task-instructions" name="instructions" required maxLength={20000} rows={4} placeholder="Descreva o objetivo, limites e contexto para quem assumir a task." /></div>
          <div className="grid gap-2"><Label htmlFor="create-task-acceptance">Critérios de aceite</Label><Textarea id="create-task-acceptance" name="acceptance" required rows={4} placeholder={'Um critério por linha\nEx.: O botão exporta os filtros aplicados.'} /><p className={hint}>Informe pelo menos um critério; cada linha vira um item separado.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="create-task-area">Área</Label><Select name="area" defaultValue={defaultArea || 'none'} required><SelectTrigger id="create-task-area" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{areas.length ? areas.map(area => <SelectItem value={area} key={area}>{area === 'backend' ? 'Backend' : area === 'frontend' ? 'Frontend' : area === 'outro' ? 'Outro' : area}</SelectItem>) : <SelectItem value="none">Sem área</SelectItem>}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="create-task-repository">Repositório</Label><Select name="repositoryId" defaultValue={repositories.length === 1 ? repositories[0].id : 'none'} required><SelectTrigger id="create-task-repository" className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="none" disabled>Selecione</SelectItem>{repositories.map(repository => <SelectItem key={repository.id} value={repository.id}>{repository.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="create-task-feature">Feature</Label><Select name="featureId" defaultValue={defaultFeatureId || 'none'}><SelectTrigger id="create-task-feature" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem feature</SelectItem>{(features.data ?? []).map(feature => <SelectItem key={feature._id} value={feature._id}>{feature.name}</SelectItem>)}</SelectContent></Select>{features.isPending && <p className={hint}>Carregando features…</p>}</div>
            <div className="grid gap-2"><Label htmlFor="create-task-type">Tipo</Label><Select name="type" defaultValue="feature"><SelectTrigger id="create-task-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'].map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="create-task-priority">Prioridade</Label><Select name="priority" defaultValue="2"><SelectTrigger id="create-task-priority" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4, 5].map(priority => <SelectItem key={priority} value={String(priority)}>{priority}</SelectItem>)}</SelectContent></Select></div>
            <AssigneePicker className="text-[10px] font-semibold text-[#566275] [&_select]:font-normal [&_select]:text-[#344054]" name="responsible" label="Responsável (opcional)" assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2" role="group" aria-label="Cronograma planejado da tarefa">
            <div className="grid content-start gap-2"><Label htmlFor="create-task-start">Início planejado</Label><Input id="create-task-start" type="date" name="plannedStartAt" /></div>
            <div className="grid content-start gap-2"><Label htmlFor="create-task-due">Entrega planejada</Label><Input id="create-task-due" type="date" name="plannedDueAt" /><p className={hint}>Datas opcionais para acompanhar o cronograma.</p></div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="font-display text-[12px] font-bold text-[#36445a]">Dependências (opcional)</legend>
            <p className={hint}>Marque somente as tasks que precisam terminar antes desta.</p>
            <Input type="search" value={dependencySearch} onChange={event => setDependencySearch(event.target.value)} placeholder="Buscar tarefas por nome, ID ou responsável" aria-label="Buscar tarefas para dependência" />
            {dependencySuggestions.isError && <Alert variant="destructive"><AlertDescription>Não foi possível carregar sugestões de dependência.</AlertDescription></Alert>}
            {dependencySuggestions.isPending && <p className="text-[11px] text-muted-foreground" role="status">Carregando sugestões…</p>}
            {dependencyTasks.length ? <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-border p-2">{dependencyTasks.map(task => <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-accent" key={task._id}><Checkbox name="dependencies" value={task._id} checked={dependencies.includes(task._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, task._id] : current.filter(id => id !== task._id))} /><span className="min-w-0 break-words">{task.name} · {task.status}</span></label>)}</div> : !dependencySuggestions.isPending && <p className="text-[11px] text-muted-foreground">Não há tasks correspondentes para adicionar como dependência.</p>}
            {dependencySuggestions.hasNextPage && <Button type="button" variant="link" className="justify-self-start px-0" disabled={dependencySuggestions.isFetchingNextPage} onClick={() => void dependencySuggestions.fetchNextPage()}>{dependencySuggestions.isFetchingNextPage ? 'Carregando…' : 'Carregar mais sugestões'}</Button>}
          </fieldset>
          <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={create.isPending}>Cancelar</Button><Button type="submit" disabled={create.isPending || features.isPending || repositories.length === 0 || features.isError}>{create.isPending ? 'Criando…' : 'Criar tarefa'}</Button></DialogFooter>
        </form>
      </div>
    </DialogContent>
  </Dialog>;
}
