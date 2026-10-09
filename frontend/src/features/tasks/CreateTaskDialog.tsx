import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, searchTaskWorkspace } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { AssigneePicker } from '../../components/ui/AssigneePicker';
import { useAssignees } from './assignees';
import { submitNewTask } from './task-create';
import { buttonPrimary, buttonSecondary, eyebrow, notice } from '../../components/ui/classes';

type Feature = { _id: string; name: string; archived?: boolean };
type Repository = NonNullable<Project['repositories']>[number];

const dialogBox = 'm-auto max-h-[min(850px,calc(100dvh-28px))] w-[min(calc(100%-28px),720px)] overflow-auto rounded-ui-lg border border-[#dfe4ed] bg-white p-0 text-[#455164] shadow-[0_24px_70px_#18223040] open:block backdrop:bg-[#18203388] backdrop:backdrop-blur-[3px]';
const dialogHeader = 'flex items-start justify-between gap-4 border-b border-b-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const iconButton = 'inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const dialogNotice = 'mx-[22px] mt-[13px]';
const field = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const control = 'w-full resize-y rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054] outline-none';
const hint = 'text-[9px] leading-normal font-normal text-[#8a94a4]';

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [dependencySearch, setDependencySearch] = useState('');
  const defaultArea = areas.includes('frontend') ? 'frontend' : areas[0] ?? '';
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
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
        client.invalidateQueries({ queryKey: ['admin-projects', nonce] })
      ]);
      onCreated(task);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      name: String(form.get('name') ?? ''),
      instructions: String(form.get('instructions') ?? ''),
      acceptanceText: String(form.get('acceptance') ?? ''),
      area: String(form.get('area') ?? defaultArea),
      repositoryId: String(form.get('repositoryId') ?? ''),
      featureId: String(form.get('featureId') ?? ''),
      type: String(form.get('type') ?? 'feature') as Parameters<typeof submitNewTask>[2]['type'],
      priority: Number(form.get('priority') ?? 2),
      dependencies,
      responsible: String(form.get('responsible') ?? '')
    });
  }

  return <dialog ref={dialogRef} className={dialogBox} aria-labelledby="create-task-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className={dialogHeader}><div><p className={eyebrow}>NOVA TASK</p><h2 id="create-task-title" className="mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]">Criar tarefa</h2><p className="text-[10px] text-muted-strong">Depois de criar, abra Conversas, selecione esta task ao iniciar o chat e explique o que precisa. A feature aparece identificada na conversa.</p></div><button type="button" className={iconButton} onClick={close} aria-label="Fechar">×</button></header>
    {repositories.length === 0 && <div className={`${notice.error} ${dialogNotice}`}>O projeto não possui repositório disponível para associar à task.</div>}
    {features.isError && <div className={`${notice.error} ${dialogNotice}`}>Não foi possível carregar as features: {errorMessage(features.error)}</div>}
    {create.isError && <div className={`${notice.error} ${dialogNotice}`} role="alert">{errorMessage(create.error)}</div>}
    <form className="grid gap-[13px] px-[22px] pt-4 pb-5 max-[480px]:px-4 max-[480px]:pt-[13px] max-[480px]:pb-4" onSubmit={submit}>
      <label className={field}>Nome<input className={control} name="name" required maxLength={20000} autoFocus placeholder="Ex.: Adicionar exportação CSV" /></label>
      <label className={field}>Instruções<textarea className={control} name="instructions" required maxLength={20000} rows={4} placeholder="Descreva o objetivo, limites e contexto para quem assumir a task." /></label>
      <label className={field}>Critérios de aceite<textarea className={control} name="acceptance" required rows={4} placeholder={'Um critério por linha\nEx.: O botão exporta os filtros aplicados.'} /><small className={hint}>Informe pelo menos um critério; cada linha vira um item separado.</small></label>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 max-[480px]:grid-cols-[1fr]">
        <label className={field}>Área<select className={control} name="area" defaultValue={defaultArea} required>{areas.map(area => <option value={area} key={area}>{area === 'backend' ? 'Backend' : area === 'frontend' ? 'Frontend' : area === 'outro' ? 'Outro' : area}</option>)}</select></label>
        <label className={field}>Repositório<select className={control} name="repositoryId" required defaultValue={repositories.length === 1 ? repositories[0].id : ''}><option value="" disabled>Selecione</option>{repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select></label>
        <label className={field}>Feature<select className={control} name="featureId" defaultValue={defaultFeatureId}><option value="">Sem feature</option>{(features.data ?? []).map(feature => <option key={feature._id} value={feature._id}>{feature.name}</option>)}</select>{features.isPending && <small className={hint}>Carregando features…</small>}</label>
        <label className={field}>Tipo<select className={control} name="type" defaultValue="feature">{['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'].map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className={field}>Prioridade<select className={control} name="priority" defaultValue="2">{[0, 1, 2, 3, 4, 5].map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></label>
        <AssigneePicker className="[&_select]:text-[#344054]" name="responsible" label="Responsável (opcional)" assignees={assignees.data ?? []} isPending={assignees.isPending} isError={assignees.isError} />
      </div>
      <div className="grid gap-[7px] text-[10px] text-[#566275]" role="group" aria-labelledby="task-dependencies-label">
        <strong id="task-dependencies-label" className="font-semibold">Dependências (opcional)</strong>
        <small className={hint}>Marque somente as tasks que precisam terminar antes desta.</small>
        <input className={control} value={dependencySearch} onChange={event => setDependencySearch(event.target.value)} placeholder="Buscar tarefas por nome, ID ou responsável" aria-label="Buscar tarefas para dependência" />
        {dependencySuggestions.isError && <p className="text-tone-red">Não foi possível carregar sugestões de dependência.</p>}
        {dependencySuggestions.isPending && <p className="text-muted-strong">Carregando sugestões…</p>}
        {dependencyTasks.length ? <div className="grid max-h-[150px] gap-1 overflow-y-auto rounded-[7px] border border-[#e1e5ed] p-[7px]">{dependencyTasks.map(task => <label className="flex cursor-pointer items-center gap-2 px-0.5 py-1 text-[10px] font-normal text-[#566275]" key={task._id}><input className="size-[14px] flex-none rounded-[7px] border border-[#e1e5ed] bg-white p-0 text-[#344054] accent-accent outline-none" type="checkbox" name="dependencies" value={task._id} checked={dependencies.includes(task._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, task._id] : current.filter(id => id !== task._id))} /><span>{task.name} · {task.status}</span></label>)}</div> : !dependencySuggestions.isPending && <p className="text-muted-strong">Não há tasks correspondentes para adicionar como dependência.</p>}
        {dependencySuggestions.hasNextPage && <button type="button" className="justify-self-start text-[10px] font-semibold text-[#5968df]" disabled={dependencySuggestions.isFetchingNextPage} onClick={() => void dependencySuggestions.fetchNextPage()}>{dependencySuggestions.isFetchingNextPage ? 'Carregando…' : 'Carregar mais sugestões'}</button>}
      </div>
      <div className="mt-1 flex items-center justify-end gap-2"><button type="button" className={buttonSecondary} onClick={close} disabled={create.isPending}>Cancelar</button><button className={buttonPrimary} disabled={create.isPending || features.isPending || repositories.length === 0 || features.isError}>{create.isPending ? 'Criando…' : 'Criar tarefa'}</button></div>
    </form>
  </dialog>;
}
