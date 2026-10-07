import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FeatureRecord } from './feature-create';
import { submitNewFeature } from './feature-create';
import { errorMessage } from '../../lib/format';
import { buttonPrimary, buttonSecondary, buttonSecondarySmall, eyebrow, notice, textButton } from '../../components/ui/classes';

const dialogBox = 'm-auto max-h-[min(850px,calc(100dvh-28px))] w-[min(calc(100%-28px),720px)] overflow-auto rounded-ui-lg border border-[#dfe4ed] bg-white p-0 text-[#455164] shadow-[0_24px_70px_#18223040] open:block backdrop:bg-[#18203388] backdrop:backdrop-blur-[3px]';
const dialogHeader = 'flex items-start justify-between gap-4 border-b border-b-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const iconButton = 'inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const field = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const control = 'w-full resize-y rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[#344054] outline-none';

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

  return <dialog ref={dialogRef} className={dialogBox} aria-labelledby="create-feature-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className={dialogHeader}><div><p className={eyebrow}>NOVA FEATURE</p><h2 id="create-feature-title" className="mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]">Criar feature</h2><p className="text-[10px] text-muted-strong">Organize tarefas relacionadas dentro deste projeto.</p></div><button type="button" className={iconButton} onClick={close} aria-label="Fechar">×</button></header>
    {create.isError && <div className={`${notice.error} mx-[22px] mt-[13px]`} role="alert">{errorMessage(create.error)}</div>}
    <form className="grid gap-3 px-[22px] pt-4 pb-5 max-[480px]:px-4 max-[480px]:pt-[13px] max-[480px]:pb-4" onSubmit={submit}>
      <label className={field}>Nome<input className={control} name="name" required maxLength={20000} autoFocus placeholder="Ex.: Colaboração por task" /></label>
      <label className={field}>Objetivo<textarea className={control} name="objective" required maxLength={20000} rows={2} placeholder="Qual resultado esta feature deve entregar?" /></label>
      <label className={field}>Contexto<textarea className={control} name="context" required maxLength={20000} rows={3} placeholder="Registre limites, decisões e contexto útil." /></label>
      <section className="grid gap-2" aria-labelledby="feature-acceptance-title">
        <div className="mb-[11px] flex items-center justify-between gap-[14px]"><div><h3 id="feature-acceptance-title" className="mb-1 font-display text-[12px] leading-[normal] font-bold text-[#36445a]">Critérios de aceite</h3><p className="text-[9px] text-[#7f8a9b]">Adicione os resultados que definem a conclusão da feature (até 100).</p></div><button type="button" className={buttonSecondarySmall} onClick={() => setAcceptance(current => [...current, ''])} disabled={create.isPending || acceptance.length >= 100}>+ Critério</button></div>
        {acceptance.map((criterion, index) => <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-[10px] rounded-[8px] border border-[#e5e8ef] bg-[#fbfcff] px-[10px] py-[9px]" key={index}><label className="grid gap-[5px] text-[10px] font-semibold text-[#566275]" htmlFor={`feature-acceptance-${index}`}>Critério {index + 1}<textarea className={control} id={`feature-acceptance-${index}`} required maxLength={20000} rows={2} value={criterion} onChange={event => setAcceptance(current => current.map((value, position) => position === index ? event.target.value : value))} placeholder="Descreva um resultado verificável" /></label><button type="button" className={`${textButton} mb-[7px]`} aria-label={`Remover critério ${index + 1}`} disabled={create.isPending || acceptance.length === 1} onClick={() => setAcceptance(current => current.filter((_value, position) => position !== index))}>Remover</button></div>)}
      </section>
      <div className="mt-1 flex items-center justify-end gap-2"><button type="button" className={buttonSecondary} onClick={close} disabled={create.isPending}>Cancelar</button><button className={buttonPrimary} disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Criar feature'}</button></div>
    </form>
  </dialog>;
}
