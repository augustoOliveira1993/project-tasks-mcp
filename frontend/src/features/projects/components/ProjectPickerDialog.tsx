import { ChevronLeft, ChevronRight, FolderKanban } from 'lucide-react';
import type { ProjectSummary } from '../../../api';
import { projectStats } from '../stats';
import { plainText } from '../../../lib/labels';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';

type ProjectPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectSummary[];
  activeProjectId: string;
  search: string;
  currentPage: number;
  pages: number;
  total: number;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelect: (projectId: string) => void;
};

export function ProjectPickerDialog({ open, onOpenChange, projects, activeProjectId, search, currentPage, pages, total, onSearchChange, onPageChange, onSelect }: ProjectPickerDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[min(90dvh,760px)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Workspace</p>
        <DialogTitle className="mt-1">Projetos acessíveis</DialogTitle>
        <DialogDescription>Selecione um projeto para torná-lo ativo.</DialogDescription>
      </DialogHeader>
      <div className="shrink-0 px-5 py-4 sm:px-6">
        <label htmlFor="project-picker-search" className="sr-only">Buscar projeto</label>
        <Input id="project-picker-search" type="search" name="project-search" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar projeto" autoFocus />
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-5 pb-4 sm:px-6" aria-live="polite" aria-busy="false">
        {projects.length ? projects.map(item => {
          const stats = projectStats(item);
          const selected = item.project._id === activeProjectId;
          return <Button key={item.project._id} type="button" variant="outline" aria-pressed={selected} onClick={() => onSelect(item.project._id)}
            className={`h-auto grid w-full min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-accent/50'}`}>
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">{item.project.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span>
            <span className="grid min-w-0 gap-1">
              <strong className="truncate text-sm font-semibold text-foreground">{item.project.name}</strong>
              <span className="truncate text-xs text-muted-foreground">{plainText(item.project.description) || 'Sem descrição'}</span>
              <span className="text-xs text-muted-foreground">{stats.total} tarefas · {stats.completed} concluídas · {stats.progress}%</span>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`Progresso de ${item.project.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.progress}>
                <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${stats.progress}%` }} />
              </span>
            </span>
            <Badge variant={item.project.visibility === 'private' ? 'secondary' : 'outline'} className="mt-0.5">{item.project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge>
          </Button>;
        }) : <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
          <FolderKanban aria-hidden="true" className="size-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Nenhum projeto encontrado</h3>
          <p className="text-sm text-muted-foreground">Tente buscar por outro nome.</p>
        </div>}
      </div>
      <DialogFooter className="shrink-0 flex-row items-center justify-between border-t border-border bg-muted/30 px-5 py-3 sm:px-6">
        <span className="text-xs text-muted-foreground">{total} projeto(s)</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft aria-hidden="true" /></Button>
          <span className="min-w-16 text-center text-xs text-muted-foreground">{currentPage} de {pages}</span>
          <Button type="button" variant="outline" size="icon" aria-label="Próxima página" disabled={currentPage >= pages} onClick={() => onPageChange(currentPage + 1)}><ChevronRight aria-hidden="true" /></Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
