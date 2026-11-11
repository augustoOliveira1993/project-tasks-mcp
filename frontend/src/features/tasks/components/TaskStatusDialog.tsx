import type { FormEvent } from 'react';
import type { Task } from '../../api';
import { statusLabels } from '../../features/tasks/status';
import { buttonPrimary, buttonSecondary, eyebrow } from '../ui/classes';

const overlay = 'fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/45 p-6 backdrop-blur-sm max-[760px]:items-start max-[760px]:p-3';
const dialog = 'max-h-[90vh] w-[min(100%,430px)] overflow-auto rounded-xl border border-slate-200 bg-white p-[21px] shadow-2xl max-[760px]:my-auto max-[760px]:max-h-[calc(100vh-24px)] max-[760px]:p-0';
const header = 'flex items-start justify-between gap-4 border-b border-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const title = 'mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]';
const iconButton = 'inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const fieldLabel = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const control = 'w-full rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054] resize-y';

export function TaskStatusDialog({ task, saving, onClose, onSubmit }: { task: Task; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isBlocking = task.status === 'em_execucao';
  const statuses = isBlocking ? ['bloqueada'] : ['pendente', 'em_revisao', 'concluida', 'cancelada'];
  return <div className={overlay} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={dialog} role="dialog" aria-modal="true" aria-labelledby="status-title"><header className={header}><div><p className={eyebrow}>AÇÃO ADMINISTRATIVA</p><h2 className={title} id="status-title">{isBlocking ? 'Bloquear tarefa' : 'Alterar status'}</h2><p className="text-[10px] text-muted-strong">{task.name}</p></div><button className={iconButton} onClick={onClose} aria-label="Fechar">×</button></header><form className="grid gap-[13px] max-[760px]:p-4" onSubmit={onSubmit}><label className={fieldLabel}>Novo status<select className={control} name="status" defaultValue={isBlocking ? 'bloqueada' : task.status}>{Object.entries(statusLabels).filter(([key]) => statuses.includes(key)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className={fieldLabel}>{isBlocking ? 'Motivo do bloqueio' : 'Motivo'}<textarea className={control} name="reason" required rows={3} placeholder={isBlocking ? 'Explique por que esta tarefa deve ser bloqueada' : 'Descreva o motivo da alteração'} /></label><div className="mt-1 flex items-center justify-end gap-2"><button type="button" className={buttonSecondary} onClick={onClose}>Cancelar</button><button className={buttonPrimary} disabled={saving}>{isBlocking ? 'Bloquear tarefa' : 'Salvar status'}</button></div></form></section>
  </div>;
}
