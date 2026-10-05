import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { ConversationPanel, ConversationReadFailure, ConversationTaskSearch, ConversationTitleEditor } = await vite.ssrLoadModule('/src/components/conversations/ConversationPanel.tsx');
const conversationActions = await vite.ssrLoadModule('/src/components/conversations/conversation-actions.ts');
after(async () => { await vite.close(); });

function renderPanel(items: Array<Record<string, unknown>>, next: string | null = null, error?: Error, requestedConversationId?: string, messages: Array<Record<string, unknown>> = [], detailOverrides: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const queryKey = ['conversations', 'session-nonce', 'project-id'];
  client.setQueryData(queryKey, { items, next });
  client.setQueryData(['project-features', 'session-nonce', 'project-id'], [{ _id: 'feature-1', name: 'Colaboração por task' }]);
  if (requestedConversationId) client.setQueryData(['conversation', 'session-nonce', 'project-id', requestedConversationId], {
    conversation: { _id: requestedConversationId, projectId: 'project-id', taskId: null, title: 'Teste dos ícones', status: 'open', version: 0 },
    messages, next: null, proposals: [], task: null, jobs: [], ...detailOverrides
  });
  if (error) {
    const cached = client.getQueryCache().find({ queryKey });
    cached?.setState({ ...cached.state, status: 'error', error, fetchStatus: 'idle' });
  }
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ConversationPanel, {
    token: 'session-token', nonce: 'session-nonce', projectId: 'project-id', tasks: [{ _id: 'task-1', name: 'Task A', status: 'pendente', area: 'backend', featureId: 'feature-1' }], requestedConversationId, onRequestedConversationSelected() {}, onOpenAdmin() {}
  })));
  client.clear();
  return html;
}

function renderTitleEditor(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(ConversationTitleEditor, {
    title: 'Título salvo', editing: false, draft: '', editable: true, saving: false, onEdit() {}, onDraftChange() {}, onSave() {}, onCancel() {}, ...props
  }));
}

test('painel inicia conversa no escopo do projeto e oferece retomada paginada', () => {
  const html = renderPanel([
    { _id: 'conversation-1', projectId: 'project-id', taskId: null, title: 'Planejar entrega', status: 'open', updatedAt: '2026-09-30T10:00:00.000Z' },
    { _id: 'conversation-2', projectId: 'project-id', taskId: 'task-1', title: 'Corrigir validação', status: 'open', updatedAt: '2026-09-30T11:00:00.000Z' }
  ], 'cursor-page-2');

  assert.match(html, /Histórico compartilhado do projeto/);
  assert.match(html, /Planejar entrega/);
  assert.match(html, /Carregar conversas anteriores/);
  assert.match(html, /Nova conversa/);
  assert.doesNotMatch(html, /new-conversation-task/);
  assert.doesNotMatch(html, /Vincular a uma tarefa \(opcional\)/);
  assert.match(html, /Tarefa vinculada · Task A/);
  assert.match(html, /Área · Backend/);
  assert.match(html, /Status · Pendente/);
  assert.match(html, /Feature · Colaboração por task/);
  assert.doesNotMatch(html, /Aprovar e iniciar execução/);
});

test('painel apresenta erro de sessão retornado pela API', () => {
  const html = renderPanel([], null, new Error('Sessão expirada'));

  assert.match(html, /notice error/);
  assert.match(html, /Sessão expirada/);
});

test('lista mostra a contagem não lida e só agenda leitura para cada novo cursor observado', () => {
  const html = renderPanel([
    { _id: 'conversation-unread', projectId: 'project-id', taskId: null, title: 'Conversa pendente', status: 'open', unread: { count: 3, cursor: 'message-3' } }
  ]);
  assert.match(html, /3 não lida\(s\)/);
  assert.match(html, /aria-label="3 mensagens não lidas"/);

  const first = conversationActions.nextConversationReadAttempt(null, 'conversation-1', { count: 2, cursor: 'message-2' });
  assert.equal(first?.cursor, 'message-2');
  assert.match(first?.operationId ?? '', /^[0-9a-f-]{36}$/i);
  assert.equal(conversationActions.nextConversationReadAttempt(first, 'conversation-1', { count: 2, cursor: 'message-2' }), null);
  const later = conversationActions.nextConversationReadAttempt(first, 'conversation-1', { count: 1, cursor: 'message-3' });
  assert.equal(later?.cursor, 'message-3');
  assert.notEqual(later?.operationId, first?.operationId);
  assert.equal(conversationActions.nextConversationReadAttempt(first, 'conversation-1', { count: 0, cursor: null }), null);
});

test('falha ao marcar leitura oferece alerta acessível e retry', () => {
  const html = renderToStaticMarkup(createElement(ConversationReadFailure, {
    error: new Error('Falha de rede'), retry() {}
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Falha de rede/);
  assert.match(html, /<button type="button" class="text-button">Tentar novamente<\/button>/);
});

test('conversa vazia mantém criação geral e conversa sem vínculo oferece vincular tarefa', () => {
  const emptyHtml = renderPanel([]);
  assert.match(emptyHtml, /Comece uma conversa/);
  assert.match(emptyHtml, /Nova conversa/);
  assert.doesNotMatch(emptyHtml, /conversation-task-search/);

  const unlinkedHtml = renderPanel([
    { _id: 'conversation-unlinked', projectId: 'project-id', taskId: null, title: 'Conversa geral', status: 'open' }
  ], null, undefined, 'conversation-unlinked');
  assert.match(unlinkedHtml, /Vincular tarefa/);
  assert.match(unlinkedHtml, /Excluir conversa/);
  assert.doesNotMatch(unlinkedHtml, /new-conversation-task/);
});

test('conversa vinculada mostra task e feature e mantém propostas', () => {
  const html = renderPanel([
    { _id: 'conversation-linked', projectId: 'project-id', taskId: 'task-1', title: 'Task A', status: 'open' }
  ], null, undefined, 'conversation-linked', [], {
    conversation: { _id: 'conversation-linked', projectId: 'project-id', taskId: 'task-1', title: 'Task A', status: 'open', version: 3 },
    task: { _id: 'task-1', version: 3, status: 'pendente', name: 'Task A', area: 'backend', featureId: 'feature-1' },
    proposals: [{ _id: 'proposal-1', taskId: 'task-1', expectedTaskVersion: 3, title: 'Executar task', summary: 'Resumo da proposta', taskPatch: {}, status: 'pending', version: 0, stale: false }]
  });

  assert.match(html, /Conversa vinculada à tarefa/);
  assert.match(html, /Task A/);
  assert.match(html, /Feature · Colaboração por task/);
  assert.match(html, /Propostas de execução/);
  assert.match(html, /Aprovar e iniciar execução/);
  assert.match(html, /Editar título/);
  assert.doesNotMatch(html, /Vincular tarefa/);
});

test('edição de título oferece salvar/cancelar e preserva o rascunho quando há erro', () => {
  const editingHtml = renderTitleEditor({ editing: true, draft: 'Título digitado', error: new Error('Conflito de versão') });
  assert.match(editingHtml, /aria-label="Título da conversa"/);
  assert.match(editingHtml, /value="Título digitado"/);
  assert.match(editingHtml, /Salvar título/);
  assert.match(editingHtml, /Cancelar/);
  assert.match(editingHtml, /Conflito de versão/);

  const cancelledHtml = renderTitleEditor({ draft: 'Rascunho descartado' });
  assert.match(cancelledHtml, /Título salvo/);
  assert.match(cancelledHtml, /Editar título da conversa/);
  assert.doesNotMatch(cancelledHtml, /Rascunho descartado/);
});

test('busca de tarefa renderiza orientação, resultados, estados vazios e erro', () => {
  const renderSearch = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ConversationTaskSearch, {
    value: '', debouncedValue: '', isFetching: false, isError: false, error: undefined, tasks: [], onChange() {}, onSelect() {}, disabled: false,
    featureLabel: () => 'Colaboração por task', ...props
  }));

  assert.match(renderSearch({ value: 'a', debouncedValue: 'a' }), /Digite ao menos 2 caracteres para buscar tarefas/);
  assert.match(renderSearch({ value: 'task', debouncedValue: 'task', isFetching: true }), /Buscando tarefas/);
  assert.match(renderSearch({ value: 'task', debouncedValue: 'task', tasks: [{ _id: 'task-1', name: 'Task A', status: 'pendente', featureId: 'feature-1' }] }), /role="option"[\s\S]*Task A[\s\S]*Feature · Colaboração por task/);
  assert.match(renderSearch({ value: 'missing', debouncedValue: 'missing' }), /Nenhuma tarefa ativa corresponde à busca/);
  assert.match(renderSearch({ value: 'task', debouncedValue: 'task', isError: true, error: new Error('Falha na busca') }), /Falha na busca/);
});

test('debounce da busca descarta consulta anterior e limpa o termo aplicado', async () => {
  const applied: string[] = [];
  const cancelFirst = conversationActions.scheduleTaskSearch('termo antigo', (value: string) => applied.push(`antigo:${value}`), 15);
  const cancelSecond = conversationActions.scheduleTaskSearch('  Task atual  ', (value: string) => applied.push(value), 15);
  cancelFirst();
  await new Promise(resolve => setTimeout(resolve, 30));
  cancelSecond();
  assert.deepEqual(applied, ['Task atual']);
});

test('ações de conversa usam escopo, versão e operações de busca, vínculo e exclusão esperadas', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await conversationActions.createProjectConversation('token', 'project-id');
    await conversationActions.searchProjectTasks('token', 'project-id', 'Task');
    await conversationActions.linkConversationTask('token', 'conversation-id', 'project-id', 'task-id', 7);
    await conversationActions.deleteProjectConversation('token', 'conversation-id', 'project-id', 8);

    const create = JSON.parse(String(calls[0].init?.body));
    assert.equal(create.projectId, 'project-id');
    assert.equal('taskId' in create, false);
    assert.match(create.operationId, /^[0-9a-f-]{36}$/i);

    const search = JSON.parse(String(calls[1].init?.body));
    assert.equal(search.tool, 'list_records');
    assert.deepEqual(search.arguments, { kind: 'task', projectId: 'project-id', archived: false, search: 'Task', limit: 20 });

    const link = JSON.parse(String(calls[2].init?.body));
    assert.match(calls[2].url, /\/admin\/conversations\/conversation-id\/task$/);
    assert.equal(link.projectId, 'project-id');
    assert.equal(link.taskId, 'task-id');
    assert.equal(link.version, 7);
    assert.match(link.operationId, /^[0-9a-f-]{36}$/i);

    const deletion = JSON.parse(String(calls[3].init?.body));
    assert.equal(calls[3].init?.method, 'DELETE');
    assert.match(calls[3].url, /\/admin\/conversations\/conversation-id$/);
    assert.equal(deletion.projectId, 'project-id');
    assert.equal(deletion.version, 8);
    assert.match(deletion.operationId, /^[0-9a-f-]{36}$/i);
  } finally { globalThis.fetch = originalFetch; }
});

test('renomear conversa envia PATCH versionado e atualiza os títulos da lista', async () => {
  const originalFetch = globalThis.fetch;
  let url = '';
  let init: RequestInit | undefined;
  globalThis.fetch = async (input, options) => {
    url = String(input); init = options;
    return new Response(JSON.stringify({ _id: 'conversation-id', title: 'Novo título', version: 5 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await conversationActions.updateConversationTitle('token', 'conversation-id', 'project-id', 'Novo título', 4);
    assert.match(url, /\/admin\/conversations\/conversation-id\/title$/);
    assert.equal(init?.method, 'PATCH');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual({ projectId: body.projectId, title: body.title, version: body.version }, { projectId: 'project-id', title: 'Novo título', version: 4 });
    assert.match(body.operationId, /^[0-9a-f-]{36}$/i);

    const history = conversationActions.historyAfterConversationTitleUpdate(
      { items: [{ _id: 'conversation-id', title: 'Título antigo', version: 4 }, { _id: 'other', title: 'Outra conversa', version: 1 }] },
      [{ items: [{ _id: 'conversation-id', title: 'Título antigo', version: 4 }] }],
      { _id: 'conversation-id', title: 'Novo título', version: 5 }
    );
    assert.deepEqual(history.current?.items.map((item: { title: string }) => item.title), ['Novo título', 'Outra conversa']);
    assert.equal(history.olderPages[0].items[0].title, 'Novo título');
  } finally { globalThis.fetch = originalFetch; }
});

test('erro de validação ou conflito do backend fica legível para a edição de título', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'Conversation version conflict' }), { status: 409, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(conversationActions.updateConversationTitle('token', 'conversation-id', 'project-id', 'Título digitado', 2), /Conversation version conflict/);
  } finally { globalThis.fetch = originalFetch; }
  const html = renderTitleEditor({ editing: true, draft: 'Título digitado', error: new Error('Conversation version conflict') });
  assert.match(html, /value="Título digitado"/);
  assert.match(html, /Conversation version conflict/);
});

test('ação de marcação usa a conversa, o cursor observado e o mesmo operationId', async () => {
  const originalFetch = globalThis.fetch;
  let url = '';
  let init: RequestInit | undefined;
  globalThis.fetch = async (input, options) => {
    url = String(input); init = options;
    return new Response(JSON.stringify({ conversationId: 'conversation-id', cursor: 'message-7' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await conversationActions.markConversationRead('token', 'project-id', {
      conversationId: 'conversation-id', cursor: 'message-7', operationId: '19e8787b-9ff2-4b86-9d14-a13d78e6a634'
    });
    assert.match(url, /\/admin\/conversations\/conversation-id\/read$/);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      projectId: 'project-id', cursor: 'message-7', operationId: '19e8787b-9ff2-4b86-9d14-a13d78e6a634'
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('retry de marcação reutiliza a operação após uma falha temporária', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  let shouldFail = true;
  globalThis.fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    return shouldFail
      ? new Response(JSON.stringify({ reason: 'Falha temporária' }), { status: 503, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ cursor: 'message-7' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const attempt = { conversationId: 'conversation-id', cursor: 'message-7', operationId: 'a40b4bdd-488c-4e14-8434-3f9ba7d1dc30' };
  try {
    await assert.rejects(conversationActions.markConversationRead('token', 'project-id', attempt), /Falha temporária/);
    shouldFail = false;
    await conversationActions.markConversationRead('token', 'project-id', attempt);
    assert.deepEqual(bodies[0], bodies[1]);
  } finally { globalThis.fetch = originalFetch; }
});

test('excluir exige confirmação e atualiza o histórico e a seleção', () => {
  let removed = 0;
  conversationActions.confirmConversationDeletion(() => false, () => removed++);
  assert.equal(removed, 0);
  conversationActions.confirmConversationDeletion(message => { assert.match(message, /Tarefas e execuções não serão alteradas/); return true; }, () => removed++);
  assert.equal(removed, 1);

  const state = conversationActions.historyAfterConversationDeletion(
    { items: [{ _id: 'deleted' }, { _id: 'next' }], next: 'cursor' },
    [{ items: [{ _id: 'older' }], next: null }],
    'deleted'
  );
  assert.deepEqual(state.current?.items.map((item: { _id: string }) => item._id), ['next']);
  assert.deepEqual(state.olderPages[0].items.map((item: { _id: string }) => item._id), ['older']);
  assert.equal(state.selectedId, 'next');
  assert.equal(conversationActions.historyAfterConversationDeletion({ items: [{ _id: 'deleted' }] }, [], 'deleted').selectedId, '');
});

test('painel seleciona a conversa pedida pela navegação da task', () => {
  const html = renderPanel([
    { _id: 'conversation-1', projectId: 'project-id', taskId: null, title: 'Conversa geral', status: 'open' },
    { _id: 'conversation-2', projectId: 'project-id', taskId: 'task-1', title: 'Conversa da task', status: 'open' }
  ], null, undefined, 'conversation-2');

  assert.match(html, /aria-current="true" class="conversation-list-item active"><strong>Conversa da task/);
});

test('chat mostra ícones de Codex e Claude, fallback acessível e identidade humana', () => {
  const conversationId = 'conversation-icons';
  const html = renderPanel([
    { _id: conversationId, projectId: 'project-id', taskId: null, title: 'Teste dos ícones', status: 'open' }
  ], null, undefined, conversationId, [
    { _id: 'human-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'human', clientName: 'Codex', content: 'Mensagem humana', createdAt: '2026-10-01T12:04:00.000Z' },
    { _id: 'unknown-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', clientName: 'Agente local', content: 'Resposta desconhecida', createdAt: '2026-10-01T12:03:00.000Z' },
    { _id: 'legacy-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', content: 'Resposta legada', createdAt: '2026-10-01T12:02:00.000Z' },
    { _id: 'claude-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', clientName: 'Claude', content: 'Resposta Claude', createdAt: '2026-10-01T12:01:00.000Z' },
    { _id: 'codex-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', clientName: 'Codex', content: 'Resposta Codex', createdAt: '2026-10-01T12:00:00.000Z' }
  ]);

  assert.match(html, /conversation-agent-icon codex/);
  assert.match(html, /conversation-agent-icon claude/);
  assert.match(html, /Codex \(Augusto\)/);
  assert.match(html, /Claude \(Augusto\)/);
  assert.ok(html.indexOf('Resposta Codex') >= 0 && html.indexOf('Resposta Claude') > html.indexOf('Resposta Codex'));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /conversation-agent-icon generic/);
  assert.match(html, /IA \(Augusto\)/);
  assert.match(html, /Agente local \(Augusto\)/);

  const humanArticle = html.match(/<article class="conversation-message human">[\s\S]*?<\/article>/)?.[0];
  assert.ok(humanArticle);
  assert.match(humanArticle, /Pessoa \(Augusto\)/);
  assert.doesNotMatch(humanArticle, /conversation-agent-icon/);
});
