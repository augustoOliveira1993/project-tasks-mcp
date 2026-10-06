import { useState } from 'react';
import type { Project } from '../../api';
import { ResponsibleRegistration } from '../../components/admin/ResponsibleRegistration';
import { Badge } from '../../components/ui/Badge';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { Skeleton } from '../../components/ui/Skeleton';
import { Person } from '../../components/ui/Person';
import { formatDate } from '../../lib/format';
import { plural } from '../../lib/labels';
import { useResponsibles, type Responsible } from '../responsibles/responsibles';

type KindFilter = 'todos' | 'pessoa' | 'agente';

export function filterResponsibles(items: Responsible[], search: string, kind: KindFilter) {
  const needle = search.trim().toLocaleLowerCase('pt-BR');
  return items.filter(item => (kind === 'todos' || item.kinds.includes(kind)) && (!needle || item.email.toLocaleLowerCase('pt-BR').includes(needle) || item.projects.some(name => name.toLocaleLowerCase('pt-BR').includes(needle))));
}

export function ResponsiblesCatalog({ token, nonce, projects, project, systemAdmin, notify, onChanged }: {
  token: string; nonce: string; projects: Project[]; project?: Project; systemAdmin: boolean;
  notify: (message: string, kind?: string) => void; onChanged: () => void | Promise<unknown>;
}) {
  const query = useResponsibles(token, nonce, project?._id ?? '', systemAdmin);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('todos');
  const items = query.data ?? [];
  const visible = filterResponsibles(items, search, kind);

  return <section className="catalog-record-screen">
    <div className="catalog-screen-heading"><div><h2>Responsáveis</h2><p className="muted-text">Pessoas e agentes de IA que podem receber tarefas. Cada cadastro gera os tokens e define os projetos de acesso.</p></div><button type="button" className="button primary" aria-expanded={creating} onClick={() => setCreating(open => !open)}>{creating ? 'Fechar cadastro' : 'Novo responsável'}</button></div>
    {creating && <ResponsibleRegistration key={token} token={token} projects={projects} currentProjectId={project?._id ?? ''} systemAdmin={systemAdmin} knownEmails={items.map(item => item.email)} notify={notify} onChanged={async () => { await query.refetch(); await onChanged(); }} />}
    <section className="panel-card catalog-table-card" aria-labelledby="responsibles-title">
      <div className="section-heading"><div><h3 id="responsibles-title">Responsáveis cadastrados</h3><p className="muted-text">{systemAdmin ? 'Todos os projetos e agentes' : `Pessoas com acesso a ${project?.name ?? 'o projeto ativo'}`} · {plural(items.length, 'responsável', 'responsáveis')}</p></div></div>
      <div className="responsible-filters">
        <label className="search-field"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por e-mail ou projeto" aria-label="Buscar responsáveis" /></label>
        <div className="criteria-filters" role="group" aria-label="Filtrar por tipo">{([['todos', 'Todos'], ['pessoa', 'Pessoas'], ['agente', 'Agentes']] as const).map(([id, label]) => <button type="button" key={id} className={'criteria-filter' + (kind === id ? ' active' : '')} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div>
      </div>
      {query.isPending ? <Skeleton rows={4} label="Carregando responsáveis…" /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} title="Não foi possível listar os responsáveis" /> : visible.length ? <div className="table-scroll"><table className="catalog-table responsible-table">
        <thead><tr><th>Responsável</th><th>Tipo</th><th>Projetos com acesso</th><th>Tokens ativos</th><th>Desde</th></tr></thead>
        <tbody>{visible.map(item => <tr key={item.email}>
          <td><Person identity={item.email} /><small className="catalog-row-id">{item.email}</small></td>
          <td><span className="responsible-kinds">{item.kinds.map(value => <Badge key={value} tone={value === 'agente' ? 'blue' : 'green'}>{value === 'agente' ? 'Agente de IA' : 'Pessoa'}</Badge>)}{item.systemAdmin && <Badge tone="amber">Admin do sistema</Badge>}</span></td>
          <td>{item.projects.length ? <span className="responsible-projects" title={item.projects.join(', ')}>{item.projects.join(', ')}</span> : <span className="muted-text">{item.kinds.includes('agente') ? 'Global (agentes)' : '—'}</span>}</td>
          <td>{item.tokens}</td>
          <td><time dateTime={item.since}>{formatDate(item.since)}</time></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state compact"><h3>{items.length ? 'Nenhum responsável nesse filtro' : 'Nenhum responsável cadastrado'}</h3><p>{items.length ? 'Ajuste a busca ou o tipo.' : 'Use “Novo responsável” para cadastrar o primeiro e gerar os tokens.'}</p></div>}
    </section>
  </section>;
}
