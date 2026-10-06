import type { Project, Task } from '../../api';
import type { CatalogSection } from '../../route-state';
import { FeaturesCatalog } from './FeaturesCatalog';
import { ProjectsCatalog } from './ProjectsCatalog';
import { ResponsiblesCatalog } from './ResponsiblesCatalog';
import { TasksCatalog } from './TasksCatalog';

const titles: Record<CatalogSection, { title: string; description: string }> = {
  projects: { title: 'Projetos', description: 'Workspaces, visibilidade e repositórios' },
  features: { title: 'Features', description: 'Objetivos e critérios do projeto' },
  tasks: { title: 'Tarefas', description: 'Atividades, vínculos e responsáveis' },
  responsibles: { title: 'Responsáveis', description: 'Pessoas e agentes que recebem tarefas' }
};

/** Cada cadastro tem a própria entrada no menu lateral; o projeto ativo vem do seletor do menu. */
export function CatalogsPage({ section, token, nonce, projects, project, tasks, systemAdmin = false, notify, onProjectCreated, onSelectProject, onChanged }: {
  section: CatalogSection; token: string; nonce: string; projects: Project[]; project?: Project; tasks: Task[]; systemAdmin?: boolean;
  notify: (message: string, kind?: string) => void; onProjectCreated: (project: Project) => void;
  onSelectProject: (projectId: string) => void; onChanged: () => void;
}) {
  const heading = titles[section];
  return <section className="catalogs-page">
    <header className="page-heading catalogs-heading"><div><p className="eyebrow">WORKSPACE · CADASTROS</p><h1>{heading.title}</h1><p className="muted-text">{heading.description}. {section === 'projects' || section === 'responsibles' && systemAdmin ? 'Telas independentes para consultar e administrar os registros.' : project ? `Projeto ativo: ${project.name}.` : 'Selecione um projeto no menu lateral.'}</p></div></header>
    {section === 'projects' && <ProjectsCatalog token={token} nonce={nonce} projects={projects} activeProjectId={project?._id ?? ''} notify={notify} onChanged={onChanged} onProjectCreated={onProjectCreated} onSelectProject={onSelectProject} />}
    {section === 'features' && <FeaturesCatalog token={token} nonce={nonce} projectId={project?._id ?? ''} notify={notify} onChanged={onChanged} />}
    {section === 'tasks' && <TasksCatalog token={token} nonce={nonce} project={project} tasks={tasks} notify={notify} onChanged={onChanged} />}
    {section === 'responsibles' && <ResponsiblesCatalog token={token} nonce={nonce} projects={projects} project={project} systemAdmin={systemAdmin} notify={notify} onChanged={onChanged} />}
  </section>;
}
