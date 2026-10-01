import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { submitNewTask } from './task-create';

type Feature = { _id: string; name: string; archived?: boolean };
type Repository = NonNullable<Project['repositories']>[number];

export function CreateTaskDialog({ token, nonce, projectId, repositories, tasks, defaultFeatureId, close, onCreated }: {
  token: string;
  nonce: string;
  projectId: string;
  repositories: Repository[];
  tasks: Task[];
  defaultFeatureId: string;
  close: () => void;
  onCreated: (task: Task) => void;
}) {
  const client = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dependencies, setDependencies] = useState<string[]>([]);
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
      area: String(form.get('area') ?? 'frontend') as 'backend' | 'frontend' | 'outro',
      repositoryId: String(form.get('repositoryId') ?? ''),
      featureId: String(form.get('featureId') ?? ''),
      type: String(form.get('type') ?? 'feature') as Parameters<typeof submitNewTask>[2]['type'],
      priority: Number(form.get('priority') ?? 2),
      dependencies,
      responsible: String(form.get('responsible') ?? '')
    });
  }

  return <dialog ref={dialogRef} className="dialog create-task-dialog" aria-labelledby="create-task-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">NOVA TASK</p><h2 id="create-task-title">Criar tarefa</h2><p className="muted-text">Depois de criar, abra Conversas, selecione esta task ao iniciar o chat e explique o que precisa. A feature aparece identificada na conversa.</p></div><button type="button" className="icon-button" onClick={close} aria-label="Fechar">×</button></header>
    {repositories.length === 0 && <div className="notice error">O projeto não possui repositório disponível para associar à task.</div>}
    {features.isError && <div className="notice error">Não foi possível carregar as features: {errorMessage(features.error)}</div>}
    {create.isError && <div className="notice error" role="alert">{errorMessage(create.error)}</div>}
    <form className="stack-form create-task-form" onSubmit={submit}>
      <label>Nome<input name="name" required maxLength={20000} autoFocus placeholder="Ex.: Adicionar exportação CSV" /></label>
      <label>Instruções<textarea name="instructions" required maxLength={20000} rows={4} placeholder="Descreva o objetivo, limites e contexto para quem assumir a task." /></label>
      <label>Critérios de aceite<textarea name="acceptance" required rows={4} placeholder={'Um critério por linha\nEx.: O botão exporta os filtros aplicados.'} /><small>Informe pelo menos um critério; cada linha vira um item separado.</small></label>
      <div className="create-task-fields">
        <label>Área<select name="area" defaultValue="frontend"><option value="backend">Backend</option><option value="frontend">Frontend</option><option value="outro">Outro</option></select></label>
        <label>Repositório<select name="repositoryId" required defaultValue={repositories.length === 1 ? repositories[0].id : ''}><option value="" disabled>Selecione</option>{repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select></label>
        <label>Feature<select name="featureId" defaultValue={defaultFeatureId}><option value="">Sem feature</option>{(features.data ?? []).map(feature => <option key={feature._id} value={feature._id}>{feature.name}</option>)}</select>{features.isPending && <small>Carregando features…</small>}</label>
        <label>Tipo<select name="type" defaultValue="feature">{['feature', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'revert'].map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label>Prioridade<select name="priority" defaultValue="2">{[0, 1, 2, 3, 4, 5].map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></label>
        <label>Responsável (opcional)<input name="responsible" maxLength={320} placeholder="Nome ou e-mail" /></label>
      </div>
      <div className="dependency-picker" role="group" aria-labelledby="task-dependencies-label">
        <strong id="task-dependencies-label">Dependências (opcional)</strong>
        <small>Marque somente as tasks que precisam terminar antes desta.</small>
        {tasks.length ? <div className="dependency-options">{tasks.map(task => <label className="dependency-option" key={task._id}><input type="checkbox" name="dependencies" value={task._id} checked={dependencies.includes(task._id)} onChange={event => setDependencies(current => event.target.checked ? [...current, task._id] : current.filter(id => id !== task._id))} /><span>{task.name} · {task.status}</span></label>)}</div> : <p className="muted-text">Não há tasks disponíveis para adicionar como dependência.</p>}
      </div>
      <div className="button-row end-row"><button type="button" className="button secondary" onClick={close} disabled={create.isPending}>Cancelar</button><button className="button primary" disabled={create.isPending || features.isPending || repositories.length === 0 || features.isError}>{create.isPending ? 'Criando…' : 'Criar tarefa'}</button></div>
    </form>
  </dialog>;
}
