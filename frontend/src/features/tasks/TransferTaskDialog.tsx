import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { allRecords, operationId, request } from '../../api';
import type { Project, Task } from '../../api';
import { errorMessage } from '../../lib/format';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

const hint = 'text-xs leading-5 text-muted-foreground';
const actionButton = 'max-[760px]:flex-[1_1_100%]';
const routeBox = 'min-w-0 rounded-md border border-border bg-card p-3';
const routeTerm = 'mb-1 text-xs font-medium text-muted-foreground';
const routeDef = 'grid min-w-0 gap-1 break-all text-sm font-medium';
const routeSmall = 'text-xs font-normal text-muted-foreground';
const planBase = 'grid gap-3 rounded-lg border p-4';

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

  return <Dialog open onOpenChange={open => { if (!open) closeDialog(); }}>
    <DialogContent className="flex max-h-[min(90dvh,850px)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 sm:px-6"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mover tarefa</p><DialogTitle className="mt-1">Transferir tarefa</DialogTitle><DialogDescription>A prévia verifica os vínculos e mostra o histórico afetado antes de qualquer alteração.</DialogDescription></DialogHeader>
      <form className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 sm:p-6" onSubmit={submitPreview}>
      <div className="grid gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5 break-words"><strong className="text-sm font-semibold">{task.name}</strong><span className={hint}>{sourceProject?.name ?? 'Projeto atual'} · {task.status} · versão {task.version}</span></div>
      <div className="grid gap-2"><Label htmlFor="transfer-project">Projeto de destino</Label><Select value={targetProjectId} onValueChange={changeProject} disabled={busy}><SelectTrigger id="transfer-project" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{projects.map(project => <SelectItem key={project._id} value={project._id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-2"><Label htmlFor="transfer-repository">Repositório</Label><Select value={targetRepositoryId} onValueChange={changeRepository} disabled={busy || repositoryOptions.length === 0}><SelectTrigger id="transfer-repository" className="w-full"><SelectValue placeholder="Selecione um repositório" /></SelectTrigger><SelectContent>{repositoryOptions.map(repository => <SelectItem key={repository.id} value={repository.id}>{repository.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-2"><Label htmlFor="transfer-feature">Feature de destino</Label><Select value={targetFeatureId || 'none'} onValueChange={value => changeFeature(value === 'none' ? '' : value)} disabled={busy || features.isPending || features.isError}><SelectTrigger id="transfer-feature" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem feature</SelectItem>{(features.data ?? []).map(feature => <SelectItem key={feature._id} value={feature._id}>{feature.name}</SelectItem>)}</SelectContent></Select>{features.isPending && <span className={hint}>Carregando features…</span>}</div>
      {!targetRepositoryId && <Alert variant="destructive"><AlertDescription>O destino precisa ter um repositório compatível para esta tarefa.</AlertDescription></Alert>}
      {features.isError && <Alert variant="destructive"><AlertDescription>Não foi possível carregar as features: {errorMessage(features.error)}</AlertDescription></Alert>}
      {previewTransfer.isError && <Alert variant="destructive"><AlertDescription>Não foi possível gerar a prévia: {errorMessage(previewTransfer.error)}</AlertDescription></Alert>}
      {commitTransfer.isError && <Alert variant="destructive"><AlertDescription>A confirmação falhou e a prévia foi descartada. Gere uma nova prévia antes de tentar novamente: {errorMessage(commitTransfer.error)}</AlertDescription></Alert>}
      {preview && <section className={preview.eligible ? `${planBase} border-[#cce8d8] bg-[#f7fcf9]` : `${planBase} border-[#f0d6d8] bg-[#fffafa]`} aria-live="polite">
        <div className="grid gap-[3px] text-[11px] text-[#344156]"><strong>{preview.eligible ? 'Transferência disponível' : 'Transferência bloqueada'}</strong><span className="text-[9px] text-[#7b8798] [overflow-wrap:anywhere]">{preview.task.name} · v{preview.task.version}</span></div>
        <dl className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[9px] max-[760px]:grid-cols-[minmax(0,1fr)]"><div className={routeBox}><dt className={routeTerm}>Origem</dt><dd className={routeDef}>{preview.source.name}<small className={routeSmall}>{preview.source.projectId}</small></dd></div><div className={routeBox}><dt className={routeTerm}>Destino</dt><dd className={routeDef}>{preview.destination.name}<small className={routeSmall}>{preview.destination.projectId}</small></dd></div></dl>
        <div className="grid gap-[5px]"><strong className="text-[9px] font-[650] text-[#758093]">Registros que acompanham a tarefa</strong>{Object.entries(movedRecordLabels).map(([key, label]) => <div className="flex justify-between gap-2 text-[9px] text-[#637084]" key={key}><span>{label}</span><b className="text-[#37445a]">{counts[key] ?? 0}</b></div>)}</div>
        {preview.blockers.length > 0 && <ul className="grid list-disc gap-[5px] pl-[17px] text-[9px] leading-normal text-[#87434a]">{preview.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
        {preview.eligible && <label className="grid cursor-pointer items-start gap-1.5 text-[10px] leading-[1.45] font-semibold text-[#566275]"><Checkbox className="mt-px size-[14px] flex-none" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>Confirmo esta transferência e os registros apresentados na prévia.</span></label>}
      </section>}
      <DialogFooter className="sm:justify-end">
        <Button type="button" variant="outline" className={actionButton} onClick={closeDialog} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="secondary" className={actionButton} disabled={busy || !targetRepositoryId || features.isPending || features.isError}>{previewTransfer.isPending ? 'Consultando…' : 'Gerar prévia'}</Button>
        <Button type="button" className={actionButton} disabled={!preview?.eligible || !preview.planHash || !confirmed || busy} onClick={() => commitTransfer.mutate()}>{commitTransfer.isPending ? 'Transferindo…' : 'Confirmar transferência'}</Button>
      </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
