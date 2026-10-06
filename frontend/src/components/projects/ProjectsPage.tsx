import type { ProjectSummary } from '../../api';
import { Badge } from '../ui/Badge';
import { ExpandableMarkdown } from '../ui/ExpandableMarkdown';
import { projectStats } from '../../features/projects/stats';

type ProjectsPageProps = {
  projects: ProjectSummary[];
  isPending: boolean;
  activeProjectId: string;
  search: string;
  currentPage: number;
  pages: number;
  total: number;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelect: (projectId: string) => void;
};

export function ProjectsPage({ projects, isPending, activeProjectId, search, currentPage, pages, total, onSearchChange, onPageChange, onSelect }: ProjectsPageProps) {
  return <section className="panel-card projects-page">
    <div className="section-heading"><div><p className="eyebrow">WORKSPACE</p><h1>Projetos acessíveis</h1><p className="muted-text">Escolha um projeto para abrir sua fila de tasks.</p></div><Badge>{total} projeto(s)</Badge></div>
    <label className="search-field projects-search"><span>⌕</span><input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar projeto" aria-label="Buscar projeto" /></label>
    {isPending ? <div className="loading">Carregando projetos…</div> : projects.length ? <div className="projects-catalog-grid">{projects.map(item => {
      const stats = projectStats(item);
      const selected = item.project._id === activeProjectId;
      return <article className={selected ? 'project-catalog-card selected' : 'project-catalog-card'} key={item.project._id}>
        <div className="project-catalog-heading"><span className="project-avatar">{item.project.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><Badge tone={item.project.visibility === 'private' ? 'amber' : 'green'}>{item.project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge></div>
        <h2>{item.project.name}</h2><ExpandableMarkdown content={item.project.description} />
        <div className="project-catalog-stats"><span title="Inclui tarefas arquivadas e canceladas. A fila de tarefas do projeto mostra apenas as não arquivadas.">{stats.total} tasks no total</span><span>{stats.completed} concluídas</span><strong>{stats.progress}%</strong></div>
        <span className="project-progress" role="progressbar" aria-label={'Progresso de ' + item.project.name} aria-valuenow={stats.progress} aria-valuemin={0} aria-valuemax={100} title="Concluídas sobre as tarefas ativas (cancelamentos não contam)"><span style={{ width: stats.progress + '%' }} /></span>
        <button type="button" className={selected ? 'button secondary full-button' : 'button primary full-button'} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(item.project._id)}>{selected ? 'Abrir projeto ativo' : 'Abrir tasks'}</button>
      </article>;
    })}</div> : <div className="empty-state compact"><h2>{total ? 'Nenhum projeto encontrado' : 'Nenhum projeto disponível'}</h2><p>{total ? 'Tente buscar por outro nome.' : 'Esta credencial ainda não possui projetos acessíveis.'}</p></div>}
    <footer className="table-footer"><span>{total} projeto(s)</span><div className="pagination"><button className="small-icon" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} aria-label="Página anterior">‹</button><span>{currentPage} de {pages}</span><button className="small-icon" disabled={currentPage >= pages} onClick={() => onPageChange(currentPage + 1)} aria-label="Próxima página">›</button></div></footer>
  </section>;
}
