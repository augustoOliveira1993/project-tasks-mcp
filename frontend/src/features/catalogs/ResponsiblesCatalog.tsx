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
import { buttonPrimary } from '../../components/ui/classes';
import {
  emptyState, emptyText, emptyTitle, rowId, screen, screenAction, screenDescription, screenHeading, screenTitle, sectionDescription, sectionHeading, sectionTitle,
  tableCard, tableResponsibles, tableScroll, tdCell, thCell
} from './catalogClasses';

type KindFilter = 'todos' | 'pessoa' | 'agente';

const filterBase = 'min-h-[30px] rounded-full border px-3 text-[12px] font-semibold';
const filterTones = {
  active: 'border-[#4b4fcb] bg-[#eef0ff] text-[#4b4fcb]',
  idle: 'border-line-strong bg-white text-ink-2'
};

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

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Responsáveis</h2><p className={screenDescription}>Pessoas e agentes de IA que podem receber tarefas. Cada cadastro gera os tokens e define os projetos de acesso.</p></div><button type="button" className={`${buttonPrimary} ${screenAction}`} aria-expanded={creating} onClick={() => setCreating(open => !open)}>{creating ? 'Fechar cadastro' : 'Novo responsável'}</button></div>
    {creating && <ResponsibleRegistration key={token} token={token} projects={projects} currentProjectId={project?._id ?? ''} systemAdmin={systemAdmin} knownEmails={items.map(item => item.email)} notify={notify} onChanged={async () => { await query.refetch(); await onChanged(); }} />}
    <section className={tableCard} aria-labelledby="responsibles-title">
      <div className={sectionHeading}><div><h3 id="responsibles-title" className={sectionTitle}>Responsáveis cadastrados</h3><p className={sectionDescription}>{systemAdmin ? 'Todos os projetos e agentes' : `Pessoas com acesso a ${project?.name ?? 'o projeto ativo'}`} · {plural(items.length, 'responsável', 'responsáveis')}</p></div></div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex h-[34px] max-w-[420px] min-w-[260px] flex-[1_1_260px] items-center gap-2 rounded-[7px] border border-[#e3e7ef] px-2.5 text-[#9ba5b4] focus-within:border-[#929ef2] focus-within:shadow-[0_0_0_3px_#596ce31a]"><input className="w-full min-w-0 border-0 text-[12px] text-[#394558] shadow-none" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por e-mail ou projeto" aria-label="Buscar responsáveis" /></label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">{([['todos', 'Todos'], ['pessoa', 'Pessoas'], ['agente', 'Agentes']] as const).map(([id, label]) => <button type="button" key={id} className={`${filterBase} ${kind === id ? filterTones.active : filterTones.idle}`} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div>
      </div>
      {query.isPending ? <Skeleton rows={4} label="Carregando responsáveis…" /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} title="Não foi possível listar os responsáveis" /> : visible.length ? <div className={tableScroll}><table className={tableResponsibles}>
        <thead><tr><th className={thCell}>Responsável</th><th className={thCell}>Tipo</th><th className={thCell}>Projetos com acesso</th><th className={thCell}>Tokens ativos</th><th className={thCell}>Desde</th></tr></thead>
        <tbody>{visible.map(item => <tr key={item.email} className="hover:bg-[#fbfcff]">
          <td className={tdCell}><Person identity={item.email} /><small className={rowId}>{item.email}</small></td>
          <td className={tdCell}><span className="inline-flex flex-wrap gap-1">{item.kinds.map(value => <Badge key={value} tone={value === 'agente' ? 'blue' : 'green'}>{value === 'agente' ? 'Agente de IA' : 'Pessoa'}</Badge>)}{item.systemAdmin && <Badge tone="amber">Admin do sistema</Badge>}</span></td>
          <td className={tdCell}>{item.projects.length ? <span className="block max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.projects.join(', ')}>{item.projects.join(', ')}</span> : <span className="text-muted-strong">{item.kinds.includes('agente') ? 'Global (agentes)' : '—'}</span>}</td>
          <td className={tdCell}>{item.tokens}</td>
          <td className={tdCell}><time dateTime={item.since}>{formatDate(item.since)}</time></td>
        </tr>)}</tbody>
      </table></div> : <div className={emptyState}><h3 className={emptyTitle}>{items.length ? 'Nenhum responsável nesse filtro' : 'Nenhum responsável cadastrado'}</h3><p className={emptyText}>{items.length ? 'Ajuste a busca ou o tipo.' : 'Use “Novo responsável” para cadastrar o primeiro e gerar os tokens.'}</p></div>}
    </section>
  </section>;
}
