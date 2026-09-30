import type { ProjectSummary } from '../../api';
import { Badge } from '../ui/Badge';
import { projectStats } from '../../features/projects/stats';

type ProjectPickerDialogProps = {
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

export function ProjectPickerDialog({ projects, activeProjectId, search, currentPage, pages, total, onSearchChange, onPageChange, onSelect }: ProjectPickerDialogProps) {
  return <dialog id="projects-dialog" className="dialog projects-dialog" aria-labelledby="projects-title">
    <header className="dialog-header"><div><p className="eyebrow">WORKSPACE</p><h2 id="projects-title">Projetos acessíveis</h2><p className="muted-text">Selecione um projeto para torná-lo ativo.</p></div><form method="dialog"><button type="submit" className="icon-button" aria-label="Fechar">×</button></form></header>
    <label className="search-field"><span>⌕</span><input autoFocus value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar projeto" /></label>
    <div className="project-list">{projects.length ? projects.map(item => { const stats = projectStats(item); return <button className={item.project._id === activeProjectId ? 'project-option selected' : 'project-option'} key={item.project._id} aria-pressed={item.project._id === activeProjectId} onClick={() => onSelect(item.project._id)}>
      <span className="project-avatar">{item.project.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><span className="project-option-body"><strong>{item.project.name}</strong><small>{item.project.description || 'Sem descrição'}</small><small>{stats.total} tarefas · {stats.completed} concluídas · {stats.progress}%</small><span className="project-progress"><span style={{ width: stats.progress + '%' }} /></span></span><Badge tone={item.project.visibility === 'private' ? 'amber' : 'green'}>{item.project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge>
    </button>; }) : <div className="empty-state compact project-empty"><h3>Nenhum projeto encontrado</h3><p>Tente buscar por outro nome.</p></div>}</div>
    <footer className="table-footer"><span>{total} projeto(s)</span><div className="pagination"><button className="small-icon" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>‹</button><span>{currentPage} de {pages}</span><button className="small-icon" disabled={currentPage >= pages} onClick={() => onPageChange(currentPage + 1)}>›</button></div></footer>
  </dialog>;
}
