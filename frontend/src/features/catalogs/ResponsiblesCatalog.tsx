import { useState } from 'react';
import type { Project } from '../../api';
import { ResponsibleRegistration } from './components/ResponsibleRegistration';
import { ResponsibleEditorDialog } from './components/ResponsibleEditorDialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Person } from '../../components/ui/Person';
import { formatDate } from '../../lib/format';
import { plural } from '../../lib/labels';
import { useResponsibles, type Responsible } from '../responsibles/responsibles';
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
  const [editing, setEditing] = useState<Responsible | null>(null);
  const items = query.data ?? [];
  const visible = filterResponsibles(items, search, kind);

  return <section className={screen}>
    <div className={screenHeading}><div><h2 className={screenTitle}>Responsáveis</h2><p className={screenDescription}>Pessoas e agentes de IA que podem receber tarefas. Cada cadastro gera os tokens e define os projetos de acesso.</p></div><Button type="button" variant="default" className={screenAction} aria-haspopup="dialog" aria-expanded={creating} onClick={() => setCreating(true)}>Novo responsável</Button></div>
    {creating && <ResponsibleRegistration key={token} open={creating} onOpenChange={setCreating} token={token} projects={projects} currentProjectId={project?._id ?? ''} systemAdmin={systemAdmin} knownEmails={items.map(item => item.email)} notify={notify} onChanged={async () => { await query.refetch(); await onChanged(); }} />}
    <section className={tableCard} aria-labelledby="responsibles-title">
      <div className={sectionHeading}><div><h3 id="responsibles-title" className={sectionTitle}>Responsáveis cadastrados</h3><p className={sectionDescription}>{systemAdmin ? 'Todos os projetos e agentes' : `Pessoas com acesso a ${project?.name ?? 'o projeto ativo'}`} · {plural(items.length, 'responsável', 'responsáveis')}</p>{!systemAdmin && <p className="mt-1 text-xs text-muted-foreground">Edição de fotos e revogação de tokens exigem administração do sistema.</p>}</div></div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex h-9 max-w-[420px] min-w-[260px] flex-[1_1_260px] items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30"><span className="sr-only">Buscar responsáveis</span><Input className="h-8 min-h-0 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por e-mail ou projeto" aria-label="Buscar responsáveis" /></label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">{([['todos', 'Todos'], ['pessoa', 'Pessoas'], ['agente', 'Agentes']] as const).map(([id, label]) => <Button type="button" variant={kind === id ? 'secondary' : 'outline'} key={id} className={`${filterBase} ${kind === id ? filterTones.active : filterTones.idle}`} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</Button>)}</div>
      </div>
      {query.isPending ? <SkeletonRows rows={4} label="Carregando responsáveis…" /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} title="Não foi possível listar os responsáveis" /> : visible.length ? <div className={tableScroll}><Table className={tableResponsibles}>
        <TableHeader><TableRow><TableHead className={thCell}>Responsável</TableHead><TableHead className={thCell}>Tipo</TableHead><TableHead className={thCell}>Projetos com acesso</TableHead><TableHead className={thCell}>Tokens ativos</TableHead><TableHead className={thCell}>Desde</TableHead>{systemAdmin && <TableHead className={thCell}><span className="sr-only">Ações</span></TableHead>}</TableRow></TableHeader>
        <TableBody>{visible.map(item => <TableRow key={item.email} className="hover:bg-[#fbfcff]">
          <TableCell className={tdCell}><Person identity={item.email} avatarUrl={item.avatarUrl} /><small className={rowId}>{item.email}</small></TableCell>
          <TableCell className={tdCell}><span className="inline-flex flex-wrap gap-1">{item.kinds.map(value => <Badge key={value} variant={value === 'agente' ? 'info' : 'success'}>{value === 'agente' ? 'Agente de IA' : 'Pessoa'}</Badge>)}{item.systemAdmin && <Badge variant="warning">Admin do sistema</Badge>}</span></TableCell>
          <TableCell className={tdCell}>{item.projects.length ? <span className="block max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.projects.join(', ')}>{item.projects.join(', ')}</span> : <span className="text-muted-strong">{item.kinds.includes('agente') ? 'Global (agentes)' : '—'}</span>}</TableCell>
          <TableCell className={tdCell}>{item.tokens}</TableCell>
          <TableCell className={tdCell}><time dateTime={item.since}>{formatDate(item.since)}</time></TableCell>
          {systemAdmin && <TableCell className={tdCell}><Button type="button" variant="outline" size="sm" onClick={() => setEditing(item)}>Editar</Button></TableCell>}
        </TableRow>)}</TableBody>
      </Table></div> : <div className={emptyState}><h3 className={emptyTitle}>{items.length ? 'Nenhum responsável nesse filtro' : 'Nenhum responsável cadastrado'}</h3><p className={emptyText}>{items.length ? 'Ajuste a busca ou o tipo.' : 'Use “Novo responsável” para cadastrar o primeiro e gerar os tokens.'}</p></div>}
    </section>
    {systemAdmin && editing && <ResponsibleEditorDialog open token={token} nonce={nonce} email={editing.email} avatarUrl={editing.avatarUrl} onOpenChange={open => { if (!open) setEditing(null); }} notify={notify} onChanged={async () => { await query.refetch(); await onChanged(); }} />}
  </section>;
}
