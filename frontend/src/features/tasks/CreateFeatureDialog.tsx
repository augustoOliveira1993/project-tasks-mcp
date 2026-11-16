import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FeatureRecord } from './feature-create';
import { submitNewFeature } from './feature-create';
import { errorMessage } from '../../lib/format';
import { buttonPrimary, buttonSecondary, buttonSecondarySmall, eyebrow, notice, textButton } from '../../components/ui/classes';

const dialogHeader = 'flex items-start justify-between gap-4 border-b border-b-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const field = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const control = 'w-full resize-y rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054] outline-none';

export function CreateFeatureDialog({ token, nonce, projectId, close, onCreated }: {
  token: string;
  nonce: string;
  projectId: string;
  close: () => void;
  onCreated: (feature: FeatureRecord) => void;
}) {
  const client = useQueryClient();
  const [acceptance, setAcceptance] = useState(['']);
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
      acceptance,
      responsible: String(form.get('responsible') ?? '')
    });
  }

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent showCloseButton className="max-h-[min(850px,calc(100dvh-28px))] w-[min(calc(100%-28px),720px)] max-w-none gap-0 overflow-auto rounded-ui-lg border-[#dfe4ed] bg-white p-0 text-[#455164] shadow-[0_24px_70px_#18223040]">
    <DialogHeader className={dialogHeader}><div><p className={eyebrow}>NOVA FEATURE</p><DialogTitle id="create-feature-title" className="mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]">Criar feature</DialogTitle><DialogDescription className="text-[10px] text-muted-strong">Organize tarefas relacionadas dentro deste projeto.</DialogDescription></div></DialogHeader>
    {create.isError && <div className={`${notice.error} mx-[22px] mt-[13px]`} role="alert">{errorMessage(create.error)}</div>}
    <form className="grid gap-3 px-[22px] pt-4 pb-5 max-[480px]:px-4 max-[480px]:pt-[13px] max-[480px]:pb-4" onSubmit={submit}>
      <Label className={field}>Nome<Input className={control} name="name" required maxLength={20000} autoFocus placeholder="Ex.: Colaboração por task" /></Label>
      <Label className={field}>Responsável<Input className={control} name="responsible" maxLength={320} placeholder="E-mail de quem responde (vazio assume você)" /></Label>
      <Label className={field}>Objetivo<Textarea className={control} name="objective" required maxLength={20000} rows={2} placeholder="Qual resultado esta feature deve entregar?" /></Label>
      <Label className={field}>Contexto<Textarea className={control} name="context" required maxLength={20000} rows={3} placeholder="Registre limites, decisões e contexto útil." /></Label>
      <section className="grid gap-2" aria-labelledby="feature-acceptance-title">
        <div className="mb-[11px] flex items-center justify-between gap-[14px]"><div><h3 id="feature-acceptance-title" className="mb-1 font-display text-[12px] leading-[normal] font-bold text-[#36445a]">Critérios de aceite</h3><p className="text-[9px] text-[#7f8a9b]">Adicione os resultados que definem a conclusão da feature (até 100).</p></div><Button type="button" className={buttonSecondarySmall} onClick={() => setAcceptance(current => [...current, ''])} disabled={create.isPending || acceptance.length >= 100}>+ Critério</Button></div>
        {acceptance.map((criterion, index) => <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-[10px] rounded-[8px] border border-[#e5e8ef] bg-[#fbfcff] px-[10px] py-[9px]" key={index}><Label className="grid gap-[5px] text-[10px] font-semibold text-[#566275]" htmlFor={`feature-acceptance-${index}`}>Critério {index + 1}<Textarea className={control} id={`feature-acceptance-${index}`} required maxLength={20000} rows={2} value={criterion} onChange={event => setAcceptance(current => current.map((value, position) => position === index ? event.target.value : value))} placeholder="Descreva um resultado verificável" /></Label><Button type="button" className={`${textButton} mb-[7px]`} aria-label={`Remover critério ${index + 1}`} disabled={create.isPending || acceptance.length === 1} onClick={() => setAcceptance(current => current.filter((_value, position) => position !== index))}>Remover</Button></div>)}
      </section>
      <div className="mt-1 flex items-center justify-end gap-2"><Button type="button" className={buttonSecondary} onClick={close} disabled={create.isPending}>Cancelar</Button><Button type="submit" className={buttonPrimary} disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Criar feature'}</Button></div>
    </form>
    </DialogContent>
  </Dialog>;
}
