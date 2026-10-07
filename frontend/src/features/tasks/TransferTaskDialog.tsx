import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { buttonPrimary, buttonSecondary, eyebrow, notice } from '../../components/ui/classes';

const dialogBox = 'm-auto max-h-[min(850px,calc(100dvh-28px))] w-[min(calc(100%-28px),640px)] overflow-auto rounded-ui-lg border border-[#dfe4ed] bg-white p-0 text-[#455164] shadow-[0_24px_70px_#18223040] open:block backdrop:bg-[#18203388] backdrop:backdrop-blur-[3px]';
const dialogHeader = 'flex items-start justify-between gap-4 border-b border-b-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const iconButton = 'inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const field = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const control = 'w-full resize-y rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054] outline-none';
const hint = 'text-[9px] leading-normal font-normal text-[#8a94a4]';
const actionButton = 'max-[760px]:flex-[1_1_100%]';
const routeBox = 'min-w-0 rounded-[7px] border border-[#e8ebf1] bg-white p-2';
const routeTerm = 'mb-[5px] text-[9px] font-[650] text-[#758093]';
const routeDef = 'grid min-w-0 gap-[3px] text-[10px] font-[650] text-[#3e4b60] [overflow-wrap:anywhere]';
const routeSmall = 'text-[9px] leading-normal font-normal text-[#8a94a4] [overflow-wrap:anywhere]';
const planBase = 'grid gap-[11px] rounded-[9px] border p-3';

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

  return <dialog ref={dialogRef} className={dialogBox} aria-labelledby="transfer-task-title" onCancel={event => { event.preventDefault(); closeDialog(); }}>
    <header className={dialogHeader}><div><p className={eyebrow}>MOVER TAREFA</p><h2 id="transfer-task-title" className="mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]">Transferir tarefa</h2><p className="text-[10px] text-muted-strong">A prévia verifica os vínculos e mostra o histórico afetado antes de qualquer alteração.</p></div><button type="button" className={iconButton} onClick={closeDialog} disabled={busy} aria-label="Fechar">×</button></header>
    <form className="grid gap-[11px] px-[22px] pt-4 pb-5 max-[480px]:px-4 max-[480px]:pt-[13px] max-[480px]:pb-4" onSubmit={submitPreview}>
      <div className="grid gap-1 rounded-[8px] border border-[#e6e9f0] bg-[#fafbfe] px-3 py-2.5 [overflow-wrap:anywhere]"><strong className="text-[12px] text-[#344156]">{task.name}</strong><small className={hint}>{sourceProject?.name ?? 'Projeto atual'} · {task.status} · versão {task.version}</small></div>
      <label className={field}>Projeto de destino<select className={control} value={targetProjectId} onChange={event => changeProject(event.target.value)} required disabled={busy}>
        {projects.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}
      </select></label>
      <label className={field}>Repositório<select className={control} value={targetRepositoryId} onChange={event => changeRepository(event.target.value)} required disabled={busy || repositoryOptions.length === 0}>
        <option value="" disabled>Selecione um repositório</option>
        {repositoryOptions.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
      </select></label>
      <label className={field}>Feature de destino<select className={control} value={targetFeatureId} onChange={event => changeFeature(event.target.value)} disabled={busy || features.isPending || features.isError}>
        <option value="">Sem feature</option>
        {(features.data ?? []).map(feature => <option key={feature._id} value={feature._id}>{feature.name}</option>)}
      </select>{features.isPending && <small className={hint}>Carregando features…</small>}</label>
      {!targetRepositoryId && <p className={notice.error}>O destino precisa ter um repositório compatível para esta tarefa.</p>}
      {features.isError && <p className={notice.error}>Não foi possível carregar as features: {errorMessage(features.error)}</p>}
      {previewTransfer.isError && <p className={notice.error} role="alert">Não foi possível gerar a prévia: {errorMessage(previewTransfer.error)}</p>}
      {commitTransfer.isError && <p className={notice.error} role="alert">A confirmação falhou e a prévia foi descartada. Gere uma nova prévia antes de tentar novamente: {errorMessage(commitTransfer.error)}</p>}
      {preview && <section className={preview.eligible ? `${planBase} border-[#cce8d8] bg-[#f7fcf9]` : `${planBase} border-[#f0d6d8] bg-[#fffafa]`} aria-live="polite">
        <div className="grid gap-[3px] text-[11px] text-[#344156]"><strong>{preview.eligible ? 'Transferência disponível' : 'Transferência bloqueada'}</strong><span className="text-[9px] text-[#7b8798] [overflow-wrap:anywhere]">{preview.task.name} · v{preview.task.version}</span></div>
        <dl className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[9px] max-[760px]:grid-cols-[minmax(0,1fr)]"><div className={routeBox}><dt className={routeTerm}>Origem</dt><dd className={routeDef}>{preview.source.name}<small className={routeSmall}>{preview.source.projectId}</small></dd></div><div className={routeBox}><dt className={routeTerm}>Destino</dt><dd className={routeDef}>{preview.destination.name}<small className={routeSmall}>{preview.destination.projectId}</small></dd></div></dl>
        <div className="grid gap-[5px]"><strong className="text-[9px] font-[650] text-[#758093]">Registros que acompanham a tarefa</strong>{Object.entries(movedRecordLabels).map(([key, label]) => <div className="flex justify-between gap-2 text-[9px] text-[#637084]" key={key}><span>{label}</span><b className="text-[#37445a]">{counts[key] ?? 0}</b></div>)}</div>
        {preview.blockers.length > 0 && <ul className="grid list-disc gap-[5px] pl-[17px] text-[9px] leading-normal text-[#87434a]">{preview.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
        {preview.eligible && <label className="grid cursor-pointer items-start gap-1.5 text-[10px] leading-[1.45] font-semibold text-[#566275]"><input className="mt-px size-[14px] flex-none resize-y rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[#344054] accent-accent outline-none" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>Confirmo esta transferência e os registros apresentados na prévia.</span></label>}
      </section>}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={`${buttonSecondary} ${actionButton}`} onClick={closeDialog} disabled={busy}>Cancelar</button>
        <button type="submit" className={`${buttonSecondary} ${actionButton}`} disabled={busy || !targetRepositoryId || features.isPending || features.isError}>{previewTransfer.isPending ? 'Consultando…' : 'Gerar prévia'}</button>
        <button type="button" className={`${buttonPrimary} ${actionButton}`} disabled={!preview?.eligible || !preview.planHash || !confirmed || busy} onClick={() => commitTransfer.mutate()}>{commitTransfer.isPending ? 'Transferindo…' : 'Confirmar transferência'}</button>
      </div>
    </form>
  </dialog>;
}
