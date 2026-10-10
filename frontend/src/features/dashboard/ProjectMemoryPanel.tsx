import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, operationId, query } from '../../api';
import type { ApiPage } from '../../api';
import { FeatureLink, TaskLink } from '../../components/ui/Links';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { buttonPrimary, buttonSecondary, buttonSecondarySmall, notice } from '../../components/ui/classes';

type MemoryCategory = 'decision' | 'architecture' | 'convention' | 'domain_fact';
type MemoryStatus = 'active' | 'superseded';
type SourceKind = 'task' | 'feature' | 'execution' | 'document' | 'diff';
type MemorySource = {
  kind: SourceKind;
  id: string;
  title?: string;
  revision?: number;
  taskId?: string;
  featureId?: string;
  targetKind?: 'task' | 'feature';
  targetId?: string;
};
type ProjectMemory = {
  _id: string;
  version: number;
  title: string;
  category: MemoryCategory;
  status: MemoryStatus;
  revision: number;
  sources: MemorySource[];
};
type MemoryDetail = ProjectMemory & { content: string };
type MemoryProposal = {
  _id: string;
  version: number;
  taskId: string;
  executionId: string;
  title: string;
  category: MemoryCategory;
  status: 'pending' | 'approved' | 'rejected';
  sources: MemorySource[];
};
type ProposalDetail = MemoryProposal & { content: string };
type MemoryDraft = {
  title: string;
  category: MemoryCategory;
  status: MemoryStatus;
  content: string;
  sources: Array<{ kind: SourceKind; id: string; revision: string }>;
  version?: number;
};
type CategoryFilter = '' | MemoryCategory;
type StatusFilter = MemoryStatus;

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
const memoryPanel = 'grid min-w-0 gap-4 rounded-ui-md border border-line bg-surface p-[18px] shadow-[0_1px_2px_#1720330a] max-[480px]:p-3';

function sourceUrl(source: MemorySource, projectId: string, relatedTaskId?: string) {
  if (source.kind === 'task') return <TaskLink taskId={source.id} name={source.title ?? 'Fonte de tarefa'} projectId={projectId} title="Abrir tarefa de origem" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Abrir tarefa de origem'}</TaskLink>;
  const featureId = source.kind === 'feature' ? source.id : source.featureId;
  if (featureId) return <FeatureLink featureId={featureId} name={source.title ?? 'Feature de origem'} projectId={projectId} title="Abrir tarefas da feature" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Abrir feature de origem'}</FeatureLink>;
  const taskId = source.taskId ?? (source.kind === 'execution' || source.kind === 'diff' ? relatedTaskId : undefined);
  if (taskId) return <TaskLink taskId={taskId} name={source.title ?? 'Fonte da tarefa'} projectId={projectId} title="Abrir tarefa relacionada à fonte" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Abrir tarefa relacionada'}</TaskLink>;
  if (source.kind === 'document' && source.targetKind === 'task' && source.targetId) {
    return <TaskLink taskId={source.targetId} name={source.title ?? 'Documento de tarefa'} projectId={projectId} title="Abrir tarefa que contém o documento" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Documento da tarefa'}</TaskLink>;
  }
  if (source.kind === 'document' && source.targetKind === 'feature' && source.targetId) {
    return <FeatureLink featureId={source.targetId} name={source.title ?? 'Documento de feature'} projectId={projectId} title="Abrir tarefas da feature que contém o documento" className="wrap-anywhere text-ui-xs font-semibold text-tone-blue underline underline-offset-2">{source.title ?? 'Documento da feature'}</FeatureLink>;
  }
  return <span className="wrap-anywhere text-ui-xs font-semibold text-ink-2">{source.title ?? source.kind}</span>;
}

function DocumentSource({ token, projectId, source }: { token: string; projectId: string; source: MemorySource }) {
  const [isOpen, setIsOpen] = useState(false);
  const documentQuery = useQuery({
    queryKey: ['project-memory-source-document', projectId, source.id, source.revision],
    enabled: Boolean(token && projectId && isOpen),
    queryFn: () => query<{ content: string }>(token, 'get_markdown', {
      projectId, id: source.id, line: 1, limit: 200, ...(source.revision ? { revision: source.revision } : {})
    })
  });
  return <div className="grid min-w-0 gap-2">
    <button type="button" className="wrap-anywhere text-left text-ui-xs font-semibold text-tone-blue underline underline-offset-2" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>{source.title ?? 'Abrir documento fonte'}</button>
    {isOpen && <>
      {documentQuery.isPending && <span className="text-ui-xs text-muted-strong" role="status">Carregando documento…</span>}
      {documentQuery.isError && <ErrorNotice error={documentQuery.error} onRetry={() => void documentQuery.refetch()} retrying={documentQuery.isFetching} />}
      {documentQuery.data && <MarkdownView content={documentQuery.data.content} variant="compact" className="max-h-80 overflow-auto rounded-ui-sm bg-canvas p-3" />}
    </>}
  </div>;
}

function SourceList({ sources, projectId, relatedTaskId, token }: { sources: MemorySource[]; projectId: string; relatedTaskId?: string; token: string }) {
  if (!sources.length) return <p className="text-ui-xs text-muted-strong">Nenhuma fonte registrada.</p>;
  return <ul className="grid min-w-0 gap-2">
    {sources.map((source, index) => <li key={source.kind + ':' + source.id + ':' + (source.revision ?? '') + ':' + index} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="shrink-0 rounded-ui-sm bg-canvas px-1.5 py-1 text-[10px] text-muted-strong">{sourceKinds.find(item => item.value === source.kind)?.label ?? source.kind}{source.revision ? ' · rev. ' + source.revision : ''}</span>
      {source.kind === 'document' ? <DocumentSource token={token} projectId={projectId} source={source} /> : sourceUrl(source, projectId, relatedTaskId)}
      <code className="max-w-full break-all text-[10px] text-muted-strong">{source.id}</code>
    </li>)}
  </ul>;
}

function emptyDraft(): MemoryDraft {
  return { title: '', category: 'convention', status: 'active', content: '', sources: [{ kind: 'task', id: '', revision: '' }] };
}

export function ProjectMemoryPanel({ token, projectId }: { token: string; projectId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [draft, setDraft] = useState<MemoryDraft | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState('');
  const [openMemoryId, setOpenMemoryId] = useState('');
  const [openProposalId, setOpenProposalId] = useState('');
  const [rejectingProposalId, setRejectingProposalId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [message, setMessage] = useState('');

  const memoriesQuery = useInfiniteQuery({
    queryKey: ['project-memories', projectId, search, category, status],
    enabled: Boolean(token && projectId),
    initialPageParam: '',
    queryFn: ({ pageParam }) => query<ApiPage<ProjectMemory>>(token, 'list_project_memories', {
      projectId, limit: 20, ...(search ? { search } : {}), ...(category ? { category } : {}),
      ...(status ? { status } : {}), ...(pageParam ? { after: pageParam } : {})
    }),
    getNextPageParam: lastPage => lastPage.next ?? undefined
  });
  const proposalsQuery = useInfiniteQuery({
    queryKey: ['project-memory-proposals', projectId, 'pending'],
    enabled: Boolean(token && projectId),
    initialPageParam: '',
    queryFn: ({ pageParam }) => query<ApiPage<MemoryProposal>>(token, 'list_project_memory_proposals', {
      projectId, status: 'pending', limit: 20, ...(pageParam ? { after: pageParam } : {})
    }),
    getNextPageParam: lastPage => lastPage.next ?? undefined
  });
  const memoryDetailQuery = useQuery({
    queryKey: ['project-memory-detail', projectId, openMemoryId],
    enabled: Boolean(token && projectId && openMemoryId),
    queryFn: () => query<MemoryDetail>(token, 'get_project_memory', { projectId, memoryId: openMemoryId })
  });
  const proposalDetailQuery = useQuery({
    queryKey: ['project-memory-proposal-detail', projectId, openProposalId],
    enabled: Boolean(token && projectId && openProposalId),
    queryFn: () => query<ProposalDetail>(token, 'get_project_memory_proposal', { projectId, proposalId: openProposalId })
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
      if (draft.version === undefined) return query<MemoryDetail>(token, 'create_project_memory', { operationId: operationId(), projectId, data });
      return query<MemoryDetail>(token, 'update_project_memory', {
        operationId: operationId(), projectId, memoryId: editingMemoryId, version: draft.version, data
      });
    },
    onSuccess: async () => {
      setDraft(null);
      setEditingMemoryId('');
      setOpenMemoryId('');
      setMessage('Memória salva.');
      await queryClient.invalidateQueries({ queryKey: ['project-memories', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['project-memory-detail', projectId] });
    },
    onError: error => setMessage(error instanceof ApiRequestError && error.status === 409
      ? 'Conflito de versão: o rascunho continua neste formulário. Atualize a lista e compare com a revisão atual antes de tentar salvar novamente.'
      : error instanceof Error ? error.message : 'Não foi possível salvar a memória.')
  });
  const archiveMemory = useMutation({
    mutationFn: (memory: ProjectMemory) => query(token, 'archive_project_memory', {
      operationId: operationId(), projectId, memoryId: memory._id, version: memory.version
    }),
    onSuccess: async () => {
      setMessage('Memória arquivada; o histórico foi preservado.');
      setOpenMemoryId('');
      await queryClient.invalidateQueries({ queryKey: ['project-memories', projectId] });
    },
    onError: error => setMessage(error instanceof ApiRequestError && error.status === 409
      ? 'Conflito ao arquivar: a memória foi alterada. Atualize a lista e revise a versão atual.'
      : error instanceof Error ? error.message : 'Não foi possível arquivar a memória.')
  });
  const proposalAction = useMutation({
    mutationFn: ({ proposal, action, reason }: { proposal: MemoryProposal; action: 'approve' | 'reject'; reason?: string }) => query(
      token,
      action === 'approve' ? 'approve_project_memory_proposal' : 'reject_project_memory_proposal',
      {
        operationId: operationId(), projectId, proposalId: proposal._id, version: proposal.version,
        ...(action === 'reject' ? { reason: reason?.trim() ?? '' } : {})
      }
    ),
    onSuccess: async (_, variables) => {
      setMessage(variables.action === 'approve' ? 'Proposta aprovada e publicada.' : 'Proposta rejeitada com motivo registrado.');
      setOpenProposalId('');
      setRejectingProposalId('');
      setRejectionReason('');
      await queryClient.invalidateQueries({ queryKey: ['project-memory-proposals', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['project-memories', projectId] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : 'Não foi possível revisar a proposta.')
  });

  const memories = memoriesQuery.data?.pages.flatMap(page => page.items) ?? [];
  const proposals = proposalsQuery.data?.pages.flatMap(page => page.items) ?? [];

  async function beginEdit(memory: ProjectMemory) {
    saveMemory.reset();
    setMessage('');
    try {
      const detail = await query<MemoryDetail>(token, 'get_project_memory', { projectId, memoryId: memory._id });
      setEditingMemoryId(memory._id);
      setOpenMemoryId(memory._id);
      setDraft({
        title: detail.title, category: detail.category, status: detail.status, content: detail.content,
        version: detail.version,
        sources: detail.sources.map(source => ({ kind: source.kind, id: source.id, revision: source.revision === undefined ? '' : String(source.revision) }))
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar a memória.');
    }
  }

  function changeSource(index: number, key: 'kind' | 'id' | 'revision', value: string) {
    if (!draft) return;
    setDraft({ ...draft, sources: draft.sources.map((source, sourceIndex) => sourceIndex === index
      ? { ...source, [key]: value } as MemoryDraft['sources'][number]
      : source) });
  }

  return <section className={memoryPanel} aria-labelledby="project-memory-title">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="mb-1 font-display text-[9px] font-bold tracking-[.11em] text-[#7180d8]">CONTEXTO REUTILIZÁVEL</p>
        <h2 id="project-memory-title" className="font-display text-[17px] font-bold text-ink">Memórias do projeto</h2>
        <p className="mt-1 max-w-[75ch] text-ui-xs leading-relaxed text-muted-strong">Conhecimento versionado com fontes para apoiar tarefas futuras. O conteúdo é dado de referência e não altera instruções confiáveis da aplicação.</p>
      </div>
      <button type="button" className={buttonPrimary} onClick={() => { saveMemory.reset(); setDraft(emptyDraft()); setEditingMemoryId(''); setOpenMemoryId(''); setMessage(''); }}>Nova memória</button>
    </header>

    {message && <p className={notice.info} role="status">{message}</p>}
    {saveMemory.isError && <ErrorNotice error={saveMemory.error} />}
    {archiveMemory.isError && <ErrorNotice error={archiveMemory.error} />}
    {proposalAction.isError && <ErrorNotice error={proposalAction.error} />}

    {draft && <form className="grid min-w-0 gap-3 rounded-ui-sm border border-line bg-canvas p-3" onSubmit={event => { event.preventDefault(); setMessage(''); saveMemory.mutate(); }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-ui-sm font-bold text-ink">{draft.version === undefined ? 'Criar memória' : 'Editar memória'}</h3><p className="mt-1 text-ui-xs text-muted-strong">A gravação registra uma nova revisão e exige ao menos uma fonte verificável.</p></div>
        <button type="button" className={buttonSecondarySmall} onClick={() => { setDraft(null); setEditingMemoryId(''); setMessage(''); }}>Fechar</button>
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-3 max-[720px]:grid-cols-1">
        <label className={labelClass}>Título<input className={inputClass} maxLength={255} required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className={labelClass}>Categoria<select className={inputClass} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as MemoryCategory })}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={labelClass}>Estado<select className={inputClass} disabled={draft.version === undefined} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as MemoryStatus })}><option value="active">Ativa</option><option value="superseded">Substituída</option></select></label>
      </div>
      <label className={labelClass}>Conteúdo Markdown<textarea className="min-h-32 w-full min-w-0 resize-y rounded-ui-sm border border-line-strong bg-white p-2.5 text-ui-sm leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#4b4fcb]" maxLength={20000} required value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></label>
      <div className="grid gap-2" aria-labelledby="memory-sources-label">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 id="memory-sources-label" className="text-ui-xs font-bold text-ink">Fontes</h4><button type="button" className={buttonSecondarySmall} onClick={() => setDraft({ ...draft, sources: [...draft.sources, { kind: 'task', id: '', revision: '' }] })}>Adicionar fonte</button></div>
        {draft.sources.map((source, index) => <div className="grid grid-cols-[minmax(120px,.7fr)_minmax(150px,2fr)_minmax(100px,.7fr)_auto] gap-2 max-[720px]:grid-cols-1" key={index}>
          <label className={labelClass}>Tipo<select className={inputClass} value={source.kind} onChange={event => changeSource(index, 'kind', event.target.value)}>{sourceKinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className={labelClass}>ID da fonte<input className={inputClass} required value={source.id} onChange={event => changeSource(index, 'id', event.target.value)} /></label>
          <label className={labelClass}>Revisão (quando aplicável)<input className={inputClass} type="number" min="1" step="1" value={source.revision} onChange={event => changeSource(index, 'revision', event.target.value)} /></label>
          <button type="button" className={buttonSecondarySmall + ' self-end'} aria-label={'Remover fonte ' + (index + 1)} disabled={draft.sources.length <= 1} onClick={() => setDraft({ ...draft, sources: draft.sources.filter((_, sourceIndex) => sourceIndex !== index) })}>Remover</button>
        </div>)}
      </div>
      <p className="text-ui-xs text-muted-strong">Se houver conflito de versão, o rascunho permanece no formulário para comparação. Nunca inclua segredos ou conversas completas.</p>
      {saveMemory.error instanceof ApiRequestError && saveMemory.error.status === 409 && draft.version !== undefined && <button type="button" className={buttonSecondarySmall + ' justify-self-start'} onClick={() => { const current = memories.find(memory => memory._id === editingMemoryId); if (current) void beginEdit(current); }}>Carregar versão atual e substituir o rascunho</button>}
      <div className="flex flex-wrap gap-2"><button type="submit" className={buttonPrimary} disabled={saveMemory.isPending}>{saveMemory.isPending ? 'Salvando…' : 'Salvar memória'}</button><button type="button" className={buttonSecondary} onClick={() => { setDraft(null); setEditingMemoryId(''); setMessage(''); }}>Cancelar</button></div>
    </form>}

    <section className="grid min-w-0 gap-3" aria-labelledby="memory-list-title">
      <div><h3 id="memory-list-title" className="text-ui-sm font-bold text-ink">Acervo aprovado</h3><p className="mt-1 text-ui-xs text-muted-strong">O conteúdo completo é carregado ao abrir um registro.</p></div>
      <form className="grid grid-cols-[minmax(180px,2fr)_minmax(140px,1fr)_minmax(140px,1fr)_auto] gap-2 max-[720px]:grid-cols-1" role="search" onSubmit={event => { event.preventDefault(); setSearch(searchInput.trim()); }}>
        <label className={labelClass}>Pesquisar memórias<input className={inputClass} maxLength={160} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Título ou conteúdo" /></label>
        <label className={labelClass}>Categoria<select className={inputClass} value={category} onChange={event => setCategory(event.target.value as CategoryFilter)}><option value="">Todas</option>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={labelClass}>Estado<select className={inputClass} value={status} onChange={event => setStatus(event.target.value as StatusFilter)}><option value="active">Ativa</option><option value="superseded">Substituída</option></select></label>
        <button type="submit" className={buttonSecondary + ' self-end'}>Pesquisar</button>
      </form>
      {memoriesQuery.isPending && <p className="text-ui-xs text-muted-strong" role="status">Carregando memórias…</p>}
      {memoriesQuery.isError && <ErrorNotice error={memoriesQuery.error} onRetry={() => void memoriesQuery.refetch()} retrying={memoriesQuery.isFetching} />}
      {!memoriesQuery.isPending && !memoriesQuery.isError && !memories.length && <p className="rounded-ui-sm border border-dashed border-line-strong px-3 py-3 text-ui-xs text-muted-strong">Nenhuma memória corresponde aos filtros.</p>}
      {memories.length > 0 && <div className="grid gap-2">
        {memories.map(memory => <article key={memory._id} className="grid min-w-0 gap-2 rounded-ui-sm border border-line px-3 py-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h4 className="wrap-anywhere text-ui-sm font-bold text-ink">{memory.title}</h4><p className="mt-1 text-ui-xs text-muted-strong">{categoryLabels[memory.category]} · {memory.status === 'active' ? 'Ativa' : 'Substituída'} · revisão {memory.revision} · versão {memory.version} · {memory.sources.length} fonte(s)</p></div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <button type="button" className={buttonSecondarySmall} onClick={() => setOpenMemoryId(openMemoryId === memory._id ? '' : memory._id)} aria-expanded={openMemoryId === memory._id}>{openMemoryId === memory._id ? 'Fechar' : 'Abrir'}</button>
              <button type="button" className={buttonSecondarySmall} onClick={() => void beginEdit(memory)}>Editar</button>
              <button type="button" className={buttonSecondarySmall + ' text-tone-red'} onClick={() => { if (window.confirm('Arquivar esta memória? O histórico continuará disponível.')) archiveMemory.mutate(memory); }}>Arquivar</button>
            </div>
          </div>
          {openMemoryId === memory._id && <div className="grid min-w-0 gap-3 border-t border-line pt-3">
            {memoryDetailQuery.isPending && <p className="text-ui-xs text-muted-strong" role="status">Carregando conteúdo e fontes…</p>}
            {memoryDetailQuery.isError && <ErrorNotice error={memoryDetailQuery.error} onRetry={() => void memoryDetailQuery.refetch()} retrying={memoryDetailQuery.isFetching} />}
            {memoryDetailQuery.data && <><MarkdownView content={memoryDetailQuery.data.content} variant="compact" className="max-h-96 overflow-auto rounded-ui-sm bg-canvas p-3" /><div className="grid gap-2"><h5 className="text-ui-xs font-bold text-ink">Fontes verificadas</h5><SourceList sources={memoryDetailQuery.data.sources} projectId={projectId} token={token} relatedTaskId={memoryDetailQuery.data.sources.find(source => source.kind === 'task')?.id} /></div></>}
          </div>}
        </article>)}
      </div>}
      {memoriesQuery.hasNextPage && <button type="button" className={buttonSecondary + ' justify-self-start'} onClick={() => void memoriesQuery.fetchNextPage()} disabled={memoriesQuery.isFetchingNextPage}>{memoriesQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais memórias'}</button>}
    </section>

    <section className="grid min-w-0 gap-3 border-t border-line pt-4" aria-labelledby="memory-proposals-title">
      <div><h3 id="memory-proposals-title" className="text-ui-sm font-bold text-ink">Sugestões pendentes</h3><p className="mt-1 text-ui-xs text-muted-strong">Cada sugestão precisa de revisão e decisão explícita de uma pessoa autorizada.</p></div>
      {proposalsQuery.isPending && <p className="text-ui-xs text-muted-strong" role="status">Carregando sugestões…</p>}
      {proposalsQuery.isError && <ErrorNotice error={proposalsQuery.error} onRetry={() => void proposalsQuery.refetch()} retrying={proposalsQuery.isFetching} />}
      {!proposalsQuery.isPending && !proposalsQuery.isError && !proposals.length && <p className="rounded-ui-sm border border-dashed border-line-strong px-3 py-3 text-ui-xs text-muted-strong">Não há sugestões aguardando revisão.</p>}
      {proposals.length > 0 && <div className="grid gap-2">
        {proposals.map(proposal => <article key={proposal._id} className="grid min-w-0 gap-2 rounded-ui-sm border border-line px-3 py-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h4 className="wrap-anywhere text-ui-sm font-bold text-ink">{proposal.title}</h4><p className="mt-1 text-ui-xs text-muted-strong">{categoryLabels[proposal.category]} · pendente · tarefa <TaskLink taskId={proposal.taskId} name="Tarefa fonte" projectId={projectId} title="Abrir tarefa que fundamenta a sugestão" className="text-tone-blue underline underline-offset-2">abrir fonte</TaskLink></p></div>
            <button type="button" className={buttonSecondarySmall} onClick={() => setOpenProposalId(openProposalId === proposal._id ? '' : proposal._id)} aria-expanded={openProposalId === proposal._id}>{openProposalId === proposal._id ? 'Fechar revisão' : 'Revisar conteúdo e fontes'}</button>
          </div>
          {openProposalId === proposal._id && <div className="grid min-w-0 gap-3 border-t border-line pt-3">
            {proposalDetailQuery.isPending && <p className="text-ui-xs text-muted-strong" role="status">Carregando conteúdo completo…</p>}
            {proposalDetailQuery.isError && <ErrorNotice error={proposalDetailQuery.error} onRetry={() => void proposalDetailQuery.refetch()} retrying={proposalDetailQuery.isFetching} />}
            {proposalDetailQuery.data && <>
              <MarkdownView content={proposalDetailQuery.data.content} variant="compact" className="max-h-96 overflow-auto rounded-ui-sm bg-canvas p-3" />
              <div className="grid gap-2"><h5 className="text-ui-xs font-bold text-ink">Fontes da sugestão</h5><SourceList sources={proposalDetailQuery.data.sources} projectId={projectId} token={token} relatedTaskId={proposalDetailQuery.data.taskId} /></div>
              <div className="flex flex-wrap gap-2"><button type="button" className={buttonPrimary} disabled={proposalAction.isPending} onClick={() => proposalAction.mutate({ proposal, action: 'approve' })}>Aprovar e publicar</button><button type="button" className={buttonSecondarySmall} disabled={proposalAction.isPending} onClick={() => { setRejectingProposalId(proposal._id); setRejectionReason(''); }}>Rejeitar</button></div>
              {rejectingProposalId === proposal._id && <form className="grid gap-2 rounded-ui-sm border border-line bg-canvas p-3" onSubmit={event => { event.preventDefault(); proposalAction.mutate({ proposal, action: 'reject', reason: rejectionReason }); }}>
                <label className={labelClass}>Motivo da rejeição<textarea className="min-h-20 w-full resize-y rounded-ui-sm border border-line-strong bg-white p-2.5 text-ui-sm text-ink" required maxLength={2000} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} /></label>
                <div className="flex flex-wrap gap-2"><button type="submit" className={buttonSecondarySmall} disabled={proposalAction.isPending}>Registrar rejeição</button><button type="button" className={buttonSecondarySmall} onClick={() => { setRejectingProposalId(''); setRejectionReason(''); }}>Cancelar</button></div>
              </form>}
            </>}
          </div>}
        </article>)}
      </div>}
      {proposalsQuery.hasNextPage && <button type="button" className={buttonSecondary + ' justify-self-start'} onClick={() => void proposalsQuery.fetchNextPage()} disabled={proposalsQuery.isFetchingNextPage}>{proposalsQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais sugestões'}</button>}
    </section>
  </section>;
}
