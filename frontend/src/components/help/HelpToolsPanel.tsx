import { Badge } from '../ui/Badge';
import { toolDocs, toolServers } from '../../tool-catalog';

const searchField = 'mt-[17px] mb-[9px] flex h-[34px] max-w-[520px] min-w-[260px] flex-1 items-center gap-2 rounded-[7px] border border-[#e3e7ef] px-2.5 text-[#9ba5b4] focus-within:border-[#929ef2] focus-within:shadow-[0_0_0_3px_#596ce31a]';

export function HelpToolsPanel({ search, onSearchChange }: { search: string; onSearchChange: (value: string) => void }) {
  const tools = toolDocs.filter(([group, name, description, mode]) =>
    (group + ' ' + name + ' ' + description + ' ' + mode + ' ' + toolServers(name).join(' ') + ' project_tasks project_tasks_git')
      .toLocaleLowerCase('pt-BR')
      .includes(search.toLocaleLowerCase('pt-BR'))
  );

  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-[11px] flex items-center justify-between gap-3.5">
      <div><h2 className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]">Ferramentas MCP</h2><p className="m-0 text-[10px] text-muted-strong">Recursos expostos pelo servidor e pela bridge local</p></div>
      <Badge tone="green">{tools.length} de {toolDocs.length}</Badge>
    </div>
    <label className={searchField}><span className="grid place-items-center text-[17px]">⌕</span><input className="w-full min-w-0 border-0 text-ui-sm text-[#394558] focus:shadow-none" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar ferramenta ou finalidade" /></label>
    {tools.length ? <div className="grid grid-cols-2 gap-[7px] max-[760px]:grid-cols-[1fr]">{tools.map(([group, name, description, mode]) => <article className="flex items-start gap-[11px] rounded-[9px] border border-[#edf0f4] p-[13px]" key={name}>
      <div className="grid size-[27px] shrink-0 basis-[27px] place-items-center rounded-[7px] bg-[#f0f2ff] text-[#5969d2]">⌘</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-[7px]"><strong className="font-code text-[10px] leading-[normal] font-[650] text-[#414c5e] wrap-anywhere">{name}</strong><Badge tone={mode === 'Leitura' ? 'green' : 'amber'}>{mode}</Badge></div>
        <small className="mt-[5px] block text-[9px] font-semibold text-[#7b8494]">{group}</small>
        <p className="mt-[5px] mb-2 text-[9px] leading-normal text-[#8b95a4]">{description}</p>
        <div className="flex flex-wrap gap-1">{toolServers(name).map(server => <Badge key={server} tone="blue">{server}</Badge>)}</div>
      </div>
    </article>)}</div> : <div className="grid justify-items-center gap-2 px-3.5 py-[30px] text-center"><h3 className="font-display text-[13px] leading-[normal] font-bold text-[#394558]">Nenhuma ferramenta encontrada</h3><p className="mb-2 text-[11px] text-[#8993a3]">Experimente buscar por nome, categoria ou finalidade.</p></div>}
  </section>;
}
