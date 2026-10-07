import type { ProjectSummary } from '../../api';
import { Badge } from '../ui/Badge';
import { projectStats } from '../../features/projects/stats';
import { plainText } from '../../lib/labels';

const dialog = [
  'max-h-[90vh] w-[min(100%,760px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl backdrop:bg-[#16203370] backdrop:backdrop-blur-[3px]',
  'open:fixed open:top-1/2 open:right-auto open:bottom-auto open:left-1/2 open:m-0 open:flex open:-translate-x-1/2 open:-translate-y-1/2 open:flex-col open:overflow-hidden open:p-0',
  'open:w-[min(600px,calc(100vw_-_32px))] open:max-h-[min(760px,calc(100dvh_-_32px))] open:rounded-[18px] open:border-[#e6e9f1] open:shadow-[0_24px_70px_#18223030]',
  'max-[480px]:open:w-[calc(100vw_-_20px)] max-[480px]:open:max-h-[calc(100dvh_-_24px)] max-[480px]:open:rounded-[15px]'
].join(' ');
const header = 'flex shrink-0 items-center justify-between gap-4 border-b border-b-[#edf0f4] px-6 pt-[22px] pb-[17px] max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px] max-[480px]:pt-[18px] max-[480px]:pb-[14px]';
const closeButton = 'inline-grid size-[38px] shrink-0 place-items-center rounded-[11px] border border-[#e7eaf1] bg-[#f8f9fc] text-[23px] text-[#738093] transition-[border-color,background,color] duration-150 ease-[ease] hover:border-[#d7dcf4] hover:bg-[#eef0ff] hover:text-[#4e5ece]';
const searchField = 'mx-5 mt-4 mb-[13px] flex h-[34px] w-auto min-w-[260px] flex-none items-center gap-2 rounded-[7px] border border-[#e3e7ef] px-2.5 text-[#9ba5b4] focus-within:border-[#929ef2] focus-within:shadow-[0_0_0_3px_#596ce31a] max-[480px]:mx-3.5 max-[480px]:mt-[13px] max-[480px]:mb-[11px]';
const optionBase = 'grid w-full min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] border p-[13px] text-left transition-[border-color,background,box-shadow] duration-150 ease-[ease] max-[480px]:grid-cols-[34px_minmax(0,1fr)] max-[480px]:items-start max-[480px]:gap-x-2.5 max-[480px]:gap-y-[7px] max-[480px]:p-[11px]';
const option = `${optionBase} border-[#edf0f5] bg-white hover:border-[#dce1fa] hover:bg-[#fafbff]`;
const optionSelected = `${optionBase} border-[#cbd2ff] bg-[#f6f7ff] shadow-[inset_3px_0_#6574df]`;
const avatarBase = 'grid size-[29px] shrink-0 basis-[29px] place-items-center rounded-[8px] font-display text-[12px] leading-[normal] font-bold text-[#4b5bcc] max-[480px]:row-span-2 max-[480px]:size-[34px]';
const avatar = `${avatarBase} bg-[#e9edff]`;
const avatarSelected = `${avatarBase} bg-[#e1e5ff]`;
const footer = 'flex shrink-0 flex-wrap items-center justify-between gap-3.5 border-t border-t-[#edf0f5] bg-[#fbfcfe] px-5 py-3 text-ui-xs text-muted-strong max-[760px]:px-[13px] max-[760px]:py-[11px] max-[480px]:px-[15px]';
const smallIcon = 'inline-grid size-[27px] shrink-0 place-items-center rounded-[7px] border border-transparent bg-transparent text-[15px] text-[#8792a2] hover:text-[#4c5bc9] enabled:hover:border-[#e8eaf5] enabled:hover:bg-[#f6f7fc]';

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
  return <dialog id="projects-dialog" className={dialog} aria-labelledby="projects-title">
    <header className={header}><div><p className="mb-[7px] font-display text-[9px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]">WORKSPACE</p><h2 id="projects-title" className="mb-[5px] font-display text-[19px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]">Projetos acessíveis</h2><p className="m-0 text-[10px] text-muted-strong">Selecione um projeto para torná-lo ativo.</p></div><form method="dialog"><button type="submit" className={closeButton} aria-label="Fechar">×</button></form></header>
    <label className={searchField}><span className="grid place-items-center text-[17px]">⌕</span><input className="w-full min-w-0 border-0 text-ui-sm text-[#394558] focus:shadow-none" autoFocus value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar projeto" /></label>
    <div className="grid min-h-0 flex-auto gap-2 overflow-y-auto overscroll-contain px-4 pb-4 max-[480px]:gap-[7px] max-[480px]:px-3 max-[480px]:pb-3">{projects.length ? projects.map(item => { const stats = projectStats(item); const selected = item.project._id === activeProjectId; return <button className={selected ? optionSelected : option} key={item.project._id} aria-pressed={item.project._id === activeProjectId} onClick={() => onSelect(item.project._id)}>
      <span className={selected ? avatarSelected : avatar}>{item.project.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><span className="grid min-w-0 flex-1 gap-1"><strong className="truncate text-[12px] font-[650] text-[#344156]">{item.project.name}</strong><small className="truncate text-[11px] text-[#7f8a9b]">{plainText(item.project.description) || 'Sem descrição'}</small><small className="truncate text-[11px] text-[#7f8a9b]">{stats.total} tarefas · {stats.completed} concluídas · {stats.progress}%</small><span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-indigo-600" style={{ width: stats.progress + '%' }} /></span></span><Badge tone={item.project.visibility === 'private' ? 'amber' : 'green'} className="mt-px self-start max-[480px]:col-start-2 max-[480px]:justify-self-start">{item.project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge>
    </button>; }) : <div className="grid justify-items-center gap-2 self-center justify-self-center px-3.5 py-[30px] text-center"><h3 className="font-display text-[13px] leading-[normal] font-bold text-[#394558]">Nenhum projeto encontrado</h3><p className="mb-2 text-[11px] text-[#8993a3]">Tente buscar por outro nome.</p></div>}</div>
    <footer className={footer}><span>{total} projeto(s)</span><div className="flex items-center gap-2.5 text-ui-xs max-[760px]:ml-auto"><button className={smallIcon} disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>‹</button><span>{currentPage} de {pages}</span><button className={smallIcon} disabled={currentPage >= pages} onClick={() => onPageChange(currentPage + 1)}>›</button></div></footer>
  </dialog>;
}
