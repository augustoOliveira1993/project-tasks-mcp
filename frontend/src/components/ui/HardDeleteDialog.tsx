import { useEffect, useRef, useState } from 'react';
import { buttonDanger, buttonSecondary, errorBox } from './classes';

export type HardDeleteTarget = {
  kind: 'project' | 'task';
  id: string;
  projectId?: string;
  name: string;
  projectName?: string;
  status?: string;
  responsible?: string;
};

type HardDeleteDialogProps = {
  target: HardDeleteTarget | null;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function matchesHardDeleteConfirmation(input: string, target: Pick<HardDeleteTarget, 'id' | 'name'>) {
  const normalized = input.trim().toLocaleLowerCase('pt-BR');
  return normalized !== '' && (normalized === target.name.trim().toLocaleLowerCase('pt-BR') || normalized === target.id.toLocaleLowerCase('pt-BR'));
}

export function HardDeleteDialog({ target, busy, error, onClose, onConfirm }: HardDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const confirmationMatches = target ? matchesHardDeleteConfirmation(confirmation, target) : false;

  useEffect(() => {
    setConfirmation('');
    const dialog = dialogRef.current;
    if (target && dialog && !dialog.open) dialog.showModal();
    if (!target && dialog?.open) dialog.close();
    return () => { if (dialog?.open) dialog.close(); };
  }, [target]);

  function close() {
    if (!busy) onClose();
  }

  return <dialog ref={dialogRef} className="m-auto max-h-[min(760px,calc(100dvh-28px))] w-[min(100%-28px,540px)] flex-col overflow-auto rounded-ui-lg border border-[#ead4d6] bg-white p-0 text-[#455164] shadow-[0_24px_70px_#18223040] open:flex backdrop:bg-[#18203388] backdrop:backdrop-blur-[3px] max-[760px]:max-h-[calc(100dvh-20px)] max-[760px]:w-[calc(100vw-20px)] max-[760px]:rounded-xl" aria-labelledby="hard-delete-title" aria-describedby="hard-delete-impact" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    {target && <>
      <header className="flex items-start justify-between gap-3 border-b border-[#f1e4e5] px-[22px] pt-5 pb-3.5 max-[760px]:px-[15px] max-[760px]:pt-4 max-[760px]:pb-3"><div><p className="mb-1.5 font-display text-[9px] leading-[normal] font-bold tracking-[.11em] text-[#a44850]">AÇÃO IRREVERSÍVEL</p><h2 className="m-0 font-display text-[16px] leading-[normal] font-[750] text-[#392f34]" id="hard-delete-title">Excluir {target.kind === 'project' ? 'projeto' : 'tarefa'} definitivamente?</h2></div><button type="button" className="inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]" aria-label="Fechar confirmação" disabled={busy} onClick={close}>×</button></header>
      <div className="grid gap-[13px] overflow-auto px-[22px] pt-4 pb-[18px] max-[760px]:gap-2.5 max-[760px]:px-[15px] max-[760px]:py-[13px]">
        <div className="grid gap-1 rounded-[8px] border border-[#eceef2] bg-[#fafbfc] px-3 py-[11px]"><strong className="text-ui-sm text-[#3b4657] wrap-anywhere">{target.name}</strong><code className="font-code text-[9px] leading-normal text-[#778294] wrap-anywhere">{target.id}</code>{target.kind === 'task' && <small className="text-[9px] leading-normal text-[#7d8999]">Projeto: {target.projectName || '—'} · Status: {target.status || '—'}{target.responsible ? ` · Responsável: ${target.responsible}` : ''}</small>}</div>
        <section id="hard-delete-impact" className="grid gap-[5px] rounded-[5px_8px_8px_5px] border-l-[3px] border-[#d8858b] bg-[#fff7f7] px-3 py-[11px]">
          <strong className="text-[10px] text-[#77383e]">O que será removido</strong>
          {target.kind === 'project'
            ? <p className="m-0 text-[10px] leading-[1.55] text-[#785c60]">O projeto, repositórios exclusivos, funcionalidades, tarefas e os dados associados: mensagens, documentos Markdown, diffs, eventos, execuções e automações. Credenciais humanas compartilhadas com outros projetos serão preservadas.</p>
            : <p className="m-0 text-[10px] leading-[1.55] text-[#785c60]">A tarefa, seu histórico de execução, mensagens, documentos Markdown e diffs. Dependências em outras tarefas serão limpas; o projeto e as tarefas irmãs permanecem.</p>}
          <p className="m-0 text-[10px] leading-[1.55] text-[#785c60]">A exclusão é permanente. Se houver execução ou automação ativa, o servidor recusará a operação e nenhum dado será removido.</p>
        </section>
        <label className="text-[10px] font-bold text-[#4c5667]" htmlFor="hard-delete-confirmation">Digite o nome exato ou o ID completo para confirmar</label>
        <input id="hard-delete-confirmation" className="min-h-[38px] w-full rounded-[7px] border border-[#dfe3eb] bg-white px-2.5 py-2 text-[11px] text-[#354052] focus-visible:border-[#c4545c]" autoFocus autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} aria-describedby="hard-delete-confirm-hint" />
        <small className="text-[9px] leading-normal text-[#8590a0]" id="hard-delete-confirm-hint">Confirme com <code>{target.name}</code> ou <code>{target.id}</code>.</small>
        {error && <p className={`${errorBox} m-0 text-[10px]`} role="alert">{error}</p>}
        {busy && <p className="m-0 text-[10px] text-[#737f91]" role="status">Excluindo e atualizando as listas…</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-[#edf0f4] bg-[#fcfcfd] px-[22px] py-[13px] max-[760px]:px-[15px] max-[760px]:py-[11px]"><button type="button" className={buttonSecondary} onClick={close} disabled={busy}>Cancelar</button><button type="button" className={buttonDanger} onClick={onConfirm} disabled={!confirmationMatches || busy}>{busy ? 'Excluindo…' : 'Excluir definitivamente'}</button></footer>
    </>}
  </dialog>;
}
