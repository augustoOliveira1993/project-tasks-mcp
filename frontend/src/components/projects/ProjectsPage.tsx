import type { ProjectSummary } from '../../api';
import { Badge } from '../ui/Badge';
import { ExpandableMarkdown } from '../ui/ExpandableMarkdown';
import { projectStats } from '../../features/projects/stats';

const eyebrowInHeading = 'font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]';
const searchField = 'flex h-[34px] min-w-[260px] flex-1 items-center gap-2 rounded-[7px] border border-[#e3e7ef] px-2.5 text-[#9ba5b4] focus-within:border-[#929ef2] focus-within:shadow-[0_0_0_3px_#596ce31a]';
const cardBase = 'flex min-w-0 flex-col gap-2.5 rounded-[15px] border bg-white p-4 [&>p]:line-clamp-2 [&>p]:min-h-[34px]';
const card = `${cardBase} border-[#e9ecf3]`;
const cardSelected = `${cardBase} border-[#cbd2ff] shadow-[inset_3px_0_#6574df]`;
const avatar = 'grid size-[29px] shrink-0 basis-[29px] place-items-center rounded-[8px] bg-[#e9edff] font-display text-[12px] leading-[normal] font-bold text-[#4b5bcc]';
const fullButton = 'mt-0.5 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-ui-lg border px-3 text-[12px] font-bold transition';
const fullPrimary = `${fullButton} border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const fullSecondary = `${fullButton} border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`;
const smallIcon = 'inline-grid size-[27px] shrink-0 place-items-center rounded-[7px] border border-transparent bg-transparent text-[15px] text-[#8792a2] hover:text-[#4c5bc9] enabled:hover:border-[#e8eaf5] enabled:hover:bg-[#f6f7fc]';

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
  onOpenOverview: () => void;
};

export function ProjectsPage({ projects, isPending, activeProjectId, search, currentPage, pages, total, onSearchChange, onPageChange, onSelect, onOpenOverview }: ProjectsPageProps) {
  return <section className="rounded-xl border border-slate-200 bg-white p-[22px] shadow-sm max-[760px]:p-[15px]">
    <div className="mb-[11px] flex flex-wrap items-center justify-between gap-3.5"><div><p className={eyebrowInHeading}>WORKSPACE</p><h1 className="mb-1 font-display text-[22px] leading-[normal] font-[750] tracking-[-.03em] text-[#273245]">Projetos acessíveis</h1><p className="m-0 text-[10px] text-muted-strong">Escolha um projeto para abrir sua fila de tarefas ou compare o desempenho geral.</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" className="min-h-9 rounded-ui-md border border-line-strong bg-surface px-3 text-ui-xs font-semibold text-tone-blue hover:border-focus hover:bg-tone-blue-bg" onClick={onOpenOverview}>Visão geral</button><Badge>{total} projeto(s)</Badge></div></div>
    <label className={`${searchField} my-[18px] w-[min(420px,100%)]`}><span className="grid place-items-center text-[17px]">⌕</span><input className="w-full min-w-0 border-0 text-ui-sm text-[#394558] focus:shadow-none" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar projeto" aria-label="Buscar projeto" /></label>
    {isPending ? <div className="px-[18px] py-7 text-center text-[11px] text-[#8792a2]">Carregando projetos…</div> : projects.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-[13px]">{projects.map(item => {
      const stats = projectStats(item);
      const selected = item.project._id === activeProjectId;
      return <article className={selected ? cardSelected : card} key={item.project._id}>
        <div className="flex items-center justify-between"><span className={avatar}>{item.project.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><Badge tone={item.project.visibility === 'private' ? 'amber' : 'green'}>{item.project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge></div>
        <h2 className="text-[14px] font-bold text-[#344156] wrap-anywhere">{item.project.name}</h2><ExpandableMarkdown content={item.project.description} />
        <div className="flex flex-wrap items-baseline justify-between gap-1.5 text-ui-xs text-muted-strong"><span title="Inclui tarefas arquivadas e canceladas. A fila de tarefas do projeto mostra apenas as não arquivadas.">{stats.total} tasks no total</span><span>{stats.completed} concluídas</span><strong className="text-ui-md text-ink">{stats.progress}%</strong></div>
        <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={'Progresso de ' + item.project.name} aria-valuenow={stats.progress} aria-valuemin={0} aria-valuemax={100} title="Concluídas sobre as tarefas ativas (cancelamentos não contam)"><span className="block h-full rounded-full bg-indigo-600" style={{ width: stats.progress + '%' }} /></span>
        <button type="button" className={selected ? fullSecondary : fullPrimary} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(item.project._id)}>{selected ? 'Abrir projeto ativo' : 'Abrir tasks'}</button>
      </article>;
    })}</div> : <div className="grid justify-items-center gap-2 px-3.5 py-[30px] text-center"><h2 className="font-display text-[16px] leading-[normal] font-bold text-[#394558]">{total ? 'Nenhum projeto encontrado' : 'Nenhum projeto disponível'}</h2><p className="mb-2 text-[11px] text-[#8993a3]">{total ? 'Tente buscar por outro nome.' : 'Esta credencial ainda não possui projetos acessíveis.'}</p></div>}
    <footer className="flex flex-wrap items-center justify-between gap-3.5 px-5 py-3 text-ui-xs text-muted-strong max-[760px]:px-[13px] max-[760px]:py-[11px]"><span>{total} projeto(s)</span><div className="flex items-center gap-2.5 text-ui-xs max-[760px]:ml-auto"><button className={smallIcon} disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} aria-label="Página anterior">‹</button><span>{currentPage} de {pages}</span><button className={smallIcon} disabled={currentPage >= pages} onClick={() => onPageChange(currentPage + 1)} aria-label="Próxima página">›</button></div></footer>
  </section>;
}
