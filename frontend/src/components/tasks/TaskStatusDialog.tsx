import type { FormEvent } from 'react';
import type { Task } from '../../api';
import { statusLabels } from '../../features/tasks/status';

export function TaskStatusDialog({ task, saving, onClose, onSubmit }: { task: Task; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="status-title"><header className="dialog-header"><div><p className="eyebrow">AÇÃO ADMINISTRATIVA</p><h2 id="status-title">Alterar status</h2><p className="muted-text">{task.name}</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header><form className="stack-form" onSubmit={onSubmit}><label>Novo status<select name="status" defaultValue={task.status}>{Object.entries(statusLabels).filter(([key]) => ['pendente', 'em_revisao', 'concluida', 'cancelada'].includes(key)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Motivo<textarea name="reason" required rows={3} placeholder="Descreva o motivo da alteração" /></label><div className="button-row end-row"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>Salvar status</button></div></form></section>
  </div>;
}
