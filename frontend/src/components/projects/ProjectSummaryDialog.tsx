import { errorMessage } from '../../lib/format';
import { MarkdownModeView } from '../ui/MarkdownModeView';
import { buttonSecondary, eyebrow, notice } from '../ui/classes';

const overlay = 'fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/45 p-6 backdrop-blur-sm max-[760px]:items-start max-[760px]:p-3';
const dialog = 'max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl';
const header = 'flex items-start justify-between gap-4 border-b border-b-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
const closeButton = 'inline-grid size-[30px] shrink-0 place-items-center rounded-[7px] border border-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
const footer = 'flex justify-end border-t border-t-[#edf0f4] px-[23px] py-3 max-[760px]:px-4 max-[760px]:py-2.5';

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
  return <div className={overlay} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={dialog} role="dialog" aria-modal="true" aria-labelledby="summary-title"><header className={header}><div><p className={eyebrow}>RESUMO DO PROJETO</p><h2 id="summary-title" className="mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]">{name}</h2><p className="m-0 text-[10px] text-muted-strong">{taskCount} tarefa(s)</p></div><button className={closeButton} onClick={onClose} aria-label="Fechar">×</button></header>{isPending ? <div className="px-[18px] py-7 text-center text-[11px] text-[#8792a2]">Gerando resumo…</div> : isError ? <div className={notice.error}>{errorMessage(error)}</div> : <div className="px-[23px] pb-[18px]"><MarkdownModeView content={markdown} emptyMessage="Nenhum resumo disponível." label="Modo do resumo do projeto" /></div>}<footer className={footer}><button className={buttonSecondary} onClick={onClose}>Fechar</button></footer></section>
  </div>;
}
