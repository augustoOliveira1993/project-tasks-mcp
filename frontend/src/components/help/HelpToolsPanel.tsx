import { Badge } from '../ui/Badge';
import { toolDocs, toolServers } from '../../tool-catalog';

export function HelpToolsPanel({ search, onSearchChange }: { search: string; onSearchChange: (value: string) => void }) {
  const tools = toolDocs.filter(([group, name, description, mode]) =>
    (group + ' ' + name + ' ' + description + ' ' + mode + ' ' + toolServers(name).join(' ') + ' project_tasks project_tasks_git')
      .toLocaleLowerCase('pt-BR')
      .includes(search.toLocaleLowerCase('pt-BR'))
  );

  return <section className="panel-card help-panel">
    <div className="section-heading">
      <div><h2>Ferramentas MCP</h2><p className="muted-text">Recursos expostos pelo servidor e pela bridge local</p></div>
      <Badge tone="green">{tools.length} de {toolDocs.length}</Badge>
    </div>
    <label className="search-field help-search"><span>⌕</span><input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar ferramenta ou finalidade" /></label>
    {tools.length ? <div className="tool-list">{tools.map(([group, name, description, mode]) => <article className="tool-row" key={name}>
      <div className="tool-icon">⌘</div>
      <div className="tool-details">
        <div className="tool-title"><strong>{name}</strong><Badge tone={mode === 'Leitura' ? 'green' : 'amber'}>{mode}</Badge></div>
        <small className="tool-category">{group}</small>
        <p>{description}</p>
        <div className="tool-servers">{toolServers(name).map(server => <Badge key={server} tone="blue">{server}</Badge>)}</div>
      </div>
    </article>)}</div> : <div className="empty-state compact"><h3>Nenhuma ferramenta encontrada</h3><p>Experimente buscar por nome, categoria ou finalidade.</p></div>}
  </section>;
}
