import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { ConversationPanel, ConversationReadFailure, ConversationTaskSearch, ConversationTitleEditor } = await vite.ssrLoadModule('/src/components/conversations/ConversationPanel.tsx');
const { ConversationTypesManager } = await vite.ssrLoadModule('/src/components/conversations/ConversationTypesManager.tsx');
const conversationActions = await vite.ssrLoadModule('/src/components/conversations/conversation-actions.ts');
after(async () => { await vite.close(); });

function renderPanel(items: Array<Record<string, unknown>>, next: string | null = null, error?: Error, requestedConversationId?: string, messages: Array<Record<string, unknown>> = [], detailOverrides: Record<string, unknown> = {}, typeItems: Array<Record<string, unknown>> = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const queryKey = ['conversations', 'session-nonce', 'project-id'];
  client.setQueryData(queryKey, { items, next });
  client.setQueryData(['project-features', 'session-nonce', 'project-id'], [{ _id: 'feature-1', name: 'Colaboração por task' }]);
  if (typeItems.length) client.setQueryData(['conversation-types', 'session-nonce', 'project-id'], { items: typeItems });
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
  assert.doesNotMatch(html, /Tarefa vinculada · /, 'a lista não repete "Tarefa vinculada · …"');
  assert.match(html, /Sem mensagens ainda/);
  assert.match(html, /aria-label="Buscar conversas"/);
  assert.match(html, /aria-label="Lista de conversas"/);
  assert.match(html, /<span class="inline-flex [^"]*"[^>]*>Pendente</);
  assert.doesNotMatch(html, /Área · Backend|Feature · Colaboração por task/, 'a lista não repete área e feature da task');
  assert.doesNotMatch(html, /Autorizar execução/);
  assert.match(html, /Tipos e etapas/);
  assert.match(html, /Tipo da nova conversa/);
});

test('mudar qualquer filtro limpa a seleção e exige escolher uma conversa dos resultados', () => {
  let state = { filter: 'all' as const, selectedId: 'conversation-1', chooseAfterFilter: false };
  state = conversationActions.conversationInboxAfterFilter(state, 'unread');
  assert.deepEqual(state, { filter: 'unread', selectedId: '', chooseAfterFilter: true });
  state = conversationActions.conversationInboxAfterSelection(state, 'conversation-2');
  assert.deepEqual(state, { filter: 'unread', selectedId: 'conversation-2', chooseAfterFilter: false });
});

test('tipos usam rotas autenticadas e operações versionadas do backend', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const stage = { id: 'stage-1', title: 'Contexto', description: '', kind: 'instruction' as const, required: false, instruction: 'Pergunte pelo contexto.' };
  try {
    await conversationActions.listConversationTypes('token', 'project id');
    await conversationActions.createConversationType('token', 'project-id', { name: 'Incidente', description: '', stages: [stage] });
    await conversationActions.updateConversationType('token', 'project-id', 'type-id', 4, { name: 'Incidente', description: '', stages: [stage] });
    await conversationActions.duplicateConversationType('token', 'project-id', 'type-id', 5, 'Incidente cópia');
    await conversationActions.archiveConversationType('token', 'project-id', 'type-id', 6);
    await conversationActions.createProjectConversation('token', 'project-id', 'type-id');
    assert.match(calls[0].url, /\/admin\/conversation-types\?projectId=project\+id$/);
    assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'PATCH', 'POST', 'POST', 'POST']);
    assert.match(calls[2].url, /\/admin\/conversation-types\/type-id$/);
    assert.equal(calls[2].body.version, 4);
    assert.equal(calls[2].body.data instanceof Object, true);
    assert.match(calls[3].url, /\/type-id\/duplicate$/);
    assert.equal(calls[3].body.sourceVersion, 5);
    assert.match(calls[4].url, /\/type-id\/archive$/);
    assert.equal(calls[4].body.version, 6);
    assert.match(calls[5].url, /\/admin\/conversations$/);
    assert.equal(calls[5].body.typeId, 'type-id');
    assert.ok(calls.slice(1).every(call => /^[0-9a-f-]{36}$/i.test(String(call.body.operationId))));
  } finally { globalThis.fetch = originalFetch; }
});

test('clique em filtro limpa o painel atual até a seleção de outra conversa compatível', async () => {
  const dom = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom : (dom as unknown as Record<string, unknown>)[key] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const first = { _id: 'conversation-1', projectId: 'project-id', taskId: 'review-task', title: 'Primeira conversa', status: 'open', version: 0 };
  const second = { _id: 'conversation-2', projectId: 'project-id', taskId: null, title: 'Conversa não lida', status: 'open', version: 0, unread: { count: 1, cursor: 'message-2' } };
  const third = { _id: 'conversation-3', projectId: 'project-id', taskId: 'done-task', title: 'Conversa concluída', status: 'open', version: 0 };
  client.setQueryData(['conversations', 'session-nonce', 'project-id'], { items: [first, second, third], next: null });
  client.setQueryData(['project-features', 'session-nonce', 'project-id'], []);
  client.setQueryData(['conversation-types', 'session-nonce', 'project-id'], { items: [{ _id: '00000000-0000-4000-8000-000000000001', projectId: 'project-id', name: 'Geral', description: '', version: 0, archived: false, isDefault: true, stages: [] }] });
  for (const conversation of [first, second, third]) client.setQueryData(['conversation', 'session-nonce', 'project-id', conversation._id], { conversation, messages: [], next: null, proposals: [], task: null, jobs: [] });
  const selected: string[] = [];
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const button = (text: string) => (Array.from(host.querySelectorAll('button')) as unknown as HTMLButtonElement[]).find(item => item.textContent?.trim().startsWith(text));
  try {
    await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(ConversationPanel, {
      token: 'session-token', nonce: 'session-nonce', projectId: 'project-id', tasks: [
        { _id: 'review-task', name: 'Task revisão', status: 'em_revisao' }, { _id: 'done-task', name: 'Task concluída', status: 'concluida' }
      ], onConversationSelected: (id: string) => selected.push(id), onOpenTask() {}, onOpenAdmin() {}
    }))); for (let i = 0; i < 10 && !host.textContent?.includes('Primeira conversa'); i++) await tick(); });
    const panel = () => host.querySelector('[aria-label="Conversa"]')?.textContent ?? '';
    assert.match(panel(), /Primeira conversa/);
    await act(async () => { button('Não lidas')?.click(); await tick(); });
    assert.match(panel(), /Escolha uma conversa/);
    assert.doesNotMatch(panel(), /Primeira conversa/);
    assert.equal(selected.at(-1), '');
    await act(async () => { button('Conversa não lida')?.click(); for (let i = 0; i < 5 && !panel().includes('Conversa não lida'); i++) await tick(); });
    assert.match(panel(), /Conversa não lida/);
    await act(async () => { button('Em revisão')?.click(); await tick(); });
    assert.match(panel(), /Escolha uma conversa/);
    assert.doesNotMatch(panel(), /Conversa não lida/);
    await act(async () => { button('Primeira conversa')?.click(); for (let i = 0; i < 5 && !panel().includes('Primeira conversa'); i++) await tick(); });
    await act(async () => { button('Concluídas')?.click(); await tick(); });
    assert.match(panel(), /Escolha uma conversa/);
    assert.doesNotMatch(panel(), /Primeira conversa/);
    await act(async () => { button('Conversa concluída')?.click(); for (let i = 0; i < 5 && !panel().includes('Conversa concluída'); i++) await tick(); });
    await act(async () => { button('Todas')?.click(); await tick(); });
    assert.match(panel(), /Escolha uma conversa/);
    assert.doesNotMatch(panel(), /Conversa concluída/);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    dom.close();
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
  }
});

test('editor salva, duplica e arquiva fluxos; conflito preserva o rascunho', async () => {
  const dom = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom : (dom as unknown as Record<string, unknown>)[key] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const defaultType = { _id: '00000000-0000-4000-8000-000000000001', projectId: 'project-id', name: 'Geral', description: '', version: 0, archived: false, isDefault: true, stages: [] };
  let custom = { _id: 'custom-1', projectId: 'project-id', name: 'Investigação', description: 'Analisar ocorrências.', version: 4, archived: false, isDefault: false, stages: [{ id: 'stage-1', title: 'Contexto', description: '', kind: 'instruction' as const, required: false, instruction: 'Reúna informações.' }] };
  let duplicate: typeof custom | null = null;
  let created: typeof custom | null = null;
  let createAttempts = 0;
  const calls: Array<{ url: string; method: string; body: Record<string, any> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : {};
    calls.push({ url, method, body });
    if (method === 'GET') return new Response(JSON.stringify({ items: [defaultType, custom, ...(duplicate ? [duplicate] : []), ...(created ? [created] : [])] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/custom-1') && method === 'PATCH') {
      if (body.data.name === 'Sem permissão') return new Response(JSON.stringify({ reason: 'Acesso negado ao projeto' }), { status: 403, headers: { 'content-type': 'application/json' } });
      custom = { ...custom, ...body.data, version: 5 };
      return new Response(JSON.stringify(custom), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/custom-1/duplicate')) {
      duplicate = { ...custom, _id: 'custom-copy', name: body.name, version: 0 };
      return new Response(JSON.stringify(duplicate), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/custom-copy/archive')) {
      duplicate = { ...duplicate!, archived: true, version: 1 };
      return new Response(JSON.stringify(duplicate), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/admin/conversation-types') && method === 'POST') {
      createAttempts += 1;
      if (createAttempts === 1) return new Response(JSON.stringify({ reason: 'Conversation type name already exists' }), { status: 409, headers: { 'content-type': 'application/json' } });
      created = { ...body.data, _id: 'created-type', projectId: 'project-id', version: 0, archived: false, isDefault: false };
      return new Response(JSON.stringify(created), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ reason: 'unexpected editor request' }), { status: 500, headers: { 'content-type': 'application/json' } });
  };
  client.setQueryData(['conversation-types', 'nonce', 'project-id'], { items: [defaultType, custom] });
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const buttons = () => Array.from(host.querySelectorAll('button')) as unknown as HTMLButtonElement[];
  const click = async (label: string) => act(async () => { const available = buttons(); (available.find(button => button.textContent?.trim() === label) ?? available.find(button => button.textContent?.trim().startsWith(label)))?.click(); await tick(); });
  const clickAria = async (label: string) => act(async () => { (Array.from(host.querySelectorAll('button')) as unknown as HTMLButtonElement[]).find(button => button.getAttribute('aria-label') === label)?.click(); await tick(); });
  const setValue = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
    input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
    input.dispatchEvent(new dom.Event('change', { bubbles: true }) as unknown as Event);
  };
  const controlValue = (selector: string, value: string) => {
    const input = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    assert.ok(input, `control ${selector} exists`);
    setValue(input, value);
  };
  const labelControl = (label: string) => {
    const node = (Array.from(host.querySelectorAll('label')) as unknown as HTMLLabelElement[]).find(item => item.childNodes[0]?.textContent?.trim() === label);
    assert.ok(node, `label ${label} exists`);
    return node.querySelector('input,textarea')!;
  };
  try {
    await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(ConversationTypesManager, { token: 'token', nonce: 'nonce', projectId: 'project-id', onClose() {} }))); for (let i = 0; i < 10 && !host.textContent?.includes('Geral'); i++) await tick(); });
    await click('Investigação');
    await act(async () => { controlValue('input[maxlength="120"]', 'Investigação aprofundada'); });
    assert.match(host.textContent ?? '', /Investigação aprofundada/, 'a prévia atualiza o nome antes de salvar');
    await act(async () => { controlValue('textarea[maxlength="10000"]', 'Pergunte o impacto para quem usa o sistema.'); });
    assert.match(host.textContent ?? '', /Pergunte o impacto para quem usa o sistema\./, 'a prévia atualiza a instrução antes de salvar');
    await act(async () => { controlValue('select[aria-label="Adicionar etapa"]', 'form'); });
    assert.match(host.textContent ?? '', /Etapa 2 · Formulário/);
    await click('+ Campo');
    assert.equal(buttons().filter(button => button.textContent?.trim() === 'Remover campo').length, 2);
    const firstFieldLabel = labelControl('Rótulo');
    await act(async () => { setValue(firstFieldLabel as HTMLInputElement, 'Prioridade'); });
    assert.match(host.textContent ?? '', /Prioridade/, 'campo e prévia atualizam durante a edição');
    await clickAria('Mover etapa 2 para cima');
    assert.match(host.textContent ?? '', /Etapa 1 · Formulário/);
    await act(async () => { buttons().find(button => button.textContent?.trim() === 'Remover campo')?.click(); await tick(); });
    assert.equal(buttons().filter(button => button.textContent?.trim() === 'Remover campo').length, 1);
    await clickAria('Remover etapa 2');
    assert.doesNotMatch(host.textContent ?? '', /Etapa 2 · Instrução/);
    await click('Salvar fluxo');
    assert.ok(calls.some(call => call.method === 'PATCH' && call.body.version === 4));
    assert.match(host.textContent ?? '', /Fluxo salvo\./);

    await act(async () => { controlValue('input[maxlength="120"]', 'Sem permissão'); });
    await click('Salvar fluxo');
    assert.equal((host.querySelector('input[maxlength="120"]') as HTMLInputElement).value, 'Sem permissão');
    assert.match(host.textContent ?? '', /Acesso negado ao projeto/);

    await click('Duplicar fluxo');
    labelControl('Nome da cópia');
    await act(async () => { controlValue('form input[maxlength="120"]', 'Investigação cópia'); });
    await click('Duplicar');
    assert.ok(calls.some(call => call.url.endsWith('/custom-1/duplicate') && call.body.sourceVersion === 5));
    await click('Arquivar');
    await click('Confirmar arquivamento');
    assert.equal(duplicate?.archived, true);

    await click('+ Novo tipo');
    const name = labelControl('Nome');
    await act(async () => { controlValue('input[maxlength="120"]', 'Tipo em conflito'); });
    await act(async () => { controlValue('textarea[maxlength="10000"]', 'Reúna contexto suficiente.'); });
    await click('Criar tipo');
    assert.equal(createAttempts, 1);
    assert.equal((name as HTMLInputElement).value, 'Tipo em conflito');
    assert.match(host.textContent ?? '', /Este nome já está em uso/);
    await act(async () => { controlValue('input[maxlength="120"]', 'Tipo recém criado'); });
    await click('Criar tipo');
    assert.equal(createAttempts, 2);
    assert.equal(created?.name, 'Tipo recém criado');
    assert.match(host.textContent ?? '', /Fluxo salvo\./);
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => root.unmount());
    client.clear();
    dom.close();
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
  }
});

test('painel apresenta erro de sessão retornado pela API', () => {
  const html = renderPanel([], null, new Error('Sessão expirada'));

  assert.match(html, /bg-\[#fff6f6\][^"]*"[^>]*>Sessão expirada</);
  assert.match(html, /Sessão expirada/);
});

test('tipo arquivado não aparece para novas conversas, mas o fluxo segue visível na conversa aberta', () => {
  const archived = { _id: 'archived-type', projectId: 'project-id', name: 'Fluxo antigo', description: '', version: 2, archived: true, isDefault: false, stages: [{ id: 'stage', title: 'Acompanhar legado', description: '', kind: 'instruction', required: false, instruction: 'Preservar contexto.' }] };
  const general = { _id: '00000000-0000-4000-8000-000000000001', projectId: 'project-id', name: 'Geral', description: '', version: 0, archived: false, isDefault: true, stages: [] };
  const typeOptions = renderPanel([], null, undefined, undefined, [], {}, [general, archived]);
  assert.match(typeOptions, /Geral · fluxo padrão/);
  assert.doesNotMatch(typeOptions, /<option[^>]*>Fluxo antigo/);
  const openConversation = renderPanel([{ _id: 'old-conversation', projectId: 'project-id', taskId: null, title: 'Conversa antiga', status: 'open', version: 1 }], null, undefined, 'old-conversation', [], {
    conversation: { _id: 'old-conversation', projectId: 'project-id', taskId: null, title: 'Conversa antiga', status: 'open', version: 1, conversationTypeId: archived._id, conversationType: { _id: archived._id, name: archived.name, version: archived.version, isDefault: false, description: archived.description, stages: archived.stages } }
  }, [general, archived]);
  assert.match(openConversation, /Acompanhar legado/);
  assert.match(openConversation, /Tipo · Fluxo antigo/);
});

test('lista mostra a contagem não lida e só agenda leitura para cada novo cursor observado', () => {
  const html = renderPanel([
    { _id: 'conversation-unread', projectId: 'project-id', taskId: null, title: 'Conversa pendente', status: 'open', unread: { count: 3, cursor: 'message-3' } }
  ]);
  assert.match(html, /aria-label="3 mensagens não lidas">3</);
  assert.match(html, /aria-label="3 mensagens não lidas"/);
  assert.match(html, /font-bold text-\[#1f6b3a\]">1</);

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
  assert.match(html, /<button type="button" class="[^"]*text-\[#5c6bd5\][^"]*">Tentar novamente<\/button>/);
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
  assert.match(unlinkedHtml, /aria-label="Mais ações da conversa"/, 'excluir e editar título ficam no menu ⋯');
  assert.doesNotMatch(unlinkedHtml, />Excluir conversa</);
  assert.match(unlinkedHtml, /Comece pelo objetivo da conversa/);
  assert.match(unlinkedHtml, /aria-label="Sugestões de mensagem"[^>]*><button type="button"/);
  assert.match(unlinkedHtml, /<nav class="[^"]*" aria-label="Fases da conversa"/);
  assert.match(unlinkedHtml, /<button class="[^"]*bg-\[#e3e6ec\][^"]*"[^>]*disabled[^>]*>Enviar</, 'Enviar desabilitado com o campo vazio');
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
  assert.match(html, /title="Ver todas as tarefas desta feature"[^>]*>[\s\S]*Colaboração por task/);
  assert.match(html, /PROPOSTA DE EXECUÇÃO · VERSÃO 0/);
  assert.match(html, /Aguardando autorização/);
  assert.match(html, />Autorizar execução</);
  assert.match(html, />Pedir ajustes</);
  assert.match(html, /aria-label="Critérios da tarefa"/);
  assert.match(html, /aria-label="Mais ações da conversa"/);
  assert.match(html, /aria-current="step"[^>]*>[\s\S]*?Autorização/, 'proposta pendente leva à fase 3');
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

  assert.match(html, /aria-current="true"[^>]*><div[^>]*><strong[^>]*>Conversa da task/);
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

  assert.match(html, /text-\[#16836f\]/);
  assert.match(html, /text-\[#cf6848\]/);
  assert.match(html, /Codex \(Augusto\)/);
  assert.match(html, /Claude \(Augusto\)/);
  assert.ok(html.indexOf('Resposta Codex') >= 0 && html.indexOf('Resposta Claude') > html.indexOf('Resposta Codex'));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /text-\[#647087\]/);
  assert.match(html, /IA \(Augusto\)/);
  assert.match(html, /Agente local \(Augusto\)/);

  const humanArticle = html.match(/<article class="[^"]*flex-row-reverse[^"]*">[\s\S]*?<\/article>/)?.[0];
  assert.ok(humanArticle);
  assert.match(humanArticle, /Pessoa \(Augusto\)/);
  assert.doesNotMatch(humanArticle, /size-\[15px\]/);
});
