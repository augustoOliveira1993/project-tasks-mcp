import { errorMessage } from '../../lib/format';
import { MarkdownModeView } from '../ui/MarkdownModeView';

type ProjectSummaryDialogProps = {
  name?: string;
  taskCount: number;
  markdown?: string;
  error?: unknown;
  isPending: boolean;
  isError: boolean;
  onClose: () => void;
};

export function ProjectSummaryDialog({ name, taskCount, markdown, error, isPending, isError, onClose }: ProjectSummaryDialogProps) {
  return <div className="overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog summary-dialog" role="dialog" aria-modal="true" aria-labelledby="summary-title"><header className="dialog-header"><div><p className="eyebrow">RESUMO DO PROJETO</p><h2 id="summary-title">{name}</h2><p className="muted-text">{taskCount} tarefa(s)</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header>{isPending ? <div className="loading">Gerando resumo…</div> : isError ? <div className="notice error">{errorMessage(error)}</div> : <div className="summary-markdown"><MarkdownModeView content={markdown} emptyMessage="Nenhum resumo disponível." label="Modo do resumo do projeto" /></div>}<footer className="dialog-footer"><button className="button secondary" onClick={onClose}>Fechar</button></footer></section>
  </div>;
}
