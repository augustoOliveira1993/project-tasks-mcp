import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, query, request } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { areaLabel, relativeTime } from '../../lib/labels';
import { routeUrl } from '../../route-state';
import { statusLabels, statusTone } from '../../features/tasks/status';
import { Badge } from '../ui/Badge';
import { ErrorNotice } from '../ui/ErrorNotice';
import { IconFeature } from '../ui/icons';
import { FeatureLink, FilterLink } from '../ui/Links';
import { MarkdownView } from '../ui/MarkdownView';
import { Skeleton } from '../ui/Skeleton';
import { confirmConversationDeletion, createProjectConversation, deleteProjectConversation, historyAfterConversationDeletion, historyAfterConversationTitleUpdate, linkConversationTask, markConversationRead, nextConversationReadAttempt, scheduleTaskSearch, searchProjectTasks, updateConversationTitle, type ConversationReadAttempt } from './conversation-actions';
import { ConversationAside } from './ConversationAside';
import { AgentClientIcon, authorDisplayName } from './ConversationParts';
import type { Conversation, ConversationDetail, ConversationPage, Feature, Proposal, TaskActivity, TaskOption } from './conversation-types';

export function ConversationReadFailure({ error, retry, retrying = false }: { error: unknown; retry: () => void; retrying?: boolean }) {
  return <div className="notice error" role="alert">{errorMessage(error)} <button type="button" className="text-button" onClick={retry} disabled={retrying}>{retrying ? 'Tentando…' : 'Tentar novamente'}</button></div>;
}

export function ConversationTaskSearch({ value, debouncedValue, isFetching, isError, error, tasks, onChange, onSelect, disabled, featureLabel }: {
  value: string; debouncedValue: string; isFetching: boolean; isError: boolean; error: unknown; tasks: TaskOption[];
  onChange: (value: string) => void; onSelect: (taskId: string) => void; disabled: boolean; featureLabel: (task: TaskOption) => string;
}) {
  return <section className="conversation-task-link"><label htmlFor="conversation-task-search">Buscar tarefa</label><input id="conversation-task-search" type="search" value={value} onChange={event => onChange(event.target.value)} placeholder="Digite o início do nome da tarefa…" autoComplete="off" /><small>Digite ao menos 2 caracteres. A busca considera tarefas ativas deste projeto.</small>{debouncedValue.length < 2 ? <div className="empty-state compact">Digite ao menos 2 caracteres para buscar tarefas.</div> : isFetching ? <div className="loading">Buscando tarefas…</div> : isError ? <div className="notice error">{errorMessage(error)}</div> : tasks.length ? <div className="conversation-task-options" role="listbox" aria-label="Tarefas encontradas">{tasks.map(task => <button type="button" role="option" aria-selected="false" className="conversation-task-option" key={task._id} onClick={() => onSelect(task._id)} disabled={disabled}><strong>{task.name}</strong><span className="conversation-context-badges"><Badge tone="blue">Área · {areaLabel(task.area)}</Badge><Badge tone={statusTone[task.status] ?? 'muted'}>Status · {statusLabels[task.status] ?? task.status}</Badge><Badge tone="muted">Feature · {featureLabel(task)}</Badge></span></button>)}</div> : <div className="empty-state compact">Nenhuma tarefa ativa corresponde à busca.</div>}</section>;
}

export function ConversationTitleEditor({ title, editing, draft, editable, saving, error, onEdit, onDraftChange, onSave, onCancel }: {
  title: string; editing: boolean; draft: string; editable: boolean; saving: boolean; error?: unknown;
  onEdit: () => void; onDraftChange: (value: string) => void; onSave: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  if (!editing) return <div className="conversation-title-display"><h2>{title}</h2>{editable && <button type="button" className="button ghost small-button" aria-label="Editar título da conversa" onClick={onEdit}>Editar título</button>}</div>;
  return <form className="conversation-title-editor" onSubmit={onSave}><label className="conversation-title-label" htmlFor="conversation-title">Título da conversa</label><input id="conversation-title" aria-label="Título da conversa" type="text" maxLength={255} value={draft} onChange={event => onDraftChange(event.target.value)} autoFocus /><div className="button-row"><button type="submit" className="button primary small-button" disabled={!draft.trim() || saving}>{saving ? 'Salvando…' : 'Salvar título'}</button><button type="button" className="button secondary small-button" onClick={onCancel} disabled={saving}>Cancelar</button></div>{error !== undefined && error !== null && <div className="notice error" role="alert">{errorMessage(error)}</div>}</form>;
}

export function ConversationPanel({ token, nonce, projectId, tasks, requestedConversationId, onConversationSelected, onOpenTask, onOpenAdmin }: { token: string; nonce: string; projectId: string; tasks: TaskOption[]; requestedConversationId?: string; onConversationSelected?: (conversationId: string) => void; onOpenTask: (taskId: string) => void; onOpenAdmin: () => void }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState(requestedConversationId ?? '');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [linkTaskOpen, setLinkTaskOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [debouncedTaskSearch, setDebouncedTaskSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [olderConversationPages, setOlderConversationPages] = useState<ConversationPage[]>([]);
  const [olderMessagePages, setOlderMessagePages] = useState<ConversationDetail[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const conversations = useQuery({
    queryKey: ['conversations', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => query<ConversationPage>(token, 'list_conversations', { projectId, limit: 50 }),
    refetchInterval: 5000
  });
  const features = useQuery({
    queryKey: ['project-features', nonce, projectId],
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => allRecords<Feature>(token, { kind: 'feature', projectId, archived: false })
  });
  const conversationItems = [...(conversations.data?.items ?? []), ...olderConversationPages.flatMap(page => page.items)];
  const uniqueConversationItems = [...new Map(conversationItems.map(item => [item._id, item])).values()];
  const unreadConversationCount = uniqueConversationItems.filter(item => (item.unread?.count ?? 0) > 0).length;
  const visibleConversationItems = unreadOnly ? uniqueConversationItems.filter(item => (item.unread?.count ?? 0) > 0 || item._id === selectedId) : uniqueConversationItems;
  useEffect(() => {
    if (!selectedId && uniqueConversationItems[0]) setSelectedId(uniqueConversationItems[0]._id);
  }, [conversations.data, selectedId]);
  useEffect(() => { setOlderConversationPages([]); setOlderMessagePages([]); setSelectedId(''); setTitleEditing(false); setTitleDraft(''); setLinkTaskOpen(false); setTaskSearch(''); setDebouncedTaskSearch(''); setDraft(''); setNotice(''); }, [projectId]);
  useEffect(() => {
    if (!requestedConversationId) return;
    setSelectedId(requestedConversationId);
    onConversationSelected?.(requestedConversationId);
  }, [requestedConversationId]);
  useEffect(() => { setOlderMessagePages([]); setTitleEditing(false); setTitleDraft(''); setLinkTaskOpen(false); setTaskSearch(''); }, [selectedId]);
  useEffect(() => scheduleTaskSearch(taskSearch, setDebouncedTaskSearch), [taskSearch]);

  const detail = useQuery({
    queryKey: ['conversation', nonce, projectId, selectedId],
    enabled: Boolean(token && nonce && projectId && selectedId),
    queryFn: () => query<ConversationDetail>(token, 'get_conversation', { projectId, conversationId: selectedId, limit: 50 }),
    refetchInterval: 4000
  });
  const latest = detail.data;
  const readAttempt = useRef<ConversationReadAttempt | null>(null);
  const markRead = useMutation({
    mutationFn: (attempt: ConversationReadAttempt) => markConversationRead(token, projectId, attempt),
    onSuccess: async (_result, attempt) => Promise.all([
      client.invalidateQueries({ queryKey: ['conversations', nonce, projectId] }),
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
      client.invalidateQueries({ queryKey: ['conversation', nonce, projectId, conversationId] })
    ]);
  };
  async function loadOlderConversations() {
    const after = olderConversationPages.at(-1)?.next ?? conversations.data?.next;
    if (!after || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await query<ConversationPage>(token, 'list_conversations', { projectId, limit: 50, after });
      setOlderConversationPages(current => [...current, page]);
    }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLoadingOlder(false); }
  }
  async function loadOlderMessages() {
    const after = olderMessagePages.at(-1)?.next ?? latest?.next;
    if (!after || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await query<ConversationDetail>(token, 'get_conversation', { projectId, conversationId: selectedId, limit: 50, after });
      setOlderMessagePages(current => [...current, page]);
    }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setLoadingOlder(false); }
  }
  const create = useMutation({
    mutationFn: () => createProjectConversation<Conversation>(token, projectId),
    onSuccess: async created => { setSelectedId(created._id); onConversationSelected?.(created._id); setNotice('Conversa criada no escopo do projeto e compartilhada com as IAs via MCP.'); await refresh(created._id); },
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
      await client.invalidateQueries({ queryKey: ['conversations', nonce, projectId] });
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
    onSuccess: async () => { setDraft(''); await refresh(); },
    onError: error => setNotice(errorMessage(error))
  });
  const approve = useMutation({
    mutationFn: (proposal: Proposal) => request<{ task: { _id: string; status: string }; job: { _id: string } }>(token, '/admin/conversations/approve-proposal', {
      body: { projectId, proposalId: proposal._id, version: proposal.version, operationId: operationId() }
    }),
    onSuccess: async result => { setNotice(`Execução autorizada para a tarefa ${result.task._id}. O resultado será enviado para revisão.`); await refresh(); await client.invalidateQueries({ queryKey: ['project-tasks'] }); },
    onError: error => setNotice(errorMessage(error))
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
    const copyWithFallback = () => {
      const field = document.createElement('textarea');
      field.value = conversationId;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '-1000px';
      field.style.left = '0';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('Clipboard copy failed');
    };
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(conversationId);
      else copyWithFallback();
      setNotice('ID da conversa copiado.');
    } catch {
      try { copyWithFallback(); setNotice('ID da conversa copiado.'); }
      catch { setNotice(`Não foi possível copiar. ID da conversa: ${conversationId}`); }
    }
  }
  function confirmDeleteConversation() {
    confirmConversationDeletion(message => window.confirm(message), () => deleteConversation.mutate());
  }

  const showAside = Boolean(latest && (latest.task || latest.proposals.length));
  const pendingProposal = latest?.proposals.find(proposal => proposal.status === 'pending' && !proposal.stale);

  return <section className={'conversation-layout' + (showAside ? ' has-aside' : '')}>
    <aside className="panel-card conversation-sidebar">
      <div className="section-heading"><div><h2>Conversas</h2><p className="muted-text">Histórico compartilhado do projeto</p></div></div>
      <button type="button" className="button primary conversation-new-button" onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Nova conversa'}</button>
      <div className="conversation-filters" role="group" aria-label="Filtrar conversas"><button type="button" className={'conversation-filter' + (!unreadOnly ? ' active' : '')} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Tudo</button><button type="button" className={'conversation-filter' + (unreadOnly ? ' active' : '')} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Não lidas{unreadConversationCount > 0 && <span className="conversation-filter-count">{unreadConversationCount}</span>}</button></div>
      {conversations.isPending ? <Skeleton rows={5} label="Carregando conversas…" /> : conversations.isError ? <div className="notice error">{errorMessage(conversations.error)}</div> : visibleConversationItems.length ? <><div className="conversation-list">{visibleConversationItems.map(item => {
        const task = item.taskId ? taskForId(item.taskId) : undefined;
        const unreadCount = item.unread?.count ?? 0;
        return <button type="button" key={item._id} aria-current={selectedId === item._id ? 'true' : undefined} className={'conversation-list-item' + (selectedId === item._id ? ' active' : '') + (unreadCount > 0 ? ' unread' : '')} onClick={() => { setSelectedId(item._id); onConversationSelected?.(item._id); }}><div className="conversation-list-item-head"><strong>{item.title || 'Nova conversa'}</strong>{unreadCount > 0 && <span className="conversation-unread-dot" aria-label={`${unreadCount} mensagens não lidas`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</div><small>{item.taskId ? 'Tarefa vinculada · ' + (task?.name ?? item.taskId.slice(0, 8)) : 'Escopo do projeto'} · <time dateTime={item.lastMessageAt || item.updatedAt} title={formatDate(item.lastMessageAt || item.updatedAt)}>{relativeTime(item.lastMessageAt || item.updatedAt)}</time></small>{task && <div className="conversation-context-badges"><Badge tone={statusTone[task.status] ?? 'muted'}>{statusLabels[task.status] ?? task.status}</Badge></div>}</button>;
      })}</div>{(olderConversationPages.at(-1)?.next ?? conversations.data?.next) && <button type="button" className="button ghost" disabled={loadingOlder} onClick={() => void loadOlderConversations()}>{loadingOlder ? 'Carregando…' : 'Carregar conversas anteriores'}</button>}</> : <div className="empty-state compact"><h3>Comece uma conversa</h3><p>Crie uma conversa geral e vincule uma tarefa pelo cabeçalho do chat.</p></div>}
    </aside>
    <div className="panel-card conversation-main">
      {!selectedId ? <div className="empty-state"><h2>Conversa do projeto</h2><p>Selecione uma conversa ou crie uma nova para começar.</p></div> : <>
        <header className="conversation-header"><div className="conversation-header-main"><ConversationTitleEditor title={latest?.conversation.title ?? 'Conversa'} editing={titleEditing} draft={titleDraft} editable={Boolean(latest)} saving={renameConversation.isPending} error={renameConversation.isError ? renameConversation.error : undefined} onEdit={beginTitleEdit} onDraftChange={setTitleDraft} onSave={submitTitle} onCancel={cancelTitleEdit} /><p className="muted-text">{latest?.conversation.taskId ? 'Conversa vinculada à tarefa' : 'Escopo do projeto'}</p>{latest?.task && <div className="conversation-task-card"><a className="conversation-task-anchor" href={routeUrl('tasks', `taskId=${encodeURIComponent(latest.task._id)}`, projectId)} aria-label={`Abrir tarefa ${latest.task.name} na listagem`} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenTask(latest.task!._id); }}>{latest.task.name}</a><Badge tone={statusTone[latest.task.status] ?? 'muted'}>{statusLabels[latest.task.status] ?? latest.task.status}</Badge>{latest.task.area ? <FilterLink param="area" value={latest.task.area} projectId={projectId} className={`chip chip-area chip-area-${latest.task.area} entity-chip`} title={`Filtrar tarefas pela área ${areaLabel(latest.task.area)}`}>{areaLabel(latest.task.area)}</FilterLink> : <span className="chip chip-area chip-area-none">{areaLabel(latest.task.area)}</span>}{latest.task.featureId ? <FeatureLink featureId={latest.task.featureId} projectId={projectId} className="chip chip-feature entity-chip" title="Ver todas as tarefas desta feature"><IconFeature size={11} /><span>{featureLabelForTask(latest.task._id)}</span></FeatureLink> : <span className="chip chip-feature"><IconFeature size={11} /><span>Sem feature</span></span>}<small>v{taskContext.data?.task.version ?? latest.task.version}</small></div>}</div><div className="conversation-header-actions">{latest && !latest.conversation.taskId && <button type="button" className="button secondary" onClick={() => setLinkTaskOpen(open => !open)} disabled={linkTask.isPending}>{linkTaskOpen ? 'Fechar busca' : 'Vincular tarefa'}</button>}<button type="button" className="button ghost small-button" title={latest ? `Copiar ID: ${latest.conversation._id}` : undefined} onClick={() => void copyConversationId()}>Copiar ID</button><button type="button" className="button ghost small-button danger-text" onClick={confirmDeleteConversation} disabled={!latest || deleteConversation.isPending}>{deleteConversation.isPending ? 'Excluindo…' : 'Excluir conversa'}</button></div></header>
        {pendingProposal && <a className="conversation-pending-banner" href="#conversation-proposals">Há uma proposta aguardando sua autorização. <strong>Ver proposta</strong></a>}
        {linkTaskOpen && latest && !latest.conversation.taskId && <ConversationTaskSearch value={taskSearch} debouncedValue={debouncedTaskSearch} isFetching={taskSearchResults.isFetching} isError={taskSearchResults.isError} error={taskSearchResults.error} tasks={taskSearchResults.data?.items ?? []} onChange={setTaskSearch} onSelect={taskId => linkTask.mutate(taskId)} disabled={linkTask.isPending} featureLabel={task => task.featureId ? features.data?.find(feature => feature._id === task.featureId)?.name ?? 'Carregando…' : 'Sem feature'} />}
        {notice && <div className="notice" role="status">{notice}</div>}
        {markRead.isError && readAttempt.current?.conversationId === selectedId && <ConversationReadFailure error={markRead.error} retrying={markRead.isPending} retry={() => { if (readAttempt.current) markRead.mutate(readAttempt.current); }} />}
        {detail.isPending ? <Skeleton rows={6} label="Carregando mensagens…" /> : detail.isError ? <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} title="Não foi possível carregar a conversa" /> : <>
          {(olderMessagePages.at(-1)?.next ?? latest?.next) && <button type="button" className="button ghost" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}
          <div className="conversation-messages" aria-live="polite">{orderedMessages.length ? orderedMessages.map(message => <article key={message._id} className={`conversation-message ${message.authorType}`}><div className="conversation-message-meta"><strong className={message.authorType === 'agent' ? 'conversation-agent-identity' : undefined}>{message.authorType === 'agent' ? <><AgentClientIcon clientName={message.clientName} /><span>{message.clientName?.trim() || 'IA'} ({authorDisplayName(message.author)})</span></> : `Pessoa (${authorDisplayName(message.author)})`}</strong><small title={formatDate(message.createdAt)}>{relativeTime(message.createdAt)}</small></div><MarkdownView content={message.content} /></article>) : <div className="empty-state compact"><h3>Sem mensagens</h3><p>Envie o objetivo e os detalhes conhecidos para iniciar.</p></div>}</div>
          <form className="conversation-composer" onSubmit={submitMessage}><label htmlFor="conversation-message">Mensagem</label><textarea id="conversation-message" rows={4} maxLength={20000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={sendMessageOnEnter} placeholder="Descreva o objetivo, restrições e dúvidas…" /><div className="conversation-composer-footer"><small>Enter envia · Shift+Enter quebra a linha</small><button className="button primary" disabled={!draft.trim() || send.isPending}>{send.isPending ? 'Enviando…' : 'Enviar'}</button></div></form>
        </>}
      </>}
    </div>
    {showAside && latest && <ConversationAside detail={latest} taskContext={taskContext} approving={approve.isPending} onApprove={proposal => approve.mutate(proposal)} onOpenAdmin={onOpenAdmin} />}
  </section>;
}
