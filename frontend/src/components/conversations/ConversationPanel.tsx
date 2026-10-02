import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allRecords, operationId, query, request } from '../../api';
import { errorMessage, formatDate } from '../../lib/format';
import { routeUrl } from '../../route-state';
import { Badge } from '../ui/Badge';
import { MarkdownView } from '../ui/MarkdownView';
import { confirmConversationDeletion, createProjectConversation, deleteProjectConversation, historyAfterConversationDeletion, historyAfterConversationTitleUpdate, linkConversationTask, scheduleTaskSearch, searchProjectTasks, updateConversationTitle } from './conversation-actions';

type Conversation = { _id: string; projectId: string; taskId: string | null; title: string; status: string; version: number; updatedAt?: string; lastMessageAt?: string | null };
type Message = { _id: string; author: string; authorType: 'human' | 'agent'; clientName?: string | null; content: string; createdAt: string };
type Proposal = {
  _id: string; taskId: string; expectedTaskVersion: number; title: string; summary: string;
  taskPatch: { instructions?: string; acceptance?: string[] }; status: string; version: number; stale: boolean;
};
type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  next?: string | null;
  proposals: Proposal[];
  task: { _id: string; version: number; status: string; name: string; area?: string; featureId?: string | null } | null;
  jobs: Array<{ _id: string; status: string; failed: boolean; permissionTitle: string | null }>;
};
type ConversationPage = { items: Conversation[]; next?: string | null };
type TaskOption = { _id: string; name: string; status: string; area?: string; featureId?: string | null };
type Feature = { _id: string; name: string };
type TaskActivity = {
  task: { _id: string; version: number; status: string; acceptance: string[]; acceptanceProgress: boolean[]; acceptanceEvidence: Array<string | null> };
  messages: Array<{ _id: string; type: string; author: string; authorType: 'human' | 'agent' | 'unknown'; clientName: string | null; message: string; createdAt: string }>;
  executions: Array<{ _id: string; status: string; startedAt: string; result?: { summary?: string; evidence?: string[] } }>;
};

function AgentClientIcon({ clientName }: { clientName?: string | null }) {
  const client = clientName?.trim().toLocaleLowerCase('en-US');
  const variant = client?.startsWith('codex') ? 'codex' : client?.startsWith('claude') ? 'claude' : 'generic';

  return <svg className={`conversation-agent-icon ${variant}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {variant === 'codex' ? <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-16-4 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      : variant === 'claude' ? <><path d="M12 2.25 14.15 9.85 21.75 12l-7.6 2.15L12 21.75l-2.15-7.6L2.25 12l7.6-2.15L12 2.25Z" fill="currentColor" /><path d="M19 2.5v4m2-2h-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></>
        : <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 8v8m-4-4h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></>}
  </svg>;
}

function HumanAuthorIcon() {
  return <svg className="conversation-author-icon human" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 20c.55-3.35 2.85-5.25 6.5-5.25s5.95 1.9 6.5 5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function UnknownAuthorIcon() {
  return <svg className="conversation-author-icon unknown" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9.5 9a2.6 2.6 0 1 1 4.35 1.9c-1.1.95-1.85 1.25-1.85 2.6m0 3h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}

function TaskMessageAuthor({ message }: { message: TaskActivity['messages'][number] }) {
  const isAgent = message.authorType === 'agent';
  const isHuman = message.authorType === 'human';
  const label = isAgent ? message.clientName?.trim() || 'IA' : isHuman ? 'Pessoa' : message.clientName?.trim() ? `Cliente MCP · ${message.clientName.trim()}` : 'Origem desconhecida';

  return <div className="conversation-task-message-author">
    <strong className="conversation-task-message-identity">
      {isAgent ? <AgentClientIcon clientName={message.clientName} /> : isHuman ? <HumanAuthorIcon /> : <UnknownAuthorIcon />}
      <span>{label} · {authorDisplayName(message.author)}</span>
    </strong>
    <small title={message.author}>{message.author}</small>
  </div>;
}

function taskMessageTypeLabel(type: string) {
  return type === 'resposta' ? 'Resposta' : type === 'pergunta' ? 'Pergunta' : type || 'Atualização';
}

function areaLabel(area?: string) {
  return area === 'backend' ? 'Backend' : area === 'frontend' ? 'Frontend' : area === 'outro' ? 'Outro' : area || 'Não definida';
}

function authorDisplayName(author: string) {
  const identity = author.trim();
  const localPart = identity.includes('@') ? identity.slice(0, identity.indexOf('@')) : identity;
  const firstName = localPart.split(/[._+-]/).find(Boolean) ?? localPart;
  return firstName ? firstName[0].toLocaleUpperCase('pt-BR') + firstName.slice(1) : 'Desconhecido';
}

function statusLabel(status: string) {
  return ({ pendente: 'Pendente', em_execucao: 'Em execução', em_revisao: 'Em revisão', concluida: 'Concluída', bloqueada: 'Bloqueada', cancelada: 'Cancelada' } as Record<string, string>)[status] ?? status;
}

function statusTone(status: string) {
  return ({ pendente: 'blue', em_execucao: 'amber', em_revisao: 'amber', concluida: 'green', bloqueada: 'red', cancelada: 'muted' } as Record<string, string>)[status] ?? 'muted';
}

export function ConversationTaskSearch({ value, debouncedValue, isFetching, isError, error, tasks, onChange, onSelect, disabled, featureLabel }: {
  value: string; debouncedValue: string; isFetching: boolean; isError: boolean; error: unknown; tasks: TaskOption[];
  onChange: (value: string) => void; onSelect: (taskId: string) => void; disabled: boolean; featureLabel: (task: TaskOption) => string;
}) {
  return <section className="conversation-task-link"><label htmlFor="conversation-task-search">Buscar tarefa</label><input id="conversation-task-search" type="search" value={value} onChange={event => onChange(event.target.value)} placeholder="Digite o início do nome da tarefa…" autoComplete="off" /><small>Digite ao menos 2 caracteres. A busca considera tarefas ativas deste projeto.</small>{debouncedValue.length < 2 ? <div className="empty-state compact">Digite ao menos 2 caracteres para buscar tarefas.</div> : isFetching ? <div className="loading">Buscando tarefas…</div> : isError ? <div className="notice error">{errorMessage(error)}</div> : tasks.length ? <div className="conversation-task-options" role="listbox" aria-label="Tarefas encontradas">{tasks.map(task => <button type="button" role="option" aria-selected="false" className="conversation-task-option" key={task._id} onClick={() => onSelect(task._id)} disabled={disabled}><strong>{task.name}</strong><span className="conversation-context-badges"><Badge tone="blue">Área · {areaLabel(task.area)}</Badge><Badge tone={statusTone(task.status)}>Status · {statusLabel(task.status)}</Badge><Badge tone="muted">Feature · {featureLabel(task)}</Badge></span></button>)}</div> : <div className="empty-state compact">Nenhuma tarefa ativa corresponde à busca.</div>}</section>;
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
  const taskForId = (taskId: string) => latest?.task?._id === taskId ? latest.task : tasks.find(task => task._id === taskId);
  const featureNameForTask = (taskId: string) => {
    const featureId = taskForId(taskId)?.featureId;
    return featureId ? features.data?.find(feature => feature._id === featureId)?.name : undefined;
  };
  const featureBadgeForTask = (taskId: string) => {
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

  return <section className="conversation-layout">
    <aside className="panel-card conversation-sidebar">
      <div className="section-heading"><div><h2>Conversas</h2><p className="muted-text">Histórico compartilhado do projeto</p></div></div>
      <button className="button primary conversation-new-button" onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Nova conversa'}</button>
      {conversations.isPending ? <div className="loading">Carregando conversas…</div> : conversations.isError ? <div className="notice error">{errorMessage(conversations.error)}</div> : uniqueConversationItems.length ? <><div className="conversation-list">{uniqueConversationItems.map(item => {
        const task = item.taskId ? taskForId(item.taskId) : undefined;
        return <button key={item._id} aria-current={selectedId === item._id ? 'true' : undefined} className={'conversation-list-item' + (selectedId === item._id ? ' active' : '')} onClick={() => { setSelectedId(item._id); onConversationSelected?.(item._id); }}><strong>{item.title || 'Nova conversa'}</strong><small>{item.taskId ? 'Tarefa vinculada · ' + (task?.name ?? item.taskId.slice(0, 8)) : 'Escopo do projeto'} · {formatDate(item.lastMessageAt || item.updatedAt)}</small>{item.taskId && <div className="conversation-context-badges">{task && <Badge tone="blue">Área · {areaLabel(task.area)}</Badge>}{task && <Badge tone={statusTone(task.status)}>Status · {statusLabel(task.status)}</Badge>}<Badge tone="muted">Feature · {featureBadgeForTask(item.taskId)}</Badge></div>}</button>;
      })}</div>{(olderConversationPages.at(-1)?.next ?? conversations.data?.next) && <button className="button ghost" disabled={loadingOlder} onClick={() => void loadOlderConversations()}>{loadingOlder ? 'Carregando…' : 'Carregar conversas anteriores'}</button>}</> : <div className="empty-state compact"><h3>Comece uma conversa</h3><p>Crie uma conversa geral e vincule uma tarefa pelo cabeçalho do chat.</p></div>}
    </aside>
    <div className="panel-card conversation-main">
      {!selectedId ? <div className="empty-state"><h2>Conversa do projeto</h2><p>Selecione uma conversa ou crie uma nova para começar.</p></div> : <>
        <header className="conversation-header"><div><ConversationTitleEditor title={latest?.conversation.title ?? 'Conversa'} editing={titleEditing} draft={titleDraft} editable={Boolean(latest)} saving={renameConversation.isPending} error={renameConversation.isError ? renameConversation.error : undefined} onEdit={beginTitleEdit} onDraftChange={setTitleDraft} onSave={submitTitle} onCancel={cancelTitleEdit} /><p className="muted-text">{latest?.conversation.taskId ? 'Conversa vinculada à tarefa' : 'Escopo do projeto'}</p>{latest && <div className="conversation-id"><small>ID da conversa</small><code>{latest.conversation._id}</code></div>}{latest?.task && <div className="conversation-context-badges"><a className="conversation-task-anchor" href={routeUrl('tasks', `taskId=${encodeURIComponent(latest.task._id)}`, projectId)} aria-label={`Abrir tarefa ${latest.task.name} na listagem`} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenTask(latest.task!._id); }}>{latest.task.name}</a><Badge tone="blue">Área · {areaLabel(latest.task.area)}</Badge><Badge tone={statusTone(latest.task.status)}>Status · {statusLabel(latest.task.status)}</Badge><Badge tone="muted">Feature · {featureBadgeForTask(latest.task._id)}</Badge></div>}</div><div className="conversation-header-actions">{latest && !latest.conversation.taskId && <button type="button" className="button secondary" onClick={() => setLinkTaskOpen(open => !open)} disabled={linkTask.isPending}>{linkTaskOpen ? 'Fechar busca' : 'Vincular tarefa'}</button>}<button type="button" className="button secondary" onClick={() => void copyConversationId()}>Copiar ID</button><button type="button" className="button danger-button" onClick={confirmDeleteConversation} disabled={!latest || deleteConversation.isPending}>{deleteConversation.isPending ? 'Excluindo…' : 'Excluir conversa'}</button></div></header>
        {linkTaskOpen && latest && !latest.conversation.taskId && <ConversationTaskSearch value={taskSearch} debouncedValue={debouncedTaskSearch} isFetching={taskSearchResults.isFetching} isError={taskSearchResults.isError} error={taskSearchResults.error} tasks={taskSearchResults.data?.items ?? []} onChange={setTaskSearch} onSelect={taskId => linkTask.mutate(taskId)} disabled={linkTask.isPending} featureLabel={task => task.featureId ? features.data?.find(feature => feature._id === task.featureId)?.name ?? 'Carregando…' : 'Sem feature'} />}
        {latest?.task && <section className="conversation-task-progress"><div className="proposal-heading"><div><strong>{latest.task.name}</strong><small>Versão {taskContext.data?.task.version ?? latest.task.version}</small></div><div className="conversation-context-badges">{latest.task.area && <Badge tone="blue">Área · {areaLabel(latest.task.area)}</Badge>}<Badge tone={statusTone(latest.task.status)}>Status · {statusLabel(latest.task.status)}</Badge></div></div>{latest.jobs.map(job => <div className="conversation-job-state" key={job._id}><Badge tone={job.failed ? 'amber' : job.status === 'completed' ? 'green' : 'blue'}>{job.failed ? 'Falha na execução' : job.status === 'waiting_human' ? 'Aguardando autorização' : job.status === 'completed' ? 'Enviado para revisão' : job.status === 'queued' ? 'Na fila' : job.status === 'running' || job.status === 'reserved' ? 'Em execução' : job.status === 'blocked' ? 'Bloqueado' : job.status}</Badge>{job.permissionTitle && <small>{job.permissionTitle}</small>}{job.status === 'waiting_human' && <button className="button ghost" onClick={onOpenAdmin}>Abrir automações</button>}</div>)}{taskContext.isPending ? <small>Carregando acompanhamento…</small> : taskContext.isError ? <div className="notice error">{errorMessage(taskContext.error)}</div> : <><div className="conversation-acceptance">{taskContext.data?.task.acceptance.map((criterion, index) => <div key={index}><Badge tone={taskContext.data?.task.acceptanceProgress[index] ? 'green' : 'blue'}>{taskContext.data?.task.acceptanceProgress[index] ? 'Atendido' : 'Pendente'}</Badge><MarkdownView content={criterion} />{taskContext.data?.task.acceptanceEvidence[index] && <small>Evidência: {taskContext.data.task.acceptanceEvidence[index]}</small>}</div>)}</div>{taskContext.data?.messages.length ? <div className="conversation-task-messages"><strong>Progresso e decisões recentes</strong>{taskContext.data.messages.slice(0, 5).map(message => <article key={message._id}><div className="conversation-task-message-meta"><TaskMessageAuthor message={message} /><div className="conversation-task-message-state"><Badge tone={message.type === 'resposta' ? 'green' : 'blue'}>{taskMessageTypeLabel(message.type)}</Badge><small>{formatDate(message.createdAt)}</small></div></div><MarkdownView content={message.message} /></article>)}</div> : null}{taskContext.data?.executions[0] && <div className="conversation-execution"><Badge>{taskContext.data.executions[0].status}</Badge><small>Execução iniciada em {formatDate(taskContext.data.executions[0].startedAt)}</small>{taskContext.data.executions[0].result?.summary && <MarkdownView content={taskContext.data.executions[0].result.summary} />}</div>}</>}</section>}
        {notice && <div className="notice">{notice}</div>}
        {detail.isPending ? <div className="loading">Carregando mensagens…</div> : detail.isError ? <div className="notice error">{errorMessage(detail.error)}</div> : <>
          {(olderMessagePages.at(-1)?.next ?? latest?.next) && <button className="button ghost" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}
          <div className="conversation-messages" aria-live="polite">{orderedMessages.length ? orderedMessages.map(message => <article key={message._id} className={`conversation-message ${message.authorType}`}><div className="conversation-message-meta"><strong className={message.authorType === 'agent' ? 'conversation-agent-identity' : undefined}>{message.authorType === 'agent' ? <><AgentClientIcon clientName={message.clientName} /><span>{message.clientName?.trim() || 'IA'} ({authorDisplayName(message.author)})</span></> : `Pessoa (${authorDisplayName(message.author)})`}</strong><small>{formatDate(message.createdAt)}</small></div><MarkdownView content={message.content} /></article>) : <div className="empty-state compact"><h3>Sem mensagens</h3><p>Envie o objetivo e os detalhes conhecidos para iniciar.</p></div>}</div>
          <form className="conversation-composer" onSubmit={submitMessage}><label htmlFor="conversation-message">Mensagem</label><textarea id="conversation-message" rows={4} maxLength={20000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={sendMessageOnEnter} placeholder="Descreva o objetivo, restrições e dúvidas…" /><div className="conversation-composer-footer"><small>Enter envia · Shift+Enter quebra a linha</small><button className="button primary" disabled={!draft.trim() || send.isPending}>Enviar</button></div></form>
          {latest?.proposals.length ? <section className="conversation-proposals"><div className="section-heading"><div><h3>Propostas de execução</h3><p className="muted-text">A aprovação inicia a automação configurada e envia o resultado para revisão.</p></div></div>{latest.proposals.map(proposal => <article className="proposal-card" key={proposal._id}><div className="proposal-heading"><h4>{proposal.title}</h4><Badge tone={proposal.status === 'pending' && !proposal.stale ? 'amber' : proposal.status === 'approved' ? 'green' : 'blue'}>{proposal.stale ? 'contexto desatualizado' : proposal.status}</Badge></div><MarkdownView content={proposal.summary} />{proposal.taskPatch.instructions && <div className="detail-section"><h4>Instruções propostas</h4><MarkdownView content={proposal.taskPatch.instructions} /></div>}{proposal.taskPatch.acceptance?.length ? <div className="detail-section"><h4>Critérios propostos</h4><ul>{proposal.taskPatch.acceptance.map((criterion, index) => <li key={index}><MarkdownView content={criterion} /></li>)}</ul></div> : null}<small>Tarefa {proposal.taskId} · versão esperada {proposal.expectedTaskVersion}</small><div className="button-row end-row"><button className="button primary" disabled={proposal.status !== 'pending' || proposal.stale || approve.isPending || !latest.task || latest.task.version !== proposal.expectedTaskVersion} onClick={() => approve.mutate(proposal)}>Aprovar e iniciar execução</button></div></article>)}</section> : null}
        </>}
      </>}
    </div>
  </section>;
}
