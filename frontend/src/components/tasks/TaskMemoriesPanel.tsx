import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, operationId, query } from '../../api';
import type { ApiPage } from '../../api';
import { FeatureLink, TaskLink } from '../ui/Links';
import { MarkdownView } from '../ui/MarkdownView';
import { ErrorNotice } from '../ui/ErrorNotice';
import { buttonPrimary, buttonSecondary, buttonSecondarySmall, notice } from '../ui/classes';

type MemoryCategory = 'decision' | 'architecture' | 'convention' | 'domain_fact';
type MemoryStatus = 'active' | 'superseded';
type SourceKind = 'task' | 'feature' | 'execution' | 'document' | 'diff';
type MemorySource = {
  kind: SourceKind;
  id: string;
  title?: string;
  revision?: number;
  area?: string;
  featureId?: string;
};
type TaskMemory = {
  _id: string;
  version: number;
  scope: 'task';
  ownerTaskId: string;
  title: string;
  category: MemoryCategory;
  status: MemoryStatus;
  revision: number;
  sources: MemorySource[];
};
type TaskMemoryDetail = TaskMemory & { content: string };
type MemoryDraft = {
  title: string;
  category: MemoryCategory;
  status: MemoryStatus;
  content: string;
  sources: Array<{ kind: SourceKind; id: string; revision: string }>;
  version?: number;
};

const categories: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'decision', label: 'Decisão' },
  { value: 'architecture', label: 'Arquitetura' },
  { value: 'convention', label: 'Convenção' },
  { value: 'domain_fact', label: 'Fato de domínio' }
];
const categoryLabels = Object.fromEntries(categories.map(item => [item.value, item.label])) as Record<MemoryCategory, string>;
const sourceKinds: Array<{ value: SourceKind; label: string }> = [
  { value: 'task', label: 'Tarefa' },
  { value: 'feature', label: 'Feature' },
  { value: 'execution', label: 'Execução' },
  { value: 'document', label: 'Documento' },
  { value: 'diff', label: 'Diff' }
];
const inputClass = 'min-h-9 w-full min-w-0 rounded-ui-sm border border-line-strong bg-white px-2.5 text-ui-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#4b4fcb]';
const labelClass = 'grid min-w-0 gap-1.5 text-ui-xs font-semibold text-muted-strong';
const panelClass = 'grid min-w-0 gap-4 rounded-ui-md border border-line bg-surface p-4';

function DocumentSource({ token, projectId, source }: { token: string; projectId: string; source: MemorySource }) {
  const [isOpen, setIsOpen] = useState(false);
  const documentQuery = useQuery({
    queryKey: ['task-memory-source-document', projectId, source.id, source.revision],
    enabled: Boolean(token && projectId && isOpen),
    queryFn: () => query<{ content: string }>(token, 'get_markdown', {
      projectId, id: source.id, line: 1, limit: 200, ...(source.revision ? { revision: source.revision } : {})
    })
  });
  return <div className="grid min-w-0 gap-2">
    <button type="button" className="wrap-anywhere text-left text-ui-xs font-semibold text-tone-blue underline underline-offset-2" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>{source.title ?? 'Abrir documento fonte'}{source.revision ? ` · rev. ${source.revision}` : ''}</button>
    {isOpen && <>
      {documentQuery.isPending && <span className="text-ui-xs text-muted-strong" role="status">Carregando documento…</span>}
      {documentQuery.isError && <ErrorNotice error={documentQuery.error} onRetry={() => void documentQuery.refetch()} retrying={documentQuery.isFetching} />}
      {documentQuery.data && <MarkdownView content={documentQuery.data.content} variant="compact" className="max-h-72 overflow-auto rounded-ui-sm bg-canvas p-3" />}
    </>}
  </div>;
}

function SourceList({ sources, projectId, token }: { sources: MemorySource[]; projectId: string; token: string }) {
  if (!sources.length) return <p className="text-ui-xs text-muted-strong">Nenhuma fonte registrada.</p>;
  return <ul className="grid min-w-0 gap-2">
    {sources.map((source, index) => <li key={`${source.kind}:${source.id}:${source.revision ?? ''}:${index}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="shrink-0 rounded-ui-sm bg-canvas px-1.5 py-1 text-[10px] text-muted-strong">{sourceKinds.find(item => item.value === source.kind)?.label ?? source.kind}{source.revision ? ` · rev. ${source.revision}` : ''}</span>
      {source.kind === 'task' ? <TaskLink taskId={source.id} name={source.title ?? 'Fonte de tarefa'} projectId={projectId} title="Abrir tarefa de origem" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Abrir tarefa de origem'}</TaskLink>
        : source.kind === 'feature' ? <FeatureLink featureId={source.id} name={source.title ?? 'Feature de origem'} projectId={projectId} title="Abrir feature de origem" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Abrir feature de origem'}</FeatureLink>
          : source.kind === 'document' ? <DocumentSource token={token} projectId={projectId} source={source} />
            : <span className="wrap-anywhere text-ui-xs font-semibold text-ink-2">{source.title ?? source.kind}</span>}
      <code className="max-w-full break-all text-[10px] text-muted-strong">{source.id}</code>
    </li>)}
  </ul>;
}

function emptyDraft(taskId: string): MemoryDraft {
  return { title: '', category: 'convention', status: 'active', content: '', sources: [{ kind: 'task', id: taskId, revision: '' }] };
}

export function TaskMemoriesPanel({ token, projectId, taskId, taskName }: { token: string; projectId: string; taskId: string; taskName: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<MemoryStatus>('active');
  const [draft, setDraft] = useState<MemoryDraft | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState('');
  const [openMemoryId, setOpenMemoryId] = useState('');
  const [viewRevision, setViewRevision] = useState<number | undefined>();
  const [message, setMessage] = useState('');

  const memoriesQuery = useInfiniteQuery({
    queryKey: ['task-memories', projectId, taskId, status],
    enabled: Boolean(token && projectId && taskId),
    initialPageParam: '',
    queryFn: ({ pageParam }) => query<ApiPage<TaskMemory>>(token, 'list_project_memories', {
      projectId, scope: 'task', ownerTaskId: taskId, status, limit: 20, ...(pageParam ? { after: pageParam } : {})
    }),
    getNextPageParam: lastPage => lastPage.next ?? undefined
  });
  const memoryDetailQuery = useQuery({
    queryKey: ['task-memory-detail', projectId, taskId, openMemoryId, viewRevision ?? 'current'],
    enabled: Boolean(token && projectId && taskId && openMemoryId),
    queryFn: () => query<TaskMemoryDetail>(token, 'get_project_memory', {
      projectId, memoryId: openMemoryId, ownerTaskId: taskId, ...(viewRevision ? { revision: viewRevision } : {})
    })
  });

  const saveMemory = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Abra o formulário antes de salvar.');
      const data = {
        title: draft.title.trim(), category: draft.category, content: draft.content.trim(),
        ...(draft.version !== undefined ? { status: draft.status } : {}),
        sources: draft.sources.map(source => ({
          kind: source.kind, id: source.id.trim(),
          ...(source.revision.trim() ? { revision: Number(source.revision) } : {})
        }))
      };
      if (draft.version === undefined) return query<TaskMemoryDetail>(token, 'create_project_memory', {
        operationId: operationId(), projectId, scope: 'task', ownerTaskId: taskId, data
      });
      return query<TaskMemoryDetail>(token, 'update_project_memory', {
        operationId: operationId(), projectId, memoryId: editingMemoryId, ownerTaskId: taskId, version: draft.version, data
      });
    },
    onSuccess: async () => {
      setDraft(null);
      setEditingMemoryId('');
      setOpenMemoryId('');
      setMessage('Memória da tarefa salva.');
      await queryClient.invalidateQueries({ queryKey: ['task-memories', projectId, taskId] });
      await queryClient.invalidateQueries({ queryKey: ['task-memory-detail', projectId, taskId] });
    },
    onError: error => setMessage(error instanceof ApiRequestError && error.status === 409
      ? 'Conflito de versão ou de fonte: seu rascunho foi preservado. Recarregue a lista e compare com a revisão atual.'
      : error instanceof Error ? error.message : 'Não foi possível salvar a memória da tarefa.')
  });
  const archiveMemory = useMutation({
    mutationFn: (memory: TaskMemory) => query(token, 'archive_project_memory', {
      operationId: operationId(), projectId, memoryId: memory._id, ownerTaskId: taskId, version: memory.version
    }),
    onSuccess: async () => {
      setMessage('Memória da tarefa arquivada; o histórico foi preservado.');
      setOpenMemoryId('');
      await queryClient.invalidateQueries({ queryKey: ['task-memories', projectId, taskId] });
    },
    onError: error => setMessage(error instanceof ApiRequestError && error.status === 409
      ? 'Conflito ao arquivar: a memória foi alterada. Atualize a lista e confira a versão atual.'
      : error instanceof Error ? error.message : 'Não foi possível arquivar a memória da tarefa.')
  });

  const memories = memoriesQuery.data?.pages.flatMap(page => page.items) ?? [];

  async function beginEdit(memory: TaskMemory) {
    saveMemory.reset();
    setMessage('');
    try {
      const detail = await query<TaskMemoryDetail>(token, 'get_project_memory', { projectId, memoryId: memory._id, ownerTaskId: taskId });
      setEditingMemoryId(memory._id);
      setOpenMemoryId(memory._id);
      setViewRevision(detail.revision);
      setDraft({
        title: detail.title, category: detail.category, status: detail.status, content: detail.content,
        version: detail.version,
        sources: detail.sources.map(source => ({ kind: source.kind, id: source.id, revision: source.kind === 'document' && source.revision !== undefined ? String(source.revision) : '' }))
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar a memória da tarefa.');
    }
  }

  function changeSource(index: number, key: 'kind' | 'id' | 'revision', value: string) {
    if (!draft) return;
    setDraft({ ...draft, sources: draft.sources.map((source, sourceIndex) => sourceIndex === index
      ? { ...source, [key]: value } as MemoryDraft['sources'][number]
      : source) });
  }

  function closeDraft() {
    setDraft(null);
    setEditingMemoryId('');
    setMessage('');
  }

  return <section className={panelClass} aria-labelledby="task-memory-title">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="mb-1 font-display text-[9px] font-bold tracking-[.11em] text-[#7180d8]">CONTEXTO PRIVADO DA TAREFA</p>
        <h3 id="task-memory-title" className="font-display text-[16px] font-bold text-ink">Memórias desta tarefa</h3>
        <p className="mt-1 max-w-[75ch] text-ui-xs leading-relaxed text-muted-strong">Este acervo é propriedade de <TaskLink taskId={taskId} name={taskName} projectId={projectId} className="font-semibold text-tone-blue underline underline-offset-2">{taskName}</TaskLink>. Memórias compartilhadas do projeto continuam no acervo do projeto.</p>
      </div>
      <button type="button" className={buttonPrimary} onClick={() => { saveMemory.reset(); setDraft(emptyDraft(taskId)); setEditingMemoryId(''); setOpenMemoryId(''); setMessage(''); }}>Nova memória da tarefa</button>
    </header>

    {message && <p className={notice.info} role="status">{message}</p>}
    {saveMemory.isError && <ErrorNotice error={saveMemory.error} />}
    {archiveMemory.isError && <ErrorNotice error={archiveMemory.error} />}

    {draft && <form className="grid min-w-0 gap-3 rounded-ui-sm border border-line bg-canvas p-3" onSubmit={event => { event.preventDefault(); setMessage(''); saveMemory.mutate(); }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h4 className="text-ui-sm font-bold text-ink">{draft.version === undefined ? 'Criar memória da tarefa' : 'Editar memória da tarefa'}</h4><p className="mt-1 text-ui-xs text-muted-strong">A propriedade fica fixada nesta tarefa. A gravação registra uma revisão e exige fonte verificável.</p></div>
        <button type="button" className={buttonSecondarySmall} onClick={closeDraft}>Fechar</button>
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-3 max-[720px]:grid-cols-1">
        <label className={labelClass}>Título<input className={inputClass} maxLength={255} required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className={labelClass}>Categoria<select className={inputClass} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as MemoryCategory })}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={labelClass}>Estado<select className={inputClass} disabled={draft.version === undefined} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as MemoryStatus })}><option value="active">Ativa</option><option value="superseded">Substituída</option></select></label>
      </div>
      <label className={labelClass}>Conteúdo Markdown<textarea className="min-h-32 w-full min-w-0 resize-y rounded-ui-sm border border-line-strong bg-white p-2.5 text-ui-sm leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#4b4fcb]" maxLength={20000} required value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></label>
      <div className="grid gap-2" aria-labelledby="task-memory-sources-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 id="task-memory-sources-title" className="text-ui-xs font-bold text-ink">Fontes</h4><button type="button" className={buttonSecondarySmall} onClick={() => setDraft({ ...draft, sources: [...draft.sources, { kind: 'task', id: '', revision: '' }] })}>Adicionar fonte</button></div>
        <p className="text-ui-xs text-muted-strong">A tarefa proprietária é sempre registrada como fonte; isso não transforma memórias compartilhadas em memórias desta tarefa.</p>
        {draft.sources.map((source, index) => {
          const isOwnerSource = source.kind === 'task' && source.id === taskId;
          return <div className="grid grid-cols-[minmax(120px,.7fr)_minmax(150px,2fr)_minmax(100px,.7fr)_auto] gap-2 max-[720px]:grid-cols-1" key={index}>
            <label className={labelClass}>Tipo<select className={inputClass} disabled={isOwnerSource} value={source.kind} onChange={event => changeSource(index, 'kind', event.target.value)}>{sourceKinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className={labelClass}>{isOwnerSource ? 'Tarefa proprietária' : 'ID da fonte'}<input className={inputClass} required readOnly={isOwnerSource} value={source.id} onChange={event => changeSource(index, 'id', event.target.value)} /></label>
            <label className={labelClass}>Revisão (quando aplicável)<input className={inputClass} type="number" min="1" step="1" disabled={isOwnerSource} value={source.revision} onChange={event => changeSource(index, 'revision', event.target.value)} /></label>
            <button type="button" className={buttonSecondarySmall + ' self-end'} aria-label={'Remover fonte ' + (index + 1)} disabled={isOwnerSource || draft.sources.length <= 1} onClick={() => setDraft({ ...draft, sources: draft.sources.filter((_, sourceIndex) => sourceIndex !== index) })}>Remover</button>
          </div>;
        })}
      </div>
      {saveMemory.error instanceof ApiRequestError && saveMemory.error.status === 409 && <button type="button" className={buttonSecondarySmall + ' justify-self-start'} onClick={() => { void memoriesQuery.refetch(); void memoryDetailQuery.refetch(); }}>Recarregar estado atual para comparar</button>}
      <div className="flex flex-wrap gap-2"><button type="submit" className={buttonPrimary} disabled={saveMemory.isPending}>{saveMemory.isPending ? 'Salvando…' : 'Salvar memória'}</button><button type="button" className={buttonSecondary} onClick={closeDraft}>Cancelar</button></div>
    </form>}

    <section className="grid min-w-0 gap-3" aria-labelledby="task-memory-list-title">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h4 id="task-memory-list-title" className="text-ui-sm font-bold text-ink">Acervo desta tarefa</h4><p className="mt-1 text-ui-xs text-muted-strong">Somente registros com ownerTaskId igual à tarefa atual.</p></div><label className={labelClass}>Estado<select className={inputClass} value={status} onChange={event => setStatus(event.target.value as MemoryStatus)}><option value="active">Ativas</option><option value="superseded">Substituídas</option></select></label></div>
      {memoriesQuery.isPending && <p className="text-ui-xs text-muted-strong" role="status">Carregando memórias da tarefa…</p>}
      {memoriesQuery.isError && <ErrorNotice error={memoriesQuery.error} onRetry={() => void memoriesQuery.refetch()} retrying={memoriesQuery.isFetching} />}
      {!memoriesQuery.isPending && !memoriesQuery.isError && !memories.length && <p className="rounded-ui-sm border border-dashed border-line-strong px-3 py-3 text-ui-xs text-muted-strong">Esta tarefa ainda não tem memórias {status === 'active' ? 'ativas' : 'substituídas'}.</p>}
      {memories.length > 0 && <div className="grid gap-2">
        {memories.map(memory => <article key={memory._id} className="grid min-w-0 gap-2 rounded-ui-sm border border-line px-3 py-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h5 className="wrap-anywhere text-ui-sm font-bold text-ink">{memory.title}</h5><p className="mt-1 text-ui-xs text-muted-strong">Escopo: somente esta tarefa · {categoryLabels[memory.category]} · {memory.status === 'active' ? 'Ativa' : 'Substituída'} · revisão {memory.revision} · versão {memory.version} · {memory.sources.length} fonte(s)</p><p className="mt-1 text-ui-xs text-muted-strong">Proprietária: <TaskLink taskId={memory.ownerTaskId} name={taskName} projectId={projectId} className="text-tone-blue underline underline-offset-2">{taskName}</TaskLink></p></div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <button type="button" className={buttonSecondarySmall} onClick={() => { setOpenMemoryId(openMemoryId === memory._id ? '' : memory._id); setViewRevision(memory.revision); }} aria-expanded={openMemoryId === memory._id}>{openMemoryId === memory._id ? 'Fechar' : 'Abrir'}</button>
              <button type="button" className={buttonSecondarySmall} onClick={() => void beginEdit(memory)}>Editar</button>
              <button type="button" className={buttonSecondarySmall + ' text-tone-red'} onClick={() => { if (window.confirm('Arquivar esta memória da tarefa? O histórico continuará disponível.')) archiveMemory.mutate(memory); }}>Arquivar</button>
            </div>
          </div>
          {openMemoryId === memory._id && <div className="grid min-w-0 gap-3 border-t border-line pt-3">
            <label className={labelClass}>Revisão<select className={inputClass} value={viewRevision ?? memory.revision} onChange={event => setViewRevision(Number(event.target.value))}>{Array.from({ length: memory.revision }, (_, index) => memory.revision - index).map(revision => <option key={revision} value={revision}>{revision === memory.revision ? `Atual · revisão ${revision}` : `Revisão histórica ${revision}`}</option>)}</select></label>
            {memoryDetailQuery.isPending && <p className="text-ui-xs text-muted-strong" role="status">Carregando conteúdo e fontes…</p>}
            {memoryDetailQuery.isError && <ErrorNotice error={memoryDetailQuery.error} onRetry={() => void memoryDetailQuery.refetch()} retrying={memoryDetailQuery.isFetching} />}
            {memoryDetailQuery.data && <><MarkdownView content={memoryDetailQuery.data.content} variant="compact" className="max-h-96 overflow-auto rounded-ui-sm bg-canvas p-3" /><div className="grid gap-2"><h6 className="text-ui-xs font-bold text-ink">Fontes verificadas · revisão {memoryDetailQuery.data.revision}</h6><SourceList sources={memoryDetailQuery.data.sources} projectId={projectId} token={token} /></div></>}
          </div>}
        </article>)}
      </div>}
      {memoriesQuery.hasNextPage && <button type="button" className={buttonSecondary + ' justify-self-start'} onClick={() => void memoriesQuery.fetchNextPage()} disabled={memoriesQuery.isFetchingNextPage}>{memoriesQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais memórias'}</button>}
    </section>
  </section>;
}
