import { errorMessage } from '../../../lib/format';
import { MarkdownModeView } from '../../../components/ui/MarkdownModeView';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { buttonSecondary, eyebrow, notice } from '../../../components/ui/classes';

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
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[min(90dvh,760px)] max-w-3xl gap-0 overflow-auto p-0" showCloseButton>
      <DialogHeader className="border-b border-border px-5 py-5 sm:px-6">
        <p className={eyebrow}>RESUMO DO PROJETO</p><DialogTitle className="mb-0">{name || 'Resumo do projeto'}</DialogTitle>
        <DialogDescription>{taskCount} tarefa(s)</DialogDescription>
      </DialogHeader>
      {isPending ? <div className="px-5 py-7 text-center text-sm text-muted-foreground" role="status" aria-live="polite">Gerando resumo…</div>
        : isError ? <div className={`${notice.error} mx-5 mt-4`} role="alert">{errorMessage(error)}</div>
          : <div className="min-w-0 px-5 py-4"><MarkdownModeView content={markdown} emptyMessage="Nenhum resumo disponível." label="Modo do resumo do projeto" /></div>}
      <DialogFooter className="border-t border-border px-5 py-3"><Button type="button" variant="outline" className={buttonSecondary} onClick={onClose}>Fechar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
