import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FeatureRecord } from './feature-create';
import { submitNewFeature } from './feature-create';
import { errorMessage } from '../../lib/format';

export function CreateFeatureDialog({ token, nonce, projectId, close, onCreated }: {
  token: string;
  nonce: string;
  projectId: string;
  close: () => void;
  onCreated: (feature: FeatureRecord) => void;
}) {
  const client = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [acceptance, setAcceptance] = useState(['']);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const create = useMutation({
    mutationFn: (draft: Parameters<typeof submitNewFeature>[2]) => submitNewFeature(token, projectId, draft),
    onSuccess: async feature => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['project-features', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['project-tasks', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['admin-projects', nonce] })
      ]);
      onCreated(feature);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      name: String(form.get('name') ?? ''),
      objective: String(form.get('objective') ?? ''),
      context: String(form.get('context') ?? ''),
      acceptance
    });
  }

  return <dialog ref={dialogRef} className="dialog create-task-dialog create-feature-dialog" aria-labelledby="create-feature-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className="dialog-header"><div><p className="eyebrow">NOVA FEATURE</p><h2 id="create-feature-title">Criar feature</h2><p className="muted-text">Organize tarefas relacionadas dentro deste projeto.</p></div><button type="button" className="icon-button" onClick={close} aria-label="Fechar">×</button></header>
    {create.isError && <div className="notice error" role="alert">{errorMessage(create.error)}</div>}
    <form className="stack-form create-task-form create-feature-form" onSubmit={submit}>
      <label>Nome<input name="name" required maxLength={20000} autoFocus placeholder="Ex.: Colaboração por task" /></label>
      <label>Objetivo<textarea name="objective" required maxLength={20000} rows={2} placeholder="Qual resultado esta feature deve entregar?" /></label>
      <label>Contexto<textarea name="context" required maxLength={20000} rows={3} placeholder="Registre limites, decisões e contexto útil." /></label>
      <section className="feature-acceptance-editor" aria-labelledby="feature-acceptance-title">
        <div className="section-heading"><div><h3 id="feature-acceptance-title">Critérios de aceite</h3><p>Adicione os resultados que definem a conclusão da feature (até 100).</p></div><button type="button" className="button secondary small-button" onClick={() => setAcceptance(current => [...current, ''])} disabled={create.isPending || acceptance.length >= 100}>+ Critério</button></div>
        {acceptance.map((criterion, index) => <div className="feature-acceptance-row" key={index}><label htmlFor={`feature-acceptance-${index}`}>Critério {index + 1}<textarea id={`feature-acceptance-${index}`} required maxLength={20000} rows={2} value={criterion} onChange={event => setAcceptance(current => current.map((value, position) => position === index ? event.target.value : value))} placeholder="Descreva um resultado verificável" /></label><button type="button" className="text-button" aria-label={`Remover critério ${index + 1}`} disabled={create.isPending || acceptance.length === 1} onClick={() => setAcceptance(current => current.filter((_value, position) => position !== index))}>Remover</button></div>)}
      </section>
      <div className="button-row end-row"><button type="button" className="button secondary" onClick={close} disabled={create.isPending}>Cancelar</button><button className="button primary" disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Criar feature'}</button></div>
    </form>
  </dialog>;
}
