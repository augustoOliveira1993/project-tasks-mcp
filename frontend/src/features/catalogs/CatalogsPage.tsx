import type { Project, Task } from '../../api';
import type { CatalogSection } from '../../route-state';
import { FeaturesCatalog } from './FeaturesCatalog';
import { ProjectsCatalog } from './ProjectsCatalog';
import { ResponsiblesCatalog } from './ResponsiblesCatalog';
import { TasksCatalog } from './TasksCatalog';
import { ConversationTypesManager } from '../../components/conversations/ConversationTypesManager';
import { catalogsDescription, catalogsHeading, catalogsTitle } from './catalogClasses';
import { eyebrow } from '../../components/ui/classes';

const titles: Record<CatalogSection, { title: string; description: string }> = {
  projects: { title: 'Projetos', description: 'Workspaces, visibilidade e repositórios' },
  features: { title: 'Features', description: 'Objetivos e critérios do projeto' },
  tasks: { title: 'Tarefas', description: 'Atividades, vínculos e responsáveis' },
  responsibles: { title: 'Responsáveis', description: 'Pessoas e agentes que recebem tarefas' },
  conversationTypes: { title: 'Tipos de conversa', description: 'Tipos e etapas dos fluxos de conversa com IA' }
};

/** Cada cadastro tem a própria entrada no menu lateral; o projeto ativo vem do seletor do menu. */
export function CatalogsPage({ section, token, nonce, projects, project, tasks, systemAdmin = false, notify, onProjectCreated, onSelectProject, onNavigateToConversations, onChanged }: {
  section: CatalogSection; token: string; nonce: string; projects: Project[]; project?: Project; tasks: Task[]; systemAdmin?: boolean;
  notify: (message: string, kind?: string) => void; onProjectCreated: (project: Project) => void;
  onSelectProject: (projectId: string) => void; onNavigateToConversations?: () => void; onChanged: () => void;
}) {
  const heading = titles[section];
  if (section === 'conversationTypes' && project) return <ConversationTypesManager token={token} nonce={nonce} projectId={project._id} onClose={() => onNavigateToConversations?.()} />;
  return <section className="grid min-w-0 gap-3.5">
    <header className={catalogsHeading}><div><p className={eyebrow}>WORKSPACE · CADASTROS</p><h1 className={catalogsTitle}>{heading.title}</h1><p className={catalogsDescription}>{heading.description}. {section === 'projects' || section === 'responsibles' && systemAdmin ? 'Telas independentes para consultar e administrar os registros.' : project ? `Projeto ativo: ${project.name}.` : 'Selecione um projeto no menu lateral.'}</p></div></header>
    {section === 'projects' && <ProjectsCatalog token={token} nonce={nonce} projects={projects} activeProjectId={project?._id ?? ''} notify={notify} onChanged={onChanged} onProjectCreated={onProjectCreated} onSelectProject={onSelectProject} />}
    {section === 'features' && <FeaturesCatalog token={token} nonce={nonce} projectId={project?._id ?? ''} notify={notify} onChanged={onChanged} />}
    {section === 'tasks' && <TasksCatalog token={token} nonce={nonce} project={project} tasks={tasks} notify={notify} onChanged={onChanged} />}
    {section === 'responsibles' && <ResponsiblesCatalog token={token} nonce={nonce} projects={projects} project={project} systemAdmin={systemAdmin} notify={notify} onChanged={onChanged} />}
    {section === 'conversationTypes' && <div className="rounded-xl border border-slate-200 bg-white p-5 text-[12px] text-muted-strong">Selecione ou cadastre um projeto para configurar os tipos de conversa.</div>}
  </section>;
}
