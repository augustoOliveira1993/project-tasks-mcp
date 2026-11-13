import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { IconFile } from '../../../components/ui/icons';
import { buttonSecondary, notice } from '../../../components/ui/classes';
import { buildInstallationGuideHtml, type IssuedCredentials } from './responsible-installation';

type Environment = 'windows' | 'ubuntu' | '';

export function ResponsibleSetupPdfDialog({ open, onOpenChange, issued, notify }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issued: IssuedCredentials;
  notify: (message: string, kind?: string) => void;
}) {
  const [environment, setEnvironment] = useState<Environment>('');

  function close(nextOpen: boolean) {
    if (!nextOpen) setEnvironment('');
    onOpenChange(nextOpen);
  }

  function generatePdf() {
    if (!environment) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      notify('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.', 'error');
      return;
    }
    try {
      printWindow.opener = null;
      printWindow.document.open();
      printWindow.document.write(buildInstallationGuideHtml(issued, environment));
      printWindow.document.close();
      printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
      window.setTimeout(() => {
        if (!printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 250);
      close(false);
      notify('Na janela de impressão, escolha “Salvar como PDF”. O documento contém credenciais.', 'info');
    } catch {
      printWindow.close();
      notify('Não foi possível abrir o guia para impressão.', 'error');
    }
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Guia de instalação</p>
        <DialogTitle>Escolha o ambiente</DialogTitle>
        <DialogDescription>O PDF vai incluir somente as credenciais geradas para {issued.email} e os comandos do sistema selecionado.</DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-ui-xs font-bold text-ink-2">Sistema operacional</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-ui-md border border-line p-3 transition-colors has-[:checked]:border-focus has-[:checked]:bg-tone-blue-bg">
          <input className="mt-1 size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring" type="radio" name="responsible-installation-environment" value="windows" checked={environment === 'windows'} onChange={() => setEnvironment('windows')} />
          <span className="grid gap-0.5"><strong className="text-ui-sm text-ink">Windows</strong><small className="text-ui-xs text-muted-strong">Script PowerShell personalizado (.ps1).</small></span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-ui-md border border-line p-3 transition-colors has-[:checked]:border-focus has-[:checked]:bg-tone-blue-bg">
          <input className="mt-1 size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring" type="radio" name="responsible-installation-environment" value="ubuntu" checked={environment === 'ubuntu'} onChange={() => setEnvironment('ubuntu')} />
          <span className="grid gap-0.5"><strong className="text-ui-sm text-ink">Ubuntu</strong><small className="text-ui-xs text-muted-strong">Script Bash personalizado (.sh) e comando chmod.</small></span>
        </label>
      </fieldset>
      <p className={notice.info} role="note">O PDF mostra tokens. Ele será montado no navegador e aberto na impressão; escolha “Salvar como PDF” e envie o arquivo por um canal seguro.</p>
      <DialogFooter>
        <Button type="button" variant="outline" className={buttonSecondary} onClick={() => close(false)}>Cancelar</Button>
        <Button type="button" disabled={!environment} onClick={generatePdf}><IconFile size={14} /> Gerar PDF</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
