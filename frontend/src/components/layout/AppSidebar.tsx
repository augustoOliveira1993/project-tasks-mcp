import type { MouseEvent, ReactNode } from 'react';
import { Activity, BarChart3, Check, CheckSquare, ChevronDown, Circle, CircleHelp, Copy, Folder, FolderKanban, GitBranch, Layers, LogOut, MessageSquareText, Settings2, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/Logo';
import type { AppRoute } from '@/route-state';
import { cn } from '@/lib/utils';

type NavigationEntry = { label: string; route: AppRoute; icon: LucideIcon; count?: number; unread?: boolean };

type AppSidebarProps = {
  activeRoute: AppRoute;
  activeProjectId: string;
  projectName?: string;
  projectVisibility?: string;
  projectCount: number;
  taskCount: number;
  unreadConversationCount: number;
  projectPickerOpen: boolean;
  copiedProjectId: boolean;
  onOpenProjectPicker: () => void;
  onCopyProjectId: () => void;
  onSignOut: () => void;
  hrefForRoute: (route: AppRoute) => string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, route: AppRoute) => void;
};

function NavigationLink({ label, href, icon: Icon, active, count, unread, onClick }: {
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  count?: number;
  unread?: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return <a href={href} onClick={onClick} aria-current={active ? 'page' : undefined}
    className={cn('flex min-h-10 min-w-0 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'bg-accent text-accent-foreground')}>
    <Icon aria-hidden="true" className="size-4 shrink-0 opacity-75" />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {count !== undefined && <span className={cn('min-w-5 rounded px-1.5 py-0.5 text-center text-[10px] tabular-nums', unread ? 'bg-emerald-600 font-semibold text-white' : 'text-muted-foreground')}>
      <span aria-hidden="true">{count}</span><span className="sr-only">{unread ? `${count} conversas não lidas` : `${count} itens`}</span>
    </span>}
  </a>;
}

function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-1" aria-label={title}>
    <h2 className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
    {children}
  </section>;
}

function isRouteActive(activeRoute: AppRoute, route: AppRoute): boolean {
  if (route === 'tasks') return activeRoute === 'tasks' || activeRoute === 'task';
  if (route === 'dashboard') return activeRoute === 'dashboard';
  if (route === 'activity') return activeRoute === 'activity' || activeRoute === 'globalActivity';
  if (route === 'catalogProjects') return activeRoute === 'catalogProjects' || activeRoute === 'catalogs' || activeRoute === 'catalogAreas';
  return activeRoute === route;
}

export function AppSidebar({ activeRoute, activeProjectId, projectName, projectVisibility, projectCount, taskCount, unreadConversationCount, projectPickerOpen, copiedProjectId, onOpenProjectPicker, onCopyProjectId, onSignOut, hrefForRoute, onNavigate }: AppSidebarProps) {
  const sections: Array<{ title: string; entries: NavigationEntry[] }> = [
    { title: 'Projeto', entries: [
      { label: 'Tarefas', route: 'tasks', icon: CheckSquare, count: taskCount },
      { label: 'Dashboard', route: 'dashboard', icon: BarChart3 },
      { label: 'Conversas', route: 'conversations', icon: MessageSquareText, count: unreadConversationCount, unread: true },
      { label: 'Atividade', route: 'activity', icon: Activity }
    ] },
    { title: 'Workspace', entries: [
      { label: 'Meus projetos', route: 'projects', icon: FolderKanban, count: projectCount },
      { label: 'Visão geral', route: 'globalDashboard', icon: BarChart3 }
    ] },
    { title: 'Cadastros', entries: [
      { label: 'Projetos', route: 'catalogProjects', icon: Folder },
      { label: 'Features', route: 'catalogFeatures', icon: Layers },
      { label: 'Tarefas', route: 'catalogTasks', icon: CheckSquare },
      { label: 'Responsáveis', route: 'catalogResponsibles', icon: Users },
      { label: 'Tipos de conversa', route: 'catalogConversationTypes', icon: GitBranch }
    ] },
    { title: 'Sistema', entries: [
      { label: 'Administração', route: 'settings', icon: Settings2 },
      { label: 'Ajuda', route: 'help', icon: CircleHelp }
    ] }
  ];

  return <div className="flex h-full min-h-0 flex-col">
    <a className="mb-5 flex items-center gap-3 rounded-md px-1.5 py-1 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={hrefForRoute('tasks')} onClick={event => onNavigate(event, 'tasks')}>
      <Logo size={34} /><span className="grid min-w-0 gap-0.5"><strong className="truncate text-sm font-semibold tracking-tight text-foreground">Project Tasks</strong><span className="text-xs text-muted-foreground">Workspace</span></span>
    </a>

    <div className="grid gap-2">
      <span className="px-1.5 text-xs font-medium text-muted-foreground">Projeto ativo</span>
      <div className="flex min-w-0 items-center gap-1">
        <Button type="button" variant="outline" className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 px-2 py-2 text-left" aria-haspopup="dialog" aria-expanded={projectPickerOpen} aria-label={`Selecionar projeto. Projeto ativo: ${projectName ?? 'nenhum projeto'}`} disabled={!projectCount} onClick={onOpenProjectPicker}>
          <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">{projectName?.slice(0, 1).toLocaleUpperCase('pt-BR') ?? '⌘'}</span>
          <span className="grid min-w-0 flex-1 gap-0.5"><span className="truncate text-xs font-medium">{projectName ?? 'Nenhum projeto'}</span><span className="truncate text-[10px] text-muted-foreground">{projectVisibility === 'private' ? 'Projeto privado' : projectName ? 'Projeto compartilhado' : 'Selecione um workspace'}</span></span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </Button>
        {activeProjectId && <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" onClick={onCopyProjectId} aria-label={copiedProjectId ? 'ID copiado' : 'Copiar ID do projeto'} title="Copiar ID do projeto">{copiedProjectId ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>}
      </div>
    </div>

    <nav className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto overscroll-contain pr-1" aria-label="Navegação principal">
      {sections.map(section => <NavSection key={section.title} title={section.title}>{section.entries.map(entry => <NavigationLink key={entry.route} {...entry} active={isRouteActive(activeRoute, entry.route)} href={hrefForRoute(entry.route)} onClick={event => onNavigate(event, entry.route)} />)}</NavSection>)}
    </nav>

    <div className="mt-3 flex min-h-10 items-center gap-2 border-t border-border px-1.5 pt-3 text-xs text-muted-foreground">
      <Circle aria-hidden="true" className="size-2 fill-emerald-600 text-emerald-600" /><span>Conectado ao MCP</span>
      <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 px-2" onClick={onSignOut} aria-label="Sair do workspace"><LogOut aria-hidden="true" />Sair</Button>
    </div>
  </div>;
}
