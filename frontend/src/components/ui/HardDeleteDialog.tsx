import { useEffect, useRef, useState } from 'react';

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

  return <dialog ref={dialogRef} className="hard-delete-dialog" aria-labelledby="hard-delete-title" aria-describedby="hard-delete-impact" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    {target && <>
      <header className="hard-delete-header"><div><p className="eyebrow">AÇÃO IRREVERSÍVEL</p><h2 id="hard-delete-title">Excluir {target.kind === 'project' ? 'projeto' : 'tarefa'} definitivamente?</h2></div><button type="button" className="icon-button" aria-label="Fechar confirmação" disabled={busy} onClick={close}>×</button></header>
      <div className="hard-delete-body">
        <div className="hard-delete-target"><strong>{target.name}</strong><code>{target.id}</code>{target.kind === 'task' && <small>Projeto: {target.projectName || '—'} · Status: {target.status || '—'}{target.responsible ? ` · Responsável: ${target.responsible}` : ''}</small>}</div>
        <section id="hard-delete-impact" className="hard-delete-impact">
          <strong>O que será removido</strong>
          {target.kind === 'project'
            ? <p>O projeto, repositórios exclusivos, funcionalidades, tarefas e os dados associados: mensagens, documentos Markdown, diffs, eventos, execuções e automações. Credenciais humanas compartilhadas com outros projetos serão preservadas.</p>
            : <p>A tarefa, seu histórico de execução, mensagens, documentos Markdown e diffs. Dependências em outras tarefas serão limpas; o projeto e as tarefas irmãs permanecem.</p>}
          <p>A exclusão é permanente. Se houver execução ou automação ativa, o servidor recusará a operação e nenhum dado será removido.</p>
        </section>
        <label className="hard-delete-confirm-label" htmlFor="hard-delete-confirmation">Digite o nome exato ou o ID completo para confirmar</label>
        <input id="hard-delete-confirmation" className="hard-delete-confirm-input" autoFocus autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} aria-describedby="hard-delete-confirm-hint" />
        <small id="hard-delete-confirm-hint">Confirme com <code>{target.name}</code> ou <code>{target.id}</code>.</small>
        {error && <p className="notice error" role="alert">{error}</p>}
        {busy && <p className="hard-delete-progress" role="status">Excluindo e atualizando as listas…</p>}
      </div>
      <footer className="hard-delete-footer"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancelar</button><button type="button" className="button danger-button" onClick={onConfirm} disabled={!confirmationMatches || busy}>{busy ? 'Excluindo…' : 'Excluir definitivamente'}</button></footer>
    </>}
  </dialog>;
}
