import type { Project, Task } from '../../api';
import { ProjectAreasManager } from '../../components/projects/ProjectAreasManager';
import type { CatalogSection } from '../../route-state';
import { FeaturesCatalog } from './FeaturesCatalog';
import { ProjectsCatalog } from './ProjectsCatalog';
import { TasksCatalog } from './TasksCatalog';

const sections: Array<{ id: CatalogSection; title: string; description: string }> = [
  { id: 'projects', title: 'Projetos', description: 'Workspaces, visibilidade e repositórios' },
  { id: 'features', title: 'Features', description: 'Objetivos e critérios do projeto' },
  { id: 'tasks', title: 'Tarefas', description: 'Atividades, vínculos e responsáveis' },
  { id: 'areas', title: 'Áreas', description: 'Categorias disponíveis no projeto' }
];

export function CatalogsPage({ section, token, nonce, projects, project, tasks, notify, onProjectCreated, onSelectProject, onNavigateSection, onChanged }: {
  section: CatalogSection; token: string; nonce: string; projects: Project[]; project?: Project; tasks: Task[];
  notify: (message: string, kind?: string) => void; onProjectCreated: (project: Project) => void;
  onSelectProject: (projectId: string) => void; onNavigateSection: (section: CatalogSection) => void; onChanged: () => void;
}) {
  const screenTitle = section === 'overview' ? 'Cadastros' : sections.find(item => item.id === section)?.title ?? 'Cadastros';
  return <section className="catalogs-page">
    <header className="page-heading catalogs-heading"><div><p className="eyebrow">WORKSPACE · CADASTROS</p><h1>{screenTitle}</h1><p className="muted-text">Telas independentes para consultar e administrar os registros.</p></div>
      {section !== 'overview' && section !== 'projects' && <label className="catalog-project-picker">Projeto ativo<select value={project?._id ?? ''} onChange={event => onSelectProject(event.target.value)} aria-label="Projeto dos cadastros">{!project && <option value="">Selecione um projeto</option>}{projects.map(item => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>}
    </header>
    {section === 'overview' ? <div className="catalog-section-grid">{sections.map(item => <button type="button" className="panel-card catalog-section-card" key={item.id} onClick={() => onNavigateSection(item.id)}><span className="eyebrow">CADASTRO</span><strong>{item.title}</strong><small>{item.description}</small><span className="text-button">Abrir tela →</span></button>)}</div> : <>
      <nav className="catalog-section-nav" aria-label="Telas de cadastro">{sections.map(item => <button type="button" key={item.id} className={section === item.id ? 'catalog-section-link active' : 'catalog-section-link'} onClick={() => onNavigateSection(item.id)}>{item.title}</button>)}</nav>
      {section === 'projects' && <ProjectsCatalog token={token} nonce={nonce} projects={projects} activeProjectId={project?._id ?? ''} notify={notify} onChanged={onChanged} onProjectCreated={onProjectCreated} onSelectProject={onSelectProject} />}
      {section === 'features' && <FeaturesCatalog token={token} nonce={nonce} projectId={project?._id ?? ''} notify={notify} onChanged={onChanged} />}
      {section === 'tasks' && <TasksCatalog token={token} nonce={nonce} project={project} tasks={tasks} notify={notify} onChanged={onChanged} />}
      {section === 'areas' && (project ? <ProjectAreasManager token={token} project={project} onChanged={onChanged} notify={notify} /> : <p className="notice">Selecione um projeto para consultar e alterar as áreas.</p>)}
    </>}
  </section>;
}
