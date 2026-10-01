import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';

type Feature = { _id: string; name: string };
type TransferPlan = {
  eligible: boolean;
  blockers: string[];
  planHash: string | null;
  source: { projectId: string; name: string };
  destination: { projectId: string; name: string };
  task: { taskId: string; name: string; version: number; status: string; repositoryId: string; featureId: string | null };
  moveCounts: Record<string, number>;
};
type TransferResult = { task: Task; sourceProjectId: string; targetProjectId: string };

const movedRecordLabels: Record<string, string> = {
  messages: 'Mensagens da tarefa', documents: 'Documentos', diffs: 'Diffs', jobs: 'Automações',
  executions: 'Execuções', conversations: 'Conversas', conversationMessages: 'Mensagens de conversa',
  actionProposals: 'Propostas', historyEvents: 'Eventos de histórico'
};

export function TransferTaskDialog({ token, nonce, projectId, task, projects, close, onTransferred }: {
  token: string;
  nonce: string;
  projectId: string;
  task: Task;
  projects: Project[];
  close: () => void;
  onTransferred: (result: TransferResult, targetProjectId: string) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sourceProject = projects.find(project => project._id === projectId);
  const sourceRepositoryId = task.repositoryId ?? sourceProject?.repositories?.[0]?.id ?? '';
  const [targetProjectId, setTargetProjectId] = useState(projectId);
  const [targetRepositoryId, setTargetRepositoryId] = useState(sourceRepositoryId);
  const [targetFeatureId, setTargetFeatureId] = useState('');
  const [preview, setPreview] = useState<TransferPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const targetProject = projects.find(project => project._id === targetProjectId);
  const sameProject = targetProjectId === projectId;
  const repositoryOptions = (targetProject?.repositories ?? []).filter(repository => !sameProject || !task.repositoryId || repository.id === task.repositoryId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const features = useQuery({
    queryKey: ['project-features', nonce, targetProjectId],
    enabled: Boolean(token && nonce && targetProjectId),
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId: targetProjectId, archived: false })
  });
  const previewTransfer = useMutation({
    mutationFn: () => request<TransferPlan>(token, '/admin/tasks/transfer/preview', { body: {
      projectId, taskId: task._id, version: task.version, targetProjectId,
      targetRepositoryId, targetFeatureId: targetFeatureId || null
    } }),
    onSuccess: plan => { setPreview(plan); setConfirmed(false); }
  });
  const commitTransfer = useMutation({
    mutationFn: () => {
      if (!preview?.eligible || !preview.planHash) throw new Error('Gere uma prévia válida antes de confirmar a transferência.');
      return request<TransferResult>(token, '/admin/tasks/transfer', { body: {
        projectId, taskId: task._id, version: preview.task.version, targetProjectId,
        targetRepositoryId, targetFeatureId: targetFeatureId || null,
        planHash: preview.planHash, confirm: true, operationId: operationId()
      } });
    },
    onSuccess: (result) => onTransferred(result, targetProjectId),
    onError: () => { setPreview(null); setConfirmed(false); }
  });

  function clearPreview() {
    setPreview(null);
    setConfirmed(false);
    previewTransfer.reset();
    commitTransfer.reset();
  }

  function changeProject(nextProjectId: string) {
    const nextProject = projects.find(project => project._id === nextProjectId);
    setTargetProjectId(nextProjectId);
    setTargetRepositoryId(nextProjectId === projectId ? sourceRepositoryId : nextProject?.repositories?.[0]?.id ?? '');
    setTargetFeatureId('');
    clearPreview();
  }

  function changeRepository(nextRepositoryId: string) {
    setTargetRepositoryId(nextRepositoryId);
    clearPreview();
  }

  function changeFeature(nextFeatureId: string) {
    setTargetFeatureId(nextFeatureId);
    clearPreview();
  }

  function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetRepositoryId || features.isPending || features.isError) return;
    clearPreview();
    previewTransfer.mutate();
  }

  const busy = previewTransfer.isPending || commitTransfer.isPending;
  const closeDialog = () => { if (!busy) close(); };
  const counts = preview?.moveCounts ?? {};

  return <dialog ref={dialogRef} className="dialog create-task-dialog transfer-task-dialog" aria-labelledby="transfer-task-title" onCancel={event => { event.preventDefault(); closeDialog(); }}>
    <header className="dialog-header"><div><p className="eyebrow">MOVER TAREFA</p><h2 id="transfer-task-title">Transferir tarefa</h2><p className="muted-text">A prévia verifica os vínculos e mostra o histórico afetado antes de qualquer alteração.</p></div><button type="button" className="icon-button" onClick={closeDialog} disabled={busy} aria-label="Fechar">×</button></header>
    <form className="stack-form create-task-form transfer-task-form" onSubmit={submitPreview}>
      <div className="transfer-task-target"><strong>{task.name}</strong><small>{sourceProject?.name ?? 'Projeto atual'} · {task.status} · versão {task.version}</small></div>
      <label>Projeto de destino<select value={targetProjectId} onChange={event => changeProject(event.target.value)} required disabled={busy}>
        {projects.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
      </select></label>
      <label>Repositório<select value={targetRepositoryId} onChange={event => changeRepository(event.target.value)} required disabled={busy || repositoryOptions.length === 0}>
        <option value="" disabled>Selecione um repositório</option>
        {repositoryOptions.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
      </select></label>
      <label>Feature de destino<select value={targetFeatureId} onChange={event => changeFeature(event.target.value)} disabled={busy || features.isPending || features.isError}>
        <option value="">Sem feature</option>
        {(features.data ?? []).map(feature => <option key={feature._id} value={feature._id}>{feature.name}</option>)}
      </select>{features.isPending && <small>Carregando features…</small>}</label>
      {!targetRepositoryId && <p className="notice error">O destino precisa ter um repositório compatível para esta tarefa.</p>}
      {features.isError && <p className="notice error">Não foi possível carregar as features: {errorMessage(features.error)}</p>}
      {previewTransfer.isError && <p className="notice error" role="alert">Não foi possível gerar a prévia: {errorMessage(previewTransfer.error)}</p>}
      {commitTransfer.isError && <p className="notice error" role="alert">A confirmação falhou e a prévia foi descartada. Gere uma nova prévia antes de tentar novamente: {errorMessage(commitTransfer.error)}</p>}
      {preview && <section className={preview.eligible ? 'transfer-plan eligible' : 'transfer-plan blocked'} aria-live="polite">
        <div className="transfer-plan-heading"><strong>{preview.eligible ? 'Transferência disponível' : 'Transferência bloqueada'}</strong><span>{preview.task.name} · v{preview.task.version}</span></div>
        <dl className="transfer-plan-route"><div><dt>Origem</dt><dd>{preview.source.name}<small>{preview.source.projectId}</small></dd></div><div><dt>Destino</dt><dd>{preview.destination.name}<small>{preview.destination.projectId}</small></dd></div></dl>
        <div className="transfer-plan-counts"><strong>Registros que acompanham a tarefa</strong>{Object.entries(movedRecordLabels).map(([key, label]) => <div key={key}><span>{label}</span><b>{counts[key] ?? 0}</b></div>)}</div>
        {preview.blockers.length > 0 && <ul className="transfer-plan-blockers">{preview.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
        {preview.eligible && <label className="transfer-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>Confirmo esta transferência e os registros apresentados na prévia.</span></label>}
      </section>}
      <div className="button-row end-row transfer-task-actions">
        <button type="button" className="button secondary" onClick={closeDialog} disabled={busy}>Cancelar</button>
        <button type="submit" className="button secondary" disabled={busy || !targetRepositoryId || features.isPending || features.isError}>{previewTransfer.isPending ? 'Consultando…' : 'Gerar prévia'}</button>
        <button type="button" className="button primary" disabled={!preview?.eligible || !preview.planHash || !confirmed || busy} onClick={() => commitTransfer.mutate()}>{commitTransfer.isPending ? 'Transferindo…' : 'Confirmar transferência'}</button>
      </div>
    </form>
  </dialog>;
}
