import type { ReactNode } from 'react';
import { buttonSecondary, eyebrow } from '../../../components/ui/classes';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { dialogHeader, dialogSubtitle, dialogTitle, iconButton, recordBody, recordDialog } from '../catalogClasses';

function CatalogRecordDialog({ title, subtitle, children, close }: { title: string; subtitle: string; children: ReactNode; close: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className={recordDialog} showCloseButton={false}>
      <DialogHeader className={dialogHeader}><div><p className={eyebrow}>CADASTRO · DETALHE</p><DialogTitle id="catalog-record-title" className={dialogTitle}>{title}</DialogTitle><DialogDescription className={dialogSubtitle}>{subtitle}</DialogDescription></div><Button variant="ghost" className={iconButton} type="button" onClick={close} aria-label="Fechar">×</Button></DialogHeader>
      <div className={recordBody}>{children}</div><DialogFooter className="border-t border-border px-5 py-3"><Button variant="outline" className={buttonSecondary} type="button" onClick={close}>Fechar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export { CatalogRecordDialog };
