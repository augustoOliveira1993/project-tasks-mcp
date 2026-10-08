import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, query, request } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage, formatDate } from '../../lib/format';
import { areaLabel, personInitials, plural, relativeTime } from '../../lib/labels';
import { activityText, conversationPhase, stripTaskPrefix, suggestionsFor } from '../../lib/conversation-ui';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { AgentClientIcon } from '../ui/AgentClientIcon';
import { Badge } from '../ui/Badge';
import { DropdownMenu } from '../ui/DropdownMenu';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconChevron, IconFeature, IconMore } from '../ui/icons';
import { FeatureLink, FilterLink, TaskLink } from '../ui/Links';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { buttonBase, buttonGhost, buttonSecondarySmall, notice as noticeTone, textButton } from '../ui/classes';
import { confirmConversationDeletion, conversationInboxAfterFilter, conversationInboxAfterSelection, conversationMatchesSummaryCategory, conversationSummaryCounts, createProjectConversation, deleteProjectConversation, historyAfterConversationDeletion, historyAfterConversationTitleUpdate, linkConversationTask, listAllProjectConversations, listConversationTypes, markConversationRead, nextConversationReadAttempt, scheduleTaskSearch, searchProjectTasks, updateConversationTitle, type ConversationInboxState, type ConversationReadAttempt } from './conversation-actions';
import { ConversationAside } from './ConversationAside';
import { ConversationStepper } from './ConversationStepper';
import { ProposalCard } from './ProposalCard';
import { authorDisplayName } from './ConversationParts';
import type { Conversation, ConversationDetail, ConversationPage, ConversationType, Feature, Proposal, TaskActivity, TaskOption } from './conversation-types';

const buttonGhostSmall = `${buttonBase} min-h-[29px] px-2.5 border-transparent bg-transparent text-[#758093]`;
const buttonPrimarySmall = `${buttonBase} min-h-[29px] px-2.5 border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const emptyStateBox = 'grid justify-items-center gap-2 px-3.5 py-[30px] text-center';
const emptyHeading = 'font-display text-[13px] leading-[normal] font-bold text-[#394558]';
const emptyText = 'mb-2 text-[11px] text-[#8993a3]';
const fieldLabel = 'text-[10px] font-semibold text-[#566275]';
const fieldInput = 'w-full rounded-[7px] border border-[#d9deea] px-2.5 py-[9px] text-[11px] text-[#344054]';
const entityChipBase = 'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-ui-sm px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap no-underline hover:bg-tone-blue-bg hover:text-tone-blue';
const areaChipTones: Record<string, string> = {
  backend: `${entityChipBase} bg-[#eaeeff] text-[#3544a8]`,
  frontend: `${entityChipBase} bg-[#e1f4f1] text-[#136059]`
};
const areaChipDefault = `${entityChipBase} bg-tone-slate-bg text-tone-slate`;
const featureChip = 'inline-flex max-w-[240px] cursor-pointer items-center gap-1 rounded-ui-sm border border-line-strong bg-white px-2 py-0.5 text-[10.5px] leading-normal font-semibold whitespace-nowrap text-ink-2 no-underline hover:border-focus hover:bg-tone-blue-bg hover:text-tone-blue';
const searchIcon = `bg-[url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23596077'%20stroke-width='1.75'%20stroke-linecap='round'%3E%3Ccircle%20cx='11'%20cy='11'%20r='6.5'/%3E%3Cpath%20d='M20%2020l-4-4'/%3E%3C/svg%3E")] bg-[length:16px] bg-[position:12px_center] bg-no-repeat`;

// Grade do painel: 3 colunas com contexto, 2 sem; recolhido só vale a partir de 1280px. max-[N+1px] reproduz `max-width: Npx`.
const workspaceBase = 'flex h-[calc(100dvh_-_255px)] min-h-[560px] flex-col gap-3 max-[768px]:h-[calc(100dvh_-_215px)] max-[768px]:min-h-[480px]';
const layoutBase = 'group/conv grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-stretch gap-0 overflow-hidden rounded-[16px] border border-[#e2e5eb] bg-white shadow-[0_1px_2px_rgba(20,24,34,.04)] max-[768px]:grid-cols-[minmax(0,1fr)]';
const layoutColumns = 'grid-cols-[minmax(280px,340px)_minmax(0,1fr)] max-[1280px]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]';
const layoutColumnsAside = 'grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(320px,360px)] max-[1280px]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]';
const layoutCollapsed = 'min-[1280px]:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]';
const sidebarBase = 'flex min-h-0 min-w-0 flex-col gap-2.5 self-stretch overflow-hidden border-r border-r-[#e2e5eb] bg-[#fafbfd] p-4 group-data-[view=detail]/conv:max-[768px]:hidden';
const sidebarPlain = 'max-[768px]:col-start-1 max-[768px]:row-start-1';
const sidebarWithAside = 'max-[1281px]:[grid-row:1/span_2] max-[961px]:row-auto max-[768px]:col-start-1';
const mainBase = 'flex min-h-0 min-w-0 flex-col overflow-hidden bg-white max-[768px]:overflow-y-auto group-data-[view=list]/conv:max-[768px]:hidden';
const mainPlain = 'max-[768px]:col-start-1 max-[768px]:row-start-1';
const mainWithAside = 'max-[1280px]:col-start-2 max-[1280px]:row-start-1 group-data-[tab=criteria]/conv:max-[1280px]:hidden';
const newConversationButtonBase = 'inline-flex w-full flex-none items-center justify-center gap-2 rounded-lg border border-transparent bg-accent text-ui-sm font-bold whitespace-nowrap text-white shadow-[0_3px_8px_#5364dd2a] transition hover:bg-accent-dark';
const listItemBase = 'grid w-full min-w-0 max-w-full cursor-pointer gap-1.5 rounded-[12px] border p-3 text-left';
const listItemTones = {
  active: `${listItemBase} border-transparent bg-[#eceefc]`,
  unread: `${listItemBase} border-[#cbe9d1] bg-[#f0fbf3] hover:border-transparent hover:bg-[#f0f2f8]`,
  idle: `${listItemBase} border-transparent bg-transparent hover:bg-[#f0f2f8]`
};
const messageStateTones = { unread: 'font-bold text-[#1d753d]', read: 'font-bold text-[#387b52]', empty: 'font-medium text-[#788496]' };
const tabClass = 'inline-flex min-h-11 items-center gap-1.5 border-b-2 border-b-transparent bg-transparent px-3.5 text-ui-sm font-semibold text-muted-strong aria-selected:border-b-[#4b4fcb] aria-selected:text-[#4b4fcb]';
const sendButtonBase = 'inline-flex min-h-11 min-w-[104px] items-center justify-center gap-2 rounded-lg border border-transparent px-3 text-ui-sm font-bold transition';
const scrollBottomBase = 'absolute right-5 bottom-3.5 z-[4] inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-bold shadow-[0_6px_18px_#1822302e] max-[768px]:right-3';

export function ConversationReadFailure({ error, retry, retrying = false }: { error: unknown; retry: () => void; retrying?: boolean }) {
  return <div className={`${noticeTone.error} flex-none`} role="alert">{errorMessage(error)} <button type="button" className={textButton} onClick={retry} disabled={retrying}>{retrying ? 'Tentando…' : 'Tentar novamente'}</button></div>;
}

export function ConversationTaskSearch({ value, debouncedValue, isFetching, isError, error, tasks, onChange, onSelect, disabled, featureLabel }: {
  value: string; debouncedValue: string; isFetching: boolean; isError: boolean; error: unknown; tasks: TaskOption[];
  onChange: (value: string) => void; onSelect: (taskId: string) => void; disabled: boolean; featureLabel: (task: TaskOption) => string;
}) {
  return <section className="grid flex-none gap-[7px] rounded-[9px] border border-[#dfe4f4] bg-[#fafbff] p-3"><label className={fieldLabel} htmlFor="conversation-task-search">Buscar tarefa</label><input className={fieldInput} id="conversation-task-search" type="search" value={value} onChange={event => onChange(event.target.value)} placeholder="Digite o início do nome da tarefa…" autoComplete="off" /><small className="text-[9px] text-[#8791a1]">Digite ao menos 2 caracteres. A busca considera tarefas ativas deste projeto.</small>{debouncedValue.length < 2 ? <div className={emptyStateBox}>Digite ao menos 2 caracteres para buscar tarefas.</div> : isFetching ? <div className="px-[18px] py-7 text-center text-[11px] text-[#8792a2]">Buscando tarefas…</div> : isError ? <div className={noticeTone.error}>{errorMessage(error)}</div> : tasks.length ? <div className="grid max-h-[280px] gap-1.5 overflow-y-auto" role="listbox" aria-label="Tarefas encontradas">{tasks.map(task => <button type="button" role="option" aria-selected="false" className="grid w-full min-w-0 cursor-pointer gap-1 rounded-[8px] border border-[#e3e7f0] bg-white p-2.5 text-left enabled:hover:border-[#cdd3ff] enabled:hover:bg-[#f5f6ff] disabled:cursor-wait disabled:opacity-65" key={task._id} onClick={() => onSelect(task._id)} disabled={disabled}><strong className="text-[11px] leading-[1.45] text-[#3f4b60] wrap-anywhere">{task.name}</strong><span className="flex min-w-0 flex-wrap items-start gap-1.5"><Badge tone="blue" wrap>Área · {areaLabel(task.area)}</Badge><Badge tone={statusTone[task.status] ?? 'muted'} wrap>Status · {statusLabels[task.status] ?? task.status}</Badge><Badge tone="muted" wrap>Feature · {featureLabel(task)}</Badge></span></button>)}</div> : <div className={emptyStateBox}>Nenhuma tarefa ativa corresponde à busca.</div>}</section>;
}

function ConversationTypeDialog({ open, types, selectedTypeId, loading, error, creating, creationError, onSelect, onClose, onCreate }: {
  open: boolean; types: ConversationType[]; selectedTypeId: string; loading: boolean; error: boolean; creating: boolean; creationError?: string;
  onSelect: (typeId: string) => void; onClose: () => void; onCreate: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  const selectedType = types.find(type => type._id === selectedTypeId) ?? types.find(type => type.isDefault) ?? types[0];

  return <dialog id="new-conversation-type-dialog" ref={dialogRef} aria-labelledby="new-conversation-title" onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed left-1/2 top-1/2 m-0 max-h-[min(90dvh,760px)] w-[min(760px,calc(100%_-_24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] border border-[#e2e5eb] bg-white p-0 text-ink shadow-[0_24px_70px_#18223040] backdrop:bg-[#18223070]">
    <div className="grid max-h-[min(90dvh,760px)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="flex items-start justify-between gap-4 border-b border-[#edf0f5] px-5 py-4 max-[600px]:px-4">
        <div><p className="mb-1 text-[10px] font-bold tracking-[.12em] text-[#5964cc]">NOVA CONVERSA</p><h2 id="new-conversation-title" className="font-display text-[19px] font-bold text-[#263246]">Escolha o fluxo</h2><p className="mt-1 text-[12px] leading-[1.5] text-muted-strong">Cada tipo orienta a IA por etapas diferentes. Você poderá autorizar qualquer proposta antes da execução.</p></div>
        <button type="button" className={buttonGhostSmall} onClick={onClose} aria-label="Fechar escolha de tipo">Fechar</button>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(180px,.85fr)_minmax(0,1.15fr)] gap-4 overflow-y-auto p-5 max-[600px]:grid-cols-1 max-[600px]:p-4">
        <section className="grid content-start gap-2" role="radiogroup" aria-label="Tipos de conversa">
          {loading ? <div className="py-6 text-center text-[12px] text-muted-strong" role="status">Carregando tipos…</div> : error ? <div className={noticeTone.error} role="alert">Não foi possível carregar os tipos do projeto. Você ainda pode criar uma conversa Geral.</div> : types.map(type => <button key={type._id} type="button" role="radio" aria-checked={selectedType?._id === type._id} onClick={() => onSelect(type._id)} className="grid min-w-0 gap-1 rounded-[11px] border border-[#dfe4ed] bg-white p-3 text-left aria-checked:border-[#646ee1] aria-checked:bg-[#f5f6ff] aria-checked:ring-2 aria-checked:ring-[#646ee1]/20">
            <span className="flex min-w-0 items-center justify-between gap-2"><strong className="text-[12px] text-[#334155] wrap-anywhere">{type.name}</strong>{type.isDefault && <Badge tone="blue">Padrão</Badge>}</span>
            <small className="text-[10px] text-muted-strong">{type.stages.length ? `${type.stages.length} ${type.stages.length === 1 ? 'etapa' : 'etapas'}` : 'Fluxo padrão'}</small>
          </button>)}
          {!loading && !error && !types.length && <p className="text-[11px] leading-[1.5] text-muted-strong">Nenhum tipo personalizado foi configurado. A conversa usará o fluxo Geral.</p>}
        </section>
        <section className="min-w-0 rounded-[12px] border border-[#e6e9f0] bg-[#fafbfd] p-4" aria-live="polite">
          <h3 className="font-display text-[15px] font-bold text-[#334155]">{selectedType?.name ?? 'Geral'}</h3>
          {selectedType?.description ? <MarkdownView content={selectedType.description} variant="compact" className="mt-2" /> : <p className="mt-2 text-[11px] leading-[1.6] text-muted-strong">Fluxo padrão para esclarecer o pedido, preparar uma proposta e aguardar sua autorização.</p>}
          <h4 className="mt-4 mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-[#718096]">Etapas do fluxo</h4>
          {selectedType?.stages.length ? <ol className="grid gap-2">{selectedType.stages.map((stage, index) => <li key={stage.id} className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2 rounded-[9px] border border-[#e5e8ef] bg-white p-2.5"><span className="inline-grid size-[22px] place-items-center rounded-full bg-[#eceefc] text-[10px] font-bold text-[#4b4fcb]">{index + 1}</span><div className="min-w-0"><strong className="text-[11px] text-[#435064]">{stage.title}</strong>{(stage.description || stage.instruction) && <MarkdownView content={stage.description || stage.instruction} variant="compact" className="mt-1" />}</div></li>)}</ol> : <p className="text-[11px] text-muted-strong">Esclarecer · Proposta · Autorização · Execução</p>}
        </section>
      </div>
      <footer className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-[#edf0f5] bg-white px-5 py-3.5 max-[600px]:grid-cols-1 max-[600px]:px-4">
        <p className="m-0 min-w-0 text-[10px] text-muted-strong">O chat começa no escopo do projeto; você pode vincular uma tarefa depois.</p>
        <div className="grid min-w-0 justify-items-end gap-2 max-[600px]:justify-items-stretch">{creationError && <p className={`${noticeTone.error} m-0 max-w-full wrap-anywhere`} role="alert">{creationError}</p>}<div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-[600px]:w-full"><button type="button" className={`${buttonSecondarySmall} max-[600px]:flex-1`} onClick={onClose} disabled={creating}>Cancelar</button><button type="button" className={`${buttonPrimarySmall} min-h-10 min-w-0 px-4 max-[600px]:flex-1`} onClick={onCreate} disabled={creating || loading}>{creating ? 'Criando…' : `Criar conversa · ${selectedType?.name ?? 'Geral'}`}</button></div></div>
      </footer>
    </div>
  </dialog>;
}

export function ConversationTitleEditor({ title, editing, draft, editable, saving, error, onEdit, onDraftChange, onSave, onCancel }: {
  title: string; editing: boolean; draft: string; editable: boolean; saving: boolean; error?: unknown;
  onEdit: () => void; onDraftChange: (value: string) => void; onSave: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  if (!editing) return <div className="flex min-w-0 flex-wrap items-center gap-2"><h2>{title}</h2>{editable && <button type="button" className={buttonGhostSmall} aria-label="Editar título da conversa" onClick={onEdit}>Editar título</button>}</div>;
  return <form className="grid max-w-full gap-1.5" onSubmit={onSave}><label className={fieldLabel} htmlFor="conversation-title">Título da conversa</label><input className={fieldInput} id="conversation-title" aria-label="Título da conversa" type="text" maxLength={255} value={draft} onChange={event => onDraftChange(event.target.value)} autoFocus /><div className="flex items-center gap-1.5"><button type="submit" className={buttonPrimarySmall} disabled={!draft.trim() || saving}>{saving ? 'Salvando…' : 'Salvar título'}</button><button type="button" className={buttonSecondarySmall} onClick={onCancel} disabled={saving}>Cancelar</button></div>{error !== undefined && error !== null && <div className={noticeTone.error} role="alert">{errorMessage(error)}</div>}</form>;
}

/** Título com `código` em fonte monoespaçada. */
function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code className="rounded-[5px] bg-[#eef0f5] px-1.5 py-px font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[.85em] leading-[normal] font-normal text-[#3a4150]" key={index}>{part.slice(1, -1)}</code> : part);
}

export function ConversationPanel({ token, nonce, projectId, tasks, requestedConversationId, onConversationSelected, onOpenTask, onOpenAdmin }: { token: string; nonce: string; projectId: string; tasks: TaskOption[]; requestedConversationId?: string; onConversationSelected?: (conversationId: string) => void; onOpenTask: (taskId: string) => void; onOpenAdmin: () => void }) {
  const client = useQueryClient();
  const [inbox, setInbox] = useState<ConversationInboxState>({ filter: 'all', selectedId: requestedConversationId ?? '', chooseAfterFilter: false });
  const selectedId = inbox.selectedId;
  const listFilter = inbox.filter;
  const setSelectedId = (id: string) => setInbox(current => conversationInboxAfterSelection(current, id));
  const setListFilter = (filter: ConversationInboxState['filter']) => {
    setInbox(current => conversationInboxAfterFilter(current, filter));
    onConversationSelected?.('');
  };
  const [newConversationTypeId, setNewConversationTypeId] = useState('');
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [typeSearch, setTypeSearch] = useState('');
  const [debouncedTypeSearch, setDebouncedTypeSearch] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [linkTaskOpen, setLinkTaskOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [debouncedTaskSearch, setDebouncedTaskSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [debouncedListSearch, setDebouncedListSearch] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'detail'>(requestedConversationId ? 'detail' : 'list');
  const [detailTab, setDetailTab] = useState<'chat' | 'criteria'>('chat');
  const [asideOpen, setAsideOpen] = useState(true);
  // O App expõe um slot no cabeçalho da página; sem ele (testes, SSR) o botão fica na lista.
  const [headingSlot, setHeadingSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setHeadingSlot(document.getElementById('conversation-heading-actions')); }, []);
  const [idCopied, setIdCopied] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const knownMessageCount = useRef(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [olderConversationPages, setOlderConversationPages] = useState<ConversationPage[]>([]);
  const [olderMessagePages, setOlderMessagePages] = useState<ConversationDetail[]>([]);
  const [loadingOlderConversations, setLoadingOlderConversations] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [filteredConversationLimit, setFilteredConversationLimit] = useState(50);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const conversationListSentinelRef = useRef<HTMLDivElement>(null);
  const conversations = useQuery({
    queryKey: ['conversations', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => query<ConversationPage>(token, 'list_conversations', { projectId, limit: 50 }),
    refetchInterval: 5000
  });
  const conversationSummary = useQuery({
    queryKey: ['conversation-summary', nonce, projectId],
    enabled: Boolean(token && nonce && projectId && conversations.data?.next),
    queryFn: () => listAllProjectConversations<Conversation>(token, projectId),
    refetchInterval: 30_000
  });
  const features = useQuery({
    queryKey: ['project-features', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId, archived: false })
  });
  const conversationTypes = useQuery({
    queryKey: ['conversation-types', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => listConversationTypes<ConversationType[]>(token, projectId)
  });
  const selectableConversationTypes = (conversationTypes.data?.items ?? []).filter(type => !type.archived);
  useEffect(() => {
    if (selectableConversationTypes.length && !selectableConversationTypes.some(type => type._id === newConversationTypeId)) setNewConversationTypeId(selectableConversationTypes.find(type => type.isDefault)?._id ?? selectableConversationTypes[0]._id);
  }, [conversationTypes.data, newConversationTypeId]);
  const conversationItems = [...(conversations.data?.items ?? []), ...olderConversationPages.flatMap(page => page.items)];
  const uniqueConversationItems = [...new Map(conversationItems.map(item => [item._id, item])).values()];
  const summaryItems = conversationSummary.data ?? uniqueConversationItems;
  const conversationTypeOptions = new Map<string, { id: string; name: string; archived: boolean }>();
  for (const type of conversationTypes.data?.items ?? []) conversationTypeOptions.set(type._id, { id: type._id, name: type.name, archived: type.archived });
  for (const item of summaryItems) {
    const id = item.conversationTypeId ?? item.conversationType?._id;
    if (id && !conversationTypeOptions.has(id)) conversationTypeOptions.set(id, { id, name: item.conversationType?.name ?? 'Tipo arquivado', archived: true });
  }
  const allConversationTypes = [...conversationTypeOptions.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const defaultConversationTypeId = selectableConversationTypes.find(type => type.isDefault)?._id ?? '';
  const typeIdForConversation = (item: Conversation) => item.conversationTypeId ?? item.conversationType?._id ?? defaultConversationTypeId;
  const typeSearchNeedle = debouncedTypeSearch.trim().toLocaleLowerCase('pt-BR');
  const filteredTypeOptions = allConversationTypes.filter(type => !typeSearchNeedle || type.name.toLocaleLowerCase('pt-BR').includes(typeSearchNeedle));
  const statusOf = (item: Conversation) => item.taskId ? tasks.find(task => task._id === item.taskId)?.status : undefined;
  const summaryCounts = conversationSummaryCounts(summaryItems, statusOf);
  const hasConversationFilters = Boolean(debouncedListSearch.trim() || selectedTypeIds.length || listFilter !== 'all');
  const conversationItemsForFilter = hasConversationFilters ? summaryItems : uniqueConversationItems;
  const listFilters = [
    { id: 'all' as const, label: 'Todas', count: summaryItems.length },
    { id: 'unread' as const, label: 'Não lidas', count: summaryItems.filter(item => (item.unread?.count ?? 0) > 0).length },
    { id: 'review' as const, label: 'Em revisão', count: summaryItems.filter(item => statusOf(item) === 'em_revisao').length },
    { id: 'done' as const, label: 'Concluídas', count: summaryItems.filter(item => statusOf(item) === 'concluida').length }
  ];
  const searchNeedle = debouncedListSearch.trim().toLocaleLowerCase('pt-BR');
  const filteredConversationItems = conversationItemsForFilter.filter(item => {
    const status = statusOf(item);
    const matchesFilter = listFilter === 'all' || item._id === selectedId
      || listFilter === 'unread' && (item.unread?.count ?? 0) > 0
      || listFilter === 'review' && status === 'em_revisao'
      || listFilter === 'done' && status === 'concluida'
      || listFilter === 'summary-waiting' && conversationMatchesSummaryCategory(status, 'waiting')
      || listFilter === 'summary-in-progress' && conversationMatchesSummaryCategory(status, 'inProgress')
      || listFilter === 'summary-completed' && conversationMatchesSummaryCategory(status, 'completed');
    const typeId = typeIdForConversation(item);
    const typeName = item.conversationType?.name ?? conversationTypeOptions.get(typeId ?? '')?.name ?? '';
    const taskName = item.taskId ? tasks.find(task => task._id === item.taskId)?.name ?? '' : '';
    const searchable = [stripTaskPrefix(item.title), taskName, typeName].join(' ').toLocaleLowerCase('pt-BR');
    return matchesFilter && (!selectedTypeIds.length || selectedTypeIds.includes(typeId ?? '')) && (!searchNeedle || searchable.includes(searchNeedle));
  });
  const visibleConversationItems = hasConversationFilters ? filteredConversationItems.slice(0, filteredConversationLimit) : filteredConversationItems;
  const filteredHistoryPending = hasConversationFilters && Boolean(conversations.data?.next) && conversationSummary.isPending;
  useEffect(() => {
    if (!inbox.chooseAfterFilter && !selectedId && uniqueConversationItems[0]) setSelectedId(uniqueConversationItems[0]._id);
  }, [conversations.data, selectedId, inbox.chooseAfterFilter, olderConversationPages]);
  useEffect(() => { setOlderConversationPages([]); setOlderMessagePages([]); setSelectedId(''); setNewConversationTypeId(''); setNewConversationOpen(false); setSelectedTypeIds([]); setTypeSearch(''); setDebouncedTypeSearch(''); setListSearch(''); setDebouncedListSearch(''); setFilteredConversationLimit(50); setTitleEditing(false); setTitleDraft(''); setLinkTaskOpen(false); setTaskSearch(''); setDebouncedTaskSearch(''); setDraft(''); setNotice(''); }, [projectId]);
  useEffect(() => {
    if (!requestedConversationId) return;
    setSelectedId(requestedConversationId);
    onConversationSelected?.(requestedConversationId);
  }, [requestedConversationId]);
  useEffect(() => { setOlderMessagePages([]); setTitleEditing(false); setTitleDraft(''); setLinkTaskOpen(false); setTaskSearch(''); }, [selectedId]);
  useEffect(() => scheduleTaskSearch(taskSearch, setDebouncedTaskSearch), [taskSearch]);
  useEffect(() => scheduleTaskSearch(listSearch, setDebouncedListSearch, 300), [listSearch]);
  useEffect(() => scheduleTaskSearch(typeSearch, setDebouncedTypeSearch, 200), [typeSearch]);
  useEffect(() => { setFilteredConversationLimit(50); }, [debouncedListSearch, selectedTypeIds, listFilter]);

  const detail = useQuery({
    queryKey: ['conversation', nonce, projectId, selectedId],
    enabled: Boolean(token && nonce && projectId && selectedId),
    queryFn: () => query<ConversationDetail>(token, 'get_conversation', { projectId, conversationId: selectedId, limit: 50 }),
    refetchInterval: 4000
  });
  const latest = selectedId && detail.data?.conversation._id === selectedId ? detail.data : undefined;
  const lastMessagePage = olderMessagePages.at(-1);
  const messageCursor = lastMessagePage ? lastMessagePage.next ?? undefined : latest?.next ?? undefined;
  const readAttempt = useRef<ConversationReadAttempt | null>(null);
  const markRead = useMutation({
    mutationFn: (attempt: ConversationReadAttempt) => markConversationRead(token, projectId, attempt),
    onSuccess: async (_result, attempt) => Promise.all([
      client.invalidateQueries({ queryKey: ['conversations', nonce, projectId] }),
      client.invalidateQueries({ queryKey: ['conversation-summary', nonce, projectId] }),
      client.invalidateQueries({ queryKey: ['conversation', nonce, projectId, attempt.conversationId] })
    ])
  });
  useEffect(() => {
    if (latest?.conversation._id !== selectedId) return;
    const attempt = nextConversationReadAttempt(readAttempt.current, selectedId, latest.conversation.unread);
    if (!attempt) return;
    readAttempt.current = attempt;
    markRead.mutate(attempt);
  }, [latest?.conversation._id, latest?.conversation.unread?.count, latest?.conversation.unread?.cursor, selectedId, markRead.mutate]);
  const taskForId = (taskId: string) => latest?.task?._id === taskId ? latest.task : tasks.find(task => task._id === taskId);
  const featureNameForTask = (taskId: string) => {
    const featureId = taskForId(taskId)?.featureId;
    return featureId ? features.data?.find(feature => feature._id === featureId)?.name : undefined;
  };
  const featureLabelForTask = (taskId: string) => {
    const task = taskForId(taskId);
    if (!task) return features.isPending ? 'Carregando feature…' : 'Feature indisponível';
    if (!task.featureId) return 'Sem feature';
    return featureNameForTask(taskId) ?? (features.isPending ? 'Carregando feature…' : 'Feature indisponível');
  };
  const taskSearchResults = useQuery({
    queryKey: ['conversation-task-search', nonce, projectId, debouncedTaskSearch],
    enabled: Boolean(token && nonce && projectId && linkTaskOpen && latest && !latest.conversation.taskId && debouncedTaskSearch.length >= 2),
    queryFn: () => searchProjectTasks<{ items: TaskOption[] }>(token, projectId, debouncedTaskSearch)
  });
  const orderedMessages = [...olderMessagePages].reverse().flatMap(page => page.messages.slice().reverse()).concat(latest?.messages.slice().reverse() ?? []);
  const taskContext = useQuery({
    queryKey: ['conversation-task-context', nonce, projectId, latest?.task?._id],
    enabled: Boolean(token && nonce && projectId && latest?.task?._id),
    queryFn: () => query<TaskActivity>(token, 'get_task_context', { projectId, taskId: latest!.task!._id }),
    refetchInterval: 5000
  });
  const refresh = async (conversationId = selectedId) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['conversations', nonce, projectId] }),
      client.invalidateQueries({ queryKey: ['conversation-summary', nonce, projectId] }),
      client.invalidateQueries({ queryKey: ['conversation', nonce, projectId, conversationId] })
    ]);
  };
  async function loadOlderConversations() {
    const lastPage = olderConversationPages.at(-1);
    const after = lastPage ? lastPage.next ?? undefined : conversations.data?.next ?? undefined;
    if (!after || loadingOlderConversations) return;
    setLoadingOlderConversations(true);
    try {
      const page = await query<ConversationPage>(token, 'list_conversations', { projectId, limit: 50, after });
      setOlderConversationPages(current => [...current, page]);
    }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLoadingOlderConversations(false); }
  }
  async function loadOlderMessages() {
    const lastPage = olderMessagePages.at(-1);
    const after = lastPage ? lastPage.next ?? undefined : latest?.next ?? undefined;
    if (!after || loadingOlderMessages) return;
    setLoadingOlderMessages(true);
    try {
      const page = await query<ConversationDetail>(token, 'get_conversation', { projectId, conversationId: selectedId, limit: 50, after });
      setOlderMessagePages(current => [...current, page]);
    }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLoadingOlderMessages(false); }
  }
  const lastConversationPage = olderConversationPages.at(-1);
  const conversationCursor = lastConversationPage ? lastConversationPage.next ?? undefined : conversations.data?.next ?? undefined;
  const hasMoreFilteredItems = visibleConversationItems.length < filteredConversationItems.length;
  const canLoadConversationList = hasConversationFilters ? hasMoreFilteredItems || Boolean(!conversationSummary.data && conversationCursor) : Boolean(conversationCursor);
  useEffect(() => {
    const list = conversationListRef.current;
    const sentinel = conversationListSentinelRef.current;
    if (!list || !sentinel || !canLoadConversationList || loadingOlderConversations || loadingOlderMessages || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      if (hasConversationFilters && hasMoreFilteredItems) setFilteredConversationLimit(current => current + 50);
      else if (conversationCursor) void loadOlderConversations();
    }, { root: list, rootMargin: '120px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadConversationList, loadingOlderConversations, loadingOlderMessages, hasConversationFilters, hasMoreFilteredItems, conversationCursor]);
  const create = useMutation({
    mutationFn: (typeId?: string) => createProjectConversation<Conversation>(token, projectId, typeId),
    onSuccess: async created => { setNewConversationOpen(false); setSelectedId(created._id); onConversationSelected?.(created._id); setNotice('Conversa criada no escopo do projeto e compartilhada com as IAs via MCP.'); await refresh(created._id); },
    onError: error => setNotice(errorMessage(error))
  });
  const linkTask = useMutation({
    mutationFn: (taskId: string) => linkConversationTask<Conversation>(token, selectedId, projectId, taskId, latest!.conversation.version),
    onSuccess: async linked => { setLinkTaskOpen(false); setTaskSearch(''); setNotice('Conversa vinculada à tarefa.'); await refresh(linked._id); await client.invalidateQueries({ queryKey: ['project-tasks'] }); },
    onError: error => setNotice(errorMessage(error))
  });
  const deleteConversation = useMutation({
    mutationFn: () => deleteProjectConversation<{ deleted: boolean; conversationId: string }>(token, selectedId, projectId, latest!.conversation.version),
    onSuccess: async result => {
      const history = historyAfterConversationDeletion(conversations.data, olderConversationPages, result.conversationId);
      client.setQueryData<ConversationPage>(['conversations', nonce, projectId], history.current);
      setOlderConversationPages(history.olderPages);
      setSelectedId(history.selectedId);
      onConversationSelected?.(history.selectedId);
      setNotice('Conversa excluída do histórico. Tarefas e execuções foram mantidas.');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['conversations', nonce, projectId] }),
        client.invalidateQueries({ queryKey: ['conversation-summary', nonce, projectId] })
      ]);
    },
    onError: error => setNotice(errorMessage(error))
  });
  const renameConversation = useMutation({
    mutationFn: (title: string) => updateConversationTitle<Conversation>(token, selectedId, projectId, title, latest!.conversation.version),
    onSuccess: async updated => {
      const history = historyAfterConversationTitleUpdate(conversations.data, olderConversationPages, updated);
      client.setQueryData<ConversationPage>(['conversations', nonce, projectId], history.current);
      setOlderConversationPages(history.olderPages);
      client.setQueryData<ConversationDetail>(['conversation', nonce, projectId, updated._id], current => current ? { ...current, conversation: { ...current.conversation, ...updated } } : current);
      setTitleEditing(false);
      setTitleDraft('');
      setNotice('Título da conversa atualizado.');
      await refresh(updated._id);
    }
  });
  const send = useMutation({
    mutationFn: (content: string) => request(token, `/admin/conversations/${selectedId}/messages`, { body: { projectId, operationId: operationId(), content } }),
    onSuccess: async () => { setDraft(''); await refresh(); }
  });
  const approve = useMutation({
    mutationFn: (proposal: Proposal) => request<{ task: { _id: string; status: string }; job: { _id: string } }>(token, '/admin/conversations/approve-proposal', {
      body: { projectId, proposalId: proposal._id, version: proposal.version, operationId: operationId() }
    }),
    onSuccess: async result => { setNotice(`Execução autorizada para a tarefa ${result.task._id}. O resultado será enviado para revisão.`); await refresh(); await client.invalidateQueries({ queryKey: ['project-tasks'] }); }
  });

  function beginTitleEdit() {
    if (!latest) return;
    renameConversation.reset();
    setTitleDraft(latest.conversation.title);
    setTitleEditing(true);
    setNotice('');
  }
  function cancelTitleEdit() {
    renameConversation.reset();
    setTitleEditing(false);
    setTitleDraft('');
  }
  function submitTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (title && latest && selectedId) renameConversation.mutate(title);
  }
  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (content && selectedId) send.mutate(content);
  }
  function sendMessageOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (draft.trim() && selectedId && !send.isPending) event.currentTarget.form?.requestSubmit();
  }
  async function copyConversationId() {
    const conversationId = latest?.conversation._id ?? selectedId;
    if (!conversationId) return;
    if (await copyToClipboard(conversationId)) { setIdCopied(true); window.setTimeout(() => setIdCopied(false), 2000); }
    else setNotice(`Não foi possível copiar. ID da conversa: ${conversationId}`);
  }
  function confirmDeleteConversation() {
    confirmConversationDeletion(message => window.confirm(message), () => deleteConversation.mutate());
  }

  const messageCount = orderedMessages.length + (latest?.proposals.length ?? 0);
  function scrollToBottom(smooth = true) {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    // Rede de segurança: se a rolagem suave não terminar (aba em segundo plano, navegador sem animação), vai direto ao fim.
    if (smooth) window.setTimeout(() => { if (messagesRef.current && stickToBottom.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; }, 700);
    stickToBottom.current = true;
    setShowScrollBottom(false);
    setHasNewBelow(false);
  }
  function onMessagesScroll() {
    const element = messagesRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < 80;
    setShowScrollBottom(distance > 160);
    if (distance < 80) setHasNewBelow(false);
  }
  useEffect(() => { knownMessageCount.current = 0; stickToBottom.current = true; setShowScrollBottom(false); setHasNewBelow(false); }, [selectedId]);
  useEffect(() => {
    if (detail.isPending || !messagesRef.current) return;
    const firstLoad = knownMessageCount.current === 0;
    const grew = messageCount > knownMessageCount.current;
    knownMessageCount.current = messageCount;
    if (firstLoad || (grew && stickToBottom.current)) window.requestAnimationFrame(() => scrollToBottom(!firstLoad));
    else if (grew) setHasNewBelow(true);
  }, [messageCount, selectedId, detail.isPending, detailTab]);

  const showAside = Boolean(latest && latest.task);
  const phase = conversationPhase(latest?.proposals ?? [], latest?.jobs ?? []);
  const criteriaTotal = taskContext.data?.task.acceptance.length ?? 0;
  const criteriaDone = taskContext.data?.task.acceptanceProgress.filter(Boolean).length ?? 0;
  const sortedProposals = [...(latest?.proposals ?? [])].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.version - b.version);
  const pendingProposal = sortedProposals.find(proposal => proposal.status === 'pending' && !proposal.stale);
  const headerTitle = stripTaskPrefix(latest?.conversation.title) || 'Conversa';
  const suggestions = suggestionsFor(latest?.task, criteriaTotal);
  const draftValid = draft.trim().length > 0;
  // Mesmas abas no corpo da conversa (filho direto de `main`, não encolhe) e no topo do painel de critérios.
  const renderTabs = (inMain: boolean) => showAside ? <div className={'hidden gap-0.5 border-b border-[#eef0f4] bg-white px-3 max-[1280px]:flex' + (inMain ? ' flex-none' : '')} role="tablist" aria-label="Seções da conversa">
    <button type="button" role="tab" aria-selected={detailTab === 'chat'} className={tabClass} onClick={() => setDetailTab('chat')}>Conversa</button>
    <button type="button" role="tab" aria-selected={detailTab === 'criteria'} className={tabClass} onClick={() => setDetailTab('criteria')}>Critérios{criteriaTotal > 0 && <span className="min-w-[18px] rounded-[9px] bg-tone-slate-bg px-[5px] text-center text-[10px] leading-[18px] font-bold text-tone-slate">{criteriaDone}/{criteriaTotal}</span>}</button>
  </div> : null;
  function chooseConversation(id: string) { setSelectedId(id); setMobileView('detail'); setDetailTab('chat'); onConversationSelected?.(id); }
  function fillDraft(text: string) { setDraft(text); window.requestAnimationFrame(() => composerRef.current?.focus()); }

  const selectedNewConversationType = selectableConversationTypes.find(type => type._id === newConversationTypeId) ?? selectableConversationTypes.find(type => type.isDefault) ?? selectableConversationTypes[0];
  const renderNewConversationButton = (inHeading: boolean) => <button type="button" aria-haspopup="dialog" aria-expanded={newConversationOpen} aria-controls="new-conversation-type-dialog" className={newConversationButtonBase + (inHeading ? ' min-h-11 px-[18px]' : ' min-h-10 px-3.5')} onClick={() => setNewConversationOpen(true)} disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Nova conversa'}</button>;
  const taskCard = latest?.task ? <div className="grid items-center gap-2.5">
    <p className="font-display text-[15px] leading-[1.4] font-semibold text-ink wrap-anywhere">{renderInlineCode(stripTaskPrefix(latest.task.name))}</p>
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={statusTone[latest.task.status] ?? 'muted'}>{statusLabels[latest.task.status] ?? latest.task.status}</Badge>
      {latest.task.area ? <FilterLink param="area" value={latest.task.area} projectId={projectId} className={areaChipTones[latest.task.area] ?? areaChipDefault} title={`Filtrar tarefas pela área ${areaLabel(latest.task.area)}`}>{areaLabel(latest.task.area)}</FilterLink> : null}
      {latest.task.featureId ? <FeatureLink featureId={latest.task.featureId} name={featureLabelForTask(latest.task._id)} projectId={projectId} className={featureChip} title="Ver todas as tarefas desta feature"><IconFeature size={11} /><span className="overflow-hidden text-ellipsis">{featureLabelForTask(latest.task._id)}</span></FeatureLink> : null}
      <small className="text-ui-xs text-muted-strong">v{taskContext.data?.task.version ?? latest.task.version}</small>
    </div>
    <TaskLink taskId={latest.task._id} name={latest.task.name} projectId={projectId} className="text-[13px] font-semibold text-[#2455a6] wrap-anywhere hover:text-[#173e80] hover:underline" title={`Abrir tarefa ${latest.task.name} na listagem`} onOpen={() => onOpenTask(latest.task!._id)}>{latest.task.name}<span aria-hidden="true"> ↗</span></TaskLink>
  </div> : null;

  return <div className={workspaceBase}>
    <section className="grid flex-none grid-cols-3 gap-3 max-[640px]:grid-cols-1" aria-label="Indicadores de conversas">
      {[{ filter: 'summary-waiting' as const, label: 'Aguardando você', count: summaryCounts.waiting, tone: 'text-[#b56717]', surface: 'border-[#f0d9a8] bg-[#fffaf0]' }, { filter: 'summary-in-progress' as const, label: 'Em andamento', count: summaryCounts.inProgress, tone: 'text-[#4b4fcb]', surface: 'border-[#dfe4f4] bg-[#f8f9fc]' }, { filter: 'summary-completed' as const, label: 'Concluídas', count: summaryCounts.completed, tone: 'text-[#168458]', surface: 'border-[#d2eadb] bg-[#f5fbf7]' }].map(item => <button key={item.filter} type="button" aria-label={`Filtrar conversas: ${item.label} (${item.count})`} aria-pressed={listFilter === item.filter} onClick={() => setListFilter(listFilter === item.filter ? 'all' : item.filter)} className={`group grid min-h-[56px] cursor-pointer grid-cols-[1fr_auto] items-center gap-x-3 rounded-[12px] border px-4 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4b4fcb] aria-pressed:ring-2 aria-pressed:ring-[#4b4fcb] ${item.surface}`}>
        <span className="text-ui-sm font-semibold text-[#566275]">{item.label}</span><strong className={`row-span-2 text-[22px] leading-none font-bold tabular-nums ${item.tone}`} aria-label={`${item.count} ${item.count === 1 ? 'conversa' : 'conversas'}`}>{item.count}</strong><small className="text-ui-xs text-muted-strong">{item.count === 1 ? 'conversa' : 'conversas'}</small>
      </button>)}
    </section>
    <section className={`${layoutBase} ${showAside ? layoutColumnsAside : layoutColumns}${showAside && !asideOpen ? ` ${layoutCollapsed}` : ''}`} data-view={mobileView} data-tab={detailTab}>
    <aside className={`${sidebarBase} ${showAside ? sidebarWithAside : sidebarPlain}`} aria-label="Lista de conversas">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]">Conversas</h2><p className="mt-0.5 text-ui-sm text-muted-strong">Histórico compartilhado do projeto</p></div>
        {headingSlot ? null : <div className="flex flex-wrap gap-1.5">{renderNewConversationButton(false)}</div>}</div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2" role="search" aria-label="Buscar e filtrar conversas">
        <input type="search" className={`min-h-11 min-w-0 rounded-ui-md border border-line-strong bg-white py-0 pr-3 pl-9 text-ui-md ${searchIcon}`} value={listSearch} onChange={event => setListSearch(event.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas" />
        <details className="group/type-filter min-w-0 [&[open]]:col-span-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-ui-md border border-line-strong bg-white px-3 text-ui-sm font-semibold text-ink-2 marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4b4fcb] [&::-webkit-details-marker]:hidden"><span aria-hidden="true">Tipo</span><span className="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap">{selectedTypeIds.length ? `${selectedTypeIds.length} selecionado(s)` : 'Todos'}</span><IconChevron size={12} /></summary>
          <div className="mt-2 grid w-full min-w-0 gap-2 rounded-[12px] border border-[#e2e5eb] bg-white p-3">
            <strong className="text-[11px] text-[#435064]">Filtrar por tipo</strong>
            <input className={`${fieldInput} min-w-0`} type="search" value={typeSearch} onChange={event => setTypeSearch(event.target.value)} placeholder="Buscar tipo de conversa" aria-label="Buscar tipos de conversa" />
            {typeSearch.trim() !== debouncedTypeSearch && <small className="text-[10px] text-muted-strong" role="status">Buscando tipos…</small>}
            {conversationTypes.isPending ? <p className="py-3 text-center text-[11px] text-muted-strong" role="status">Carregando tipos…</p> : conversationTypes.isError ? <p className="text-[11px] text-[#a63942]" role="alert">Não foi possível carregar os tipos.</p> : <div className="grid max-h-40 gap-1 overflow-y-auto overscroll-contain" role="group" aria-label="Tipos de conversa">
              <button type="button" aria-pressed={!selectedTypeIds.length} onClick={() => { setSelectedTypeIds([]); setInbox(current => conversationInboxAfterFilter(current, current.filter)); onConversationSelected?.(''); }} className="flex min-h-9 items-center justify-between gap-2 rounded-[7px] px-2.5 text-left text-[11px] font-semibold text-[#485469] hover:bg-[#f5f6fa] aria-pressed:bg-[#eceefc] aria-pressed:text-[#343da5]">Todos os tipos<span className="text-[10px] tabular-nums text-muted-strong">{summaryItems.length}</span></button>
              {filteredTypeOptions.map(type => <button key={type.id} type="button" aria-pressed={selectedTypeIds.includes(type.id)} onClick={() => toggleTypeFilter(type.id)} className="flex min-h-9 items-center justify-between gap-2 rounded-[7px] px-2.5 text-left text-[11px] text-[#485469] hover:bg-[#f5f6fa] aria-pressed:bg-[#eceefc] aria-pressed:text-[#343da5]"><span className="min-w-0 truncate">{type.name}{type.archived ? <small className="ml-1.5 text-[9px] text-muted-strong">Arquivado</small> : null}</span><span className="text-[10px] tabular-nums text-muted-strong">{summaryItems.filter(item => typeIdForConversation(item) === type.id).length}</span></button>)}
              {!filteredTypeOptions.length && <p className="px-2 py-3 text-center text-[11px] text-muted-strong">Nenhum tipo corresponde à busca.</p>}
            </div>}
          </div>
        </details>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status das tarefas vinculadas">{listFilters.map(item => <button type="button" key={item.id} className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[#d5dae3] bg-white px-2.5 py-[5px] text-ui-xs font-semibold text-[#5b6475] aria-pressed:border-[#c9cbf3] aria-pressed:bg-[#eceefc] aria-pressed:text-[#2f31a0]" aria-pressed={listFilter === item.id} onClick={() => setListFilter(item.id)} title={item.id === 'review' ? 'Tarefas em revisão' : item.id === 'done' ? 'Tarefas concluídas' : undefined}>{item.label}{item.id !== 'done' && <span className="font-bold tabular-nums text-[#687386]">{item.count}</span>}</button>)}</div>
      {listSearch.trim() !== debouncedListSearch && <p className="-my-1 text-[10px] text-muted-strong" role="status">Buscando conversas…</p>}
      {filteredHistoryPending && <p className="-my-1 text-[10px] text-muted-strong" role="status">Buscando no histórico completo…</p>}
      {hasConversationFilters && conversations.data?.next && conversationSummary.isError && <div className={`${noticeTone.error} flex-none`} role="alert">A busca pode estar limitada às páginas carregadas. {errorMessage(conversationSummary.error)} <button type="button" className={textButton} onClick={() => void conversationSummary.refetch()}>Tentar novamente</button></div>}
      {conversations.isPending ? <Skeleton rows={5} label="Carregando conversas…" /> : conversations.isError ? <div className={noticeTone.error}>{errorMessage(conversations.error)}</div> : visibleConversationItems.length ? <div ref={conversationListRef} className="grid min-h-0 min-w-0 flex-auto content-start gap-1.5 overflow-x-hidden overflow-y-auto overscroll-contain max-[961px]:grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))]">{visibleConversationItems.map(item => {
        const task = item.taskId ? taskForId(item.taskId) : undefined;
        const unreadCount = item.unread?.count ?? 0;
        const lastActivity = item.lastMessageAt || (unreadCount > 0 ? item.updatedAt : undefined);
        const typeId = typeIdForConversation(item);
        const typeName = item.conversationType?.name ?? conversationTypeOptions.get(typeId)?.name ?? 'Geral';
        return <button type="button" key={item._id} aria-current={selectedId === item._id ? 'true' : undefined} className={selectedId === item._id ? listItemTones.active : unreadCount > 0 ? listItemTones.unread : listItemTones.idle} onClick={() => chooseConversation(item._id)}><div className="flex items-start justify-between gap-2"><strong className={'line-clamp-3 text-[13.5px] leading-[1.4] wrap-anywhere ' + (unreadCount > 0 ? 'font-extrabold text-[#1f2937]' : 'font-semibold text-[#3f4b60]')}>{stripTaskPrefix(item.title) || 'Nova conversa'}</strong>{unreadCount > 0 && <span className="inline-flex h-[22px] min-w-[22px] flex-none items-center justify-center rounded-full bg-[#1f9d5b] px-1.5 text-center text-[11px] leading-none font-bold text-white" aria-label={`${unreadCount} ${unreadCount === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</div><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><Badge tone="blue" wrap>{typeName}</Badge>{task && <Badge tone={statusTone[task.status] ?? 'muted'} wrap>{statusLabels[task.status] ?? task.status}</Badge>}<span className={'min-w-0 text-[12px] leading-[1.35] wrap-anywhere ' + messageStateTones[unreadCount > 0 ? 'unread' : lastActivity ? 'read' : 'empty']} title={lastActivity ? formatDate(lastActivity) : undefined}>{activityText(unreadCount, lastActivity, relativeTime)}</span>{item.createdAt && <time className="text-[10px] leading-[1.35] text-muted-strong" dateTime={item.createdAt} title={formatDate(item.createdAt)}>Criada {relativeTime(item.createdAt)}</time>}</div></button>;
      })}{canLoadConversationList && <div ref={conversationListSentinelRef} className="grid justify-items-center gap-1 p-2.5">
          {hasMoreFilteredItems ? <button type="button" className={buttonGhost} onClick={() => setFilteredConversationLimit(current => current + 50)}>Carregar mais resultados</button> : conversationCursor ? <button type="button" className={buttonGhost} disabled={loadingOlderConversations} onClick={() => void loadOlderConversations()}>{loadingOlderConversations ? 'Carregando…' : 'Carregar conversas anteriores'}</button> : null}
          {loadingOlderConversations && <span className="text-[10px] text-muted-strong" role="status">Carregando conversas…</span>}
        </div>}</div> : filteredHistoryPending ? <div className={emptyStateBox} role="status">Buscando conversas no histórico…</div> : (hasConversationFilters || conversations.data?.items.length) ? <div className={emptyStateBox}><h3 className={emptyHeading}>Nenhuma conversa nesse filtro.</h3><button type="button" className={buttonSecondarySmall} onClick={() => { setListFilter('all'); setListSearch(''); setSelectedTypeIds([]); }}>Limpar filtros</button></div> : <div className={emptyStateBox}><h3 className={emptyHeading}>Comece uma conversa</h3><p className={emptyText}>Crie uma conversa Geral ou escolha outro fluxo e vincule uma tarefa pelo cabeçalho do chat.</p></div>}
    </aside>
    <section className={`${mainBase} ${showAside ? mainWithAside : mainPlain}`} aria-label="Conversa">
      {!selectedId ? <div className="grid flex-none justify-items-center gap-2 px-5 py-[54px] text-center"><h2 className="font-display text-[16px] leading-[normal] font-bold text-[#394558]">{inbox.chooseAfterFilter ? 'Escolha uma conversa' : 'Conversa do projeto'}</h2><p className={emptyText}>{inbox.chooseAfterFilter ? 'O painel está limpo. Selecione uma conversa nos resultados do filtro.' : 'Selecione uma conversa ou crie uma nova para começar.'}</p></div> : <>
        <button type="button" className="mx-3 mt-2.5 hidden flex-none self-start rounded-[8px] bg-[#f3f4f8] px-3 py-2 text-ui-sm font-semibold text-ink-2 max-[768px]:inline-flex" onClick={() => setMobileView('list')}>← Conversas</button>
        <header className="block flex-none border-b border-[#eef0f4] px-5 pt-4 pb-3 max-[768px]:px-3.5 max-[768px]:py-3"><div className="grid min-w-0 gap-2">
          <div className="flex items-center justify-between gap-2"><p className="text-ui-sm text-[#8791a1] max-[768px]:hidden">{latest?.conversation.taskId ? 'Conversa vinculada à tarefa' : 'Escopo do projeto'}</p>
            <div className="flex items-center justify-end gap-[7px] max-[481px]:w-full">
              {latest && !latest.conversation.taskId && <button type="button" className={`${buttonSecondarySmall} max-[481px]:flex-auto`} onClick={() => setLinkTaskOpen(open => !open)} disabled={linkTask.isPending}>{linkTaskOpen ? 'Fechar busca' : 'Vincular tarefa'}</button>}
              <button type="button" className={`${buttonGhostSmall} max-[481px]:flex-auto`} title={latest ? `Copiar ID: ${latest.conversation._id}` : undefined} onClick={() => void copyConversationId()}>{idCopied ? 'ID copiado' : 'Copiar ID'}</button>
              {showAside && <button type="button" className={`${buttonGhostSmall} max-[1280px]:hidden max-[481px]:flex-auto`} aria-expanded={asideOpen} onClick={() => setAsideOpen(open => !open)}>{asideOpen ? 'Ocultar painel' : `Critérios ${criteriaDone}/${criteriaTotal}`}</button>}
              <DropdownMenu ariaLabel="Mais ações da conversa" title="Mais ações" triggerClassName="inline-grid size-8 flex-none place-items-center rounded-[7px] border border-line-strong bg-transparent text-[15px] text-[#8792a2] hover:bg-[#f6f7fc] hover:text-[#4c5bc9]" items={[{ id: 'edit', label: 'Editar título', disabled: !latest }, { id: 'delete', label: 'Excluir conversa…', danger: true, dividerBefore: true, disabled: !latest || deleteConversation.isPending }]} onSelect={action => { if (action === 'edit') beginTitleEdit(); else confirmDeleteConversation(); }}><IconMore size={16} /></DropdownMenu>
            </div></div>
          {titleEditing ? <ConversationTitleEditor title={headerTitle} editing draft={titleDraft} editable saving={renameConversation.isPending} error={renameConversation.isError ? renameConversation.error : undefined} onEdit={beginTitleEdit} onDraftChange={setTitleDraft} onSave={submitTitle} onCancel={cancelTitleEdit} /> : <h2 className="mb-[5px] font-display text-[15px] leading-[1.4] font-bold tracking-normal text-[#394558] wrap-anywhere">{renderInlineCode(headerTitle)}</h2>}
        </div></header>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef0f4] bg-white pr-4"><div className="min-w-0 flex-1"><ConversationStepper phase={phase} stages={latest?.conversation.conversationType?.stages} /></div>{latest && <span className="mr-1 rounded-full border border-[#dbe0f4] bg-[#f6f7ff] px-2.5 py-1 text-[10px] font-semibold text-[#4b57b2]">Tipo · {latest.conversation.conversationType?.name ?? 'Geral'}</span>}</div>
        {renderTabs(true)}
        {linkTaskOpen && latest && !latest.conversation.taskId && <ConversationTaskSearch value={taskSearch} debouncedValue={debouncedTaskSearch} isFetching={taskSearchResults.isFetching} isError={taskSearchResults.isError} error={taskSearchResults.error} tasks={taskSearchResults.data?.items ?? []} onChange={setTaskSearch} onSelect={taskId => linkTask.mutate(taskId)} disabled={linkTask.isPending} featureLabel={task => task.featureId ? features.data?.find(feature => feature._id === task.featureId)?.name ?? 'Carregando…' : 'Sem feature'} />}
        {notice && <div className={`${noticeTone.info} flex-none`} role="status">{notice}</div>}
        {markRead.isError && readAttempt.current?.conversationId === selectedId && <ConversationReadFailure error={markRead.error} retrying={markRead.isPending} retry={() => { if (readAttempt.current) markRead.mutate(readAttempt.current); }} />}
        {detail.isPending ? <Skeleton rows={6} label="Carregando mensagens…" /> : detail.isError ? <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} title="Não foi possível carregar a conversa" /> : <>
          <div className="flex min-h-0 flex-auto flex-col max-[768px]:flex-[1_0_auto]">
            {messageCursor && <button type="button" className={`${buttonGhost} m-2 flex-none self-center`} disabled={loadingOlderMessages} onClick={() => void loadOlderMessages()}>{loadingOlderMessages ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}
            <div className="relative flex min-h-0 flex-auto max-[768px]:min-h-[240px]"><div className="grid min-h-0 flex-auto content-start gap-3.5 overflow-y-auto bg-white px-[max(20px,calc((100%_-_740px)/2))] py-6 max-[768px]:px-3.5 max-[768px]:py-3" aria-live="polite" ref={messagesRef} onScroll={onMessagesScroll} tabIndex={0} aria-label="Mensagens da conversa">{orderedMessages.length || sortedProposals.length ? <>
              {orderedMessages.map(message => {
                const agent = message.authorType === 'agent';
                return <article key={message._id} className={`flex min-w-0 max-w-full items-start gap-2.5 text-ui-md wrap-anywhere ${agent ? 'justify-self-start rounded-bl-[5px]' : 'flex-row-reverse justify-self-end rounded-br-[5px]'}`}>
                {agent ? <span className="inline-grid size-8 flex-none place-items-center rounded-[9px] bg-[#4b4fcb] text-[11px] font-bold text-white [&_svg]:size-[17px] [&_svg]:text-white!" aria-hidden="true"><AgentClientIcon clientName={message.clientName} /></span> : <span className="inline-grid size-8 flex-none place-items-center rounded-full bg-[#e8eafd] text-[11px] font-bold text-[#4b4fcb]" aria-hidden="true">{personInitials(message.author)}</span>}
                <div className={'grid min-w-0 max-w-[min(82%,720px)] gap-1 max-[768px]:max-w-[calc(100%_-_44px)]' + (agent ? '' : ' justify-items-end')}><div className="flex flex-wrap justify-start gap-x-2.5 gap-y-1 text-ui-sm text-[#536176]"><strong className={agent ? 'inline-flex max-w-full min-w-0 flex-wrap items-center gap-[5px] text-[#334155] wrap-anywhere' : 'text-[#285b35]'}>{agent ? <span>{message.clientName?.trim() || 'IA'} ({authorDisplayName(message.author)})</span> : `Pessoa (${authorDisplayName(message.author)})`}</strong><time className="text-muted-strong" dateTime={message.createdAt} title={formatDate(message.createdAt)}>{relativeTime(message.createdAt)}</time></div><div className={'min-w-0 rounded-[16px] border px-3.5 py-2.5 text-[14px] wrap-anywhere ' + (agent ? 'rounded-tl-[4px] border-[#e2e5eb] bg-white' : 'rounded-tr-[4px] border-[#d6dafc] bg-[#e8eafd]')}><MarkdownView content={message.content} variant="chat" /></div></div>
              </article>;
              })}
              {sortedProposals.map(proposal => <ProposalCard key={proposal._id} proposal={proposal} taskVersion={latest?.task?.version} job={latest?.jobs.find(job => job._id === proposal.jobId)} approving={approve.isPending && approve.variables?._id === proposal._id} error={approve.isError && approve.variables?._id === proposal._id ? errorMessage(approve.error) : undefined} onApprove={item => approve.mutate(item)} onRequestChanges={() => composerRef.current?.focus()} />)}
            </> : <div className="mx-auto my-6 grid max-w-[520px] justify-items-center gap-2.5 text-center">
              <h3 className="font-display text-[17px] leading-[normal] font-bold text-ink">Comece pelo objetivo {latest?.task ? 'da tarefa' : 'da conversa'}</h3>
              <p className="text-[14px] text-muted-strong">Descreva o que precisa, as restrições e o que já sabe. As IAs conectadas ao MCP leem esta conversa{latest?.task ? ' e a tarefa vinculada' : ''}.</p>
              {latest?.task && <p className="rounded-full border border-dashed border-line-strong px-3 py-1.5 text-ui-sm text-muted-strong">Contexto disponível: Tarefa · {plural(criteriaTotal, 'critério', 'critérios')}</p>}
              <div className="mt-1.5 grid w-full gap-2" role="group" aria-label="Sugestões de mensagem">{suggestions.map(text => <button type="button" className="min-h-11 rounded-ui-md border border-line-strong bg-white px-3.5 py-2.5 text-left text-[13.5px] text-ink-2 hover:border-[#4b4fcb] hover:bg-[#f5f6ff]" key={text} onClick={() => fillDraft(text)}>{text}</button>)}</div>
            </div>}</div>{showScrollBottom && <button type="button" className={`${scrollBottomBase} ${hasNewBelow ? 'border-[#4b4fcb] bg-[#4b4fcb] text-white' : 'border-[#c8cdf5] bg-white text-[#4b4fcb] hover:bg-[#f5f6ff]'}`} onClick={() => scrollToBottom()} aria-label={hasNewBelow ? 'Ir para as novas mensagens' : 'Ir para a última mensagem'}><IconChevron size={14} />{hasNewBelow ? 'Novas mensagens' : 'Última mensagem'}</button>}</div>
            {pendingProposal && <a className="mx-5 mt-2 block rounded-ui-md border border-[#f0d9a8] bg-[#fffaf0] px-3.5 py-2.5 text-ui-sm text-tone-amber no-underline max-[768px]:hidden" href="#conversation-proposals" onClick={event => { event.preventDefault(); document.querySelector('[data-proposal]:not([data-approved])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>Há uma proposta aguardando sua autorização. <strong className="underline">Ver proposta</strong></a>}
            <form className="mx-auto mb-5 grid w-[min(740px,calc(100%_-_40px))] gap-2 rounded-[14px] border border-[#d5d9e6] bg-white py-2.5 pr-2.5 pl-3.5 focus-within:border-[#4b4fcb] focus-within:shadow-[0_0_0_3px_#eef0ff] max-[768px]:pt-2.5 max-[768px]:pr-3.5 max-[768px]:pb-3 max-[768px]:pl-3.5" onSubmit={submitMessage}><label className="absolute size-px overflow-hidden text-[10px] font-semibold text-[#566275] [clip:rect(0,0,0,0)]" htmlFor="conversation-message">Mensagem</label><textarea className="max-h-[180px] min-h-16 w-full min-w-0 resize-none bg-transparent px-0 py-1 text-[14px] text-[#344054] focus:shadow-none focus-visible:outline-none! max-[768px]:min-h-14" id="conversation-message" ref={composerRef} rows={3} maxLength={20000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={sendMessageOnEnter} placeholder="Descreva o objetivo, as restrições e as dúvidas…" aria-invalid={send.isError} />
              {send.isError && <div className={noticeTone.error} role="alert">Não foi possível enviar: {errorMessage(send.error)} <button type="button" className={textButton} disabled={send.isPending || !draftValid} onClick={() => send.mutate(draft.trim())}>Tentar novamente</button></div>}
              <div className="flex items-center justify-between gap-3"><small className="text-ui-xs text-[#8791a1]">Enter envia · Shift+Enter quebra a linha</small><button className={sendButtonBase + (draftValid ? ' bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark' : ' bg-[#e3e6ec] text-[#5f6877] opacity-100')} disabled={!draftValid || send.isPending}>{send.isPending ? 'Enviando…' : 'Enviar'}</button></div></form>
          </div>
        </>}
      </>}
    </section>
    {headingSlot && createPortal(<div className="flex flex-wrap gap-2">{renderNewConversationButton(true)}</div>, headingSlot)}
    {showAside && latest && <ConversationAside detail={latest} taskContext={taskContext} onOpenAdmin={onOpenAdmin} tabs={renderTabs(false)} collapsed={!asideOpen} token={token} nonce={nonce} projectId={projectId} hasPendingProposal={Boolean(pendingProposal)} taskCard={taskCard} />}
    </section>
    <ConversationTypeDialog open={newConversationOpen} types={selectableConversationTypes} selectedTypeId={newConversationTypeId} loading={conversationTypes.isPending} error={conversationTypes.isError} creating={create.isPending} creationError={create.isError ? errorMessage(create.error) : undefined} onSelect={setNewConversationTypeId} onClose={() => setNewConversationOpen(false)} onCreate={() => create.mutate(selectedNewConversationType?._id)} />
  </div>;
}
