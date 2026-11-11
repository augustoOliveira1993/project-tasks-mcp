import type { ReactNode } from 'react';
import { Circle, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type Notice = { message: string; kind: string };

type AppShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
  breadcrumbs: ReactNode;
  projectName?: string;
  notice: Notice | null;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  onToggleSidebar: () => void;
  onMobileNavOpenChange: (open: boolean) => void;
  onSignOut: () => void;
  onDismissNotice: () => void;
};

export function AppShell({
  children,
  sidebar,
  breadcrumbs,
  projectName,
  notice,
  sidebarCollapsed,
  mobileNavOpen,
  onToggleSidebar,
  onMobileNavOpenChange,
  onSignOut,
  onDismissNotice
}: AppShellProps) {
  const hasError = notice?.kind === 'error';

  return <div className={cn('min-h-screen bg-canvas text-foreground transition-[padding] duration-200', sidebarCollapsed ? 'md:pl-0' : 'md:pl-64')}>
    <a href="#main-content" className="sr-only z-[100] rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-md focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:ring-2 focus:ring-ring">
      Pular para o conteúdo
    </a>

    <aside
      id="desktop-navigation"
      aria-label="Menu lateral"
      aria-hidden={sidebarCollapsed || undefined}
      inert={sidebarCollapsed || undefined}
      className={cn('fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card p-4 transition-[transform,visibility] duration-200 md:flex', sidebarCollapsed ? '-translate-x-full invisible' : 'translate-x-0 visible')}
    >
      {sidebar}
    </aside>

    <Sheet open={mobileNavOpen} onOpenChange={onMobileNavOpenChange}>
      <SheetContent id="mobile-navigation" side="left" className="w-72 max-w-[85vw] gap-0 p-0 md:hidden">
        <SheetTitle className="sr-only">Navegação principal</SheetTitle>
        <div className="flex h-full min-h-0 flex-col p-4">{sidebar}</div>
      </SheetContent>
    </Sheet>

    <div className="flex min-h-screen min-w-0 flex-col">
      <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            aria-label={mobileNavOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
            aria-controls="mobile-navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => onMobileNavOpenChange(!mobileNavOpen)}
          >
            {mobileNavOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden shrink-0 md:inline-flex"
            aria-label={sidebarCollapsed ? 'Mostrar menu lateral' : 'Ocultar menu lateral'}
            aria-controls="desktop-navigation"
            aria-expanded={!sidebarCollapsed}
            title={(sidebarCollapsed ? 'Mostrar' : 'Ocultar') + ' menu lateral (Ctrl+B)'}
            onClick={onToggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </Button>
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Workspace</span>
            <span aria-hidden="true" className="hidden sm:inline">/</span>
            <div className="min-w-0 truncate font-medium text-foreground">{breadcrumbs}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:inline-flex" role="status">
            <Circle aria-hidden="true" className="size-2 fill-emerald-600 text-emerald-600" />
            Serviço ativo
          </span>
          <Button type="button" variant="ghost" size="icon" className="rounded-full bg-accent text-xs font-bold text-accent-foreground" onClick={onSignOut} aria-label="Sair">
            <span aria-hidden="true">AU</span>
          </Button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex w-full min-w-0 flex-1 flex-col outline-none">
        {children}
      </main>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <span>Project Tasks MCP</span>
        <span className="max-w-full truncate">{projectName ?? ''}</span>
      </footer>
    </div>

    {notice && <div className={cn('fixed bottom-4 right-4 z-[100] flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg', hasError ? 'border-destructive/30 text-destructive' : 'border-border text-foreground')} role={hasError ? 'alert' : 'status'} aria-live={hasError ? 'assertive' : 'polite'} aria-atomic="true">
      <span className="min-w-0 flex-1 break-words">{notice.message}</span>
      <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-1 size-7 shrink-0" onClick={onDismissNotice} aria-label="Dispensar aviso">
        <X aria-hidden="true" />
      </Button>
    </div>}
  </div>;
}
