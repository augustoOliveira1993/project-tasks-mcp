import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ TaskMemoriesPanel }, { ProjectMemoryPanel }] = await Promise.all([
  vite.ssrLoadModule('/src/components/tasks/TaskMemoriesPanel.tsx'),
  vite.ssrLoadModule('/src/features/dashboard/ProjectMemoryPanel.tsx')
]);
after(async () => { await vite.close(); });

const projectId = '00000000-0000-4000-8000-000000000010';
const taskId = '00000000-0000-4000-8000-000000000011';
const siblingTaskId = '00000000-0000-4000-8000-000000000012';
const sharedMemoryId = '00000000-0000-4000-8000-000000000020';
const projectProposalId = '00000000-0000-4000-8000-000000000030';
const taskProposalId = '00000000-0000-4000-8000-000000000031';
const taskMemoryId = '00000000-0000-4000-8000-000000000040';

function installDom() {
  const dom = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle'];
  for (const key of keys) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom : (dom as unknown as Record<string, unknown>)[key] });
  }
  const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  dom.confirm = () => true;
  return { dom, restore() {
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    oldAct ? Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct) : Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    dom.happyDOM.abort();
  } };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function settleUntil(predicate: () => boolean, attempts = 30) {
  for (let i = 0; i < attempts && !predicate(); i++) await act(async () => { await tick(); });
}
function findButton(host: HTMLElement, text: string) {
  return (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]).find(button => button.textContent?.trim() === text)
    ?? (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]).find(button => button.textContent?.trim().startsWith(text));
}
function click(host: HTMLElement, text: string) {
  const button = findButton(host, text);
  assert.ok(button, `button not found: ${text}`);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
async function setField(host: HTMLElement, labelText: string, value: string, selector = 'input,textarea,select') {
  await act(async () => {
    const label = (Array.from(host.querySelectorAll('label')) as HTMLLabelElement[]).find(item => item.textContent?.includes(labelText));
    const field = label?.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    assert.ok(field, `field not found: ${labelText}`);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function articleByText(host: HTMLElement, text: string) {
  return (Array.from(host.querySelectorAll('article')) as HTMLElement[]).find(item => item.textContent?.includes(text));
}
function apiFetch(calls: Array<{ tool: string; arguments: Record<string, unknown> }>, handler: (tool: string, args: Record<string, unknown>) => unknown | Promise<unknown>) {
  return async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const tool = String(body.tool);
    const args = body.arguments as Record<string, unknown>;
    calls.push({ tool, arguments: args });
    const value = await handler(tool, args);
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('memórias da tarefa filtram pelo ownerTaskId e versionam criar, histórico, editar e arquivar', async () => {
  const environment = installDom();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  let archived = false;
  let current = { _id: taskMemoryId, version: 3, scope: 'task' as const, ownerTaskId: taskId, title: 'Memória com histórico', category: 'decision' as const, status: 'active' as const, revision: 2,
    sources: [{ kind: 'task' as const, id: taskId, title: 'Tarefa Alfa', revision: 8 }] };
  let createdMemory: Record<string, unknown> | null = null;
  globalThis.fetch = apiFetch(calls, async (tool, args) => {
    if (tool === 'list_project_memories') {
      assert.equal(args.scope, 'task');
      assert.equal(args.ownerTaskId, taskId);
      const items = [...(!archived ? [current] : []), ...(createdMemory ? [createdMemory] : [])];
      return { items: items.filter(item => item.status === args.status), next: null };
    }
    if (tool === 'create_project_memory') {
      createdMemory = { _id: '00000000-0000-4000-8000-000000000041', version: 1, revision: 1, scope: 'task', ownerTaskId: taskId,
        title: (args.data as any).title, category: (args.data as any).category, status: 'active', sources: (args.data as any).sources };
      return { ...createdMemory, content: (args.data as any).content };
    }
    if (tool === 'get_project_memory') {
      assert.equal(args.ownerTaskId, taskId);
      const revision = Number(args.revision ?? current.revision);
      return { ...current, revision, content: revision === 1 ? 'Memória histórica **confirmada**.' : 'Revisão atual da tarefa.' };
    }
    if (tool === 'update_project_memory') {
      current = { ...current, version: current.version + 1, revision: current.revision + 1, title: (args.data as any).title, sources: (args.data as any).sources };
      return { ...current, content: (args.data as any).content };
    }
    if (tool === 'archive_project_memory') { assert.equal(args.ownerTaskId, taskId); assert.equal(args.version, current.version); archived = true; return { ...current, archived: true }; }
    throw new Error(`Unexpected tool: ${tool}`);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const host = environment.dom.document.createElement('div');
  environment.dom.document.body.append(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host as unknown as Element);
  const render = () => createElement(QueryClientProvider, { client }, createElement(TaskMemoriesPanel, { token: 'token', projectId, taskId, taskName: 'Tarefa Alfa' }));
  try {
    await act(async () => { root.render(render()); for (let i = 0; i < 30 && !host.textContent?.includes('ainda não tem memórias'); i++) await tick(); });
    assert.ok(calls.some(call => call.tool === 'list_project_memories' && call.arguments.scope === 'task' && call.arguments.ownerTaskId === taskId));
    await setField(host, 'Estado', 'superseded');
    await settleUntil(() => host.textContent?.includes('ainda não tem memórias substituídas') ?? false);
    assert.ok(calls.some(call => call.tool === 'list_project_memories' && call.arguments.status === 'superseded' && call.arguments.ownerTaskId === taskId));
    await setField(host, 'Estado', 'active');
    await settleUntil(() => host.textContent?.includes('Memória com histórico') ?? false);

    await act(async () => { click(host, 'Nova memória da tarefa'); });
    await setField(host, 'Título', 'Novo aprendizado da tarefa');
    await setField(host, 'Conteúdo Markdown', 'Evidência privada da task.');
    await act(async () => { click(host, 'Salvar memória'); for (let i = 0; i < 30 && !host.textContent?.includes('Memória da tarefa salva.'); i++) await tick(); });
    const create = calls.find(call => call.tool === 'create_project_memory');
    assert.ok(create);
    assert.equal(create.arguments.scope, 'task');
    assert.equal(create.arguments.ownerTaskId, taskId);
    assert.equal((create.arguments.data as any).sources[0].id, taskId);
    assert.match(String(create.arguments.operationId), /^[0-9a-f-]{36}$/i);
    assert.match(host.textContent ?? '', /Novo aprendizado da tarefa/);

    const memoryCard = articleByText(host, 'Memória com histórico');
    assert.ok(memoryCard);
    await act(async () => { click(memoryCard, 'Abrir'); for (let i = 0; i < 30 && !host.textContent?.includes('Revisão atual da tarefa'); i++) await tick(); });
    assert.match(host.textContent ?? '', /Revisão atual da tarefa/);
    assert.ok(calls.some(call => call.tool === 'get_project_memory' && call.arguments.ownerTaskId === taskId));
    await setField(host, 'Revisão', '1');
    await settleUntil(() => host.textContent?.includes('Memória histórica confirmada') ?? false);
    const historicalRead = calls.findLast(call => call.tool === 'get_project_memory');
    assert.equal(historicalRead?.arguments.revision, 1);
    assert.ok(host.querySelector('strong'), 'MarkdownView rendered Markdown instead of showing a plain string');

    await act(async () => { click(memoryCard, 'Editar'); for (let i = 0; i < 30 && !host.querySelector('textarea'); i++) await tick(); });
    await setField(host, 'Conteúdo Markdown', 'Evidência revisada para a task.');
    await act(async () => { click(host, 'Salvar memória'); for (let i = 0; i < 30 && !calls.some(call => call.tool === 'update_project_memory'); i++) await tick(); });
    const update = calls.find(call => call.tool === 'update_project_memory');
    assert.ok(update);
    assert.equal(update.arguments.ownerTaskId, taskId);
    assert.equal(update.arguments.version, 3);
    assert.equal((update.arguments.data as any).sources[0].revision, undefined, 'mutable task source revision is refreshed at write time');
    assert.match(String(update.arguments.operationId), /^[0-9a-f-]{36}$/i);

    const updatedCard = articleByText(host, 'Memória com histórico');
    assert.ok(updatedCard);
    await act(async () => { click(updatedCard, 'Arquivar'); for (let i = 0; i < 30 && !calls.some(call => call.tool === 'archive_project_memory'); i++) await tick(); });
    const archive = calls.find(call => call.tool === 'archive_project_memory');
    assert.ok(archive);
    assert.equal(archive.arguments.ownerTaskId, taskId);
    assert.equal(archive.arguments.version, current.version);
    assert.match(String(archive.arguments.operationId), /^[0-9a-f-]{36}$/i);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    globalThis.fetch = originalFetch;
    environment.restore();
  }
});

test('memórias da tarefa mostram vazio para o ownerTaskId exato sem expor memórias irmãs', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['task-memories', projectId, taskId, 'active'], { pages: [{ items: [], next: null }], pageParams: [''] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskMemoriesPanel, { token: 'token', projectId, taskId, taskName: 'Tarefa Alfa' })));
  client.clear();
  assert.match(html, /Esta tarefa ainda não tem memórias ativas/);
  assert.match(html, /ownerTaskId igual à tarefa atual/);
  assert.doesNotMatch(html, /Tarefa Beta|memórias da tarefa irmã/i);
});

test('falha e conflito são apresentados sem perder o rascunho da memória da tarefa', async () => {
  const environment = installDom();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  let failList = true;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const tool = String(body.tool);
    const args = body.arguments as Record<string, unknown>;
    calls.push({ tool, arguments: args });
    if (tool === 'list_project_memories' && failList) return new Response(JSON.stringify({ error: 'Falha temporária do acervo.' }), { status: 503, headers: { 'content-type': 'application/json' } });
    if (tool === 'list_project_memories') return new Response(JSON.stringify({ items: [], next: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (tool === 'create_project_memory') return new Response(JSON.stringify({ reason: 'A memória mudou enquanto o rascunho estava aberto.' }), { status: 409, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected tool: ${tool}`);
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const host = environment.dom.document.createElement('div');
  environment.dom.document.body.append(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host as unknown as Element);
  try {
    await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(TaskMemoriesPanel, { token: 'token', projectId, taskId, taskName: 'Tarefa Alfa' }))); });
    await settleUntil(() => host.textContent?.includes('Falha temporária do acervo') ?? false);
    assert.match(host.textContent ?? '', /Falha temporária do acervo/);
    failList = false;
    await act(async () => { click(host, 'Tentar novamente'); });
    await settleUntil(() => host.textContent?.includes('Esta tarefa ainda não tem memórias ativas') ?? false);
    assert.match(host.textContent ?? '', /Esta tarefa ainda não tem memórias ativas/);

    await act(async () => { click(host, 'Nova memória da tarefa'); });
    await setField(host, 'Título', 'Rascunho que deve permanecer');
    await setField(host, 'Conteúdo Markdown', 'Conteúdo ainda não publicado.');
    await act(async () => { click(host, 'Salvar memória'); });
    await settleUntil(() => host.textContent?.includes('Conflito de versão ou de fonte') ?? false);
    assert.match(host.textContent ?? '', /Conflito de versão ou de fonte/);
    assert.equal((host.querySelector('textarea') as HTMLTextAreaElement | null)?.value, 'Conteúdo ainda não publicado.');
    assert.ok(findButton(host, 'Recarregar estado atual para comparar'));
    assert.ok(calls.some(call => call.tool === 'create_project_memory' && call.arguments.ownerTaskId === taskId));
  } finally {
    await act(async () => root.unmount());
    client.clear();
    globalThis.fetch = originalFetch;
    environment.restore();
  }
});

test('painel do projeto separa ownership de fontes e revisa propostas project/task com o owner correto', async () => {
  const environment = installDom();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  let approved = false;
  let rejected = false;
  const sharedMemory = { _id: sharedMemoryId, version: 2, scope: 'project', title: 'Regra compartilhada', category: 'convention', status: 'active', revision: 1,
    sources: [{ kind: 'task', id: taskId, title: 'Tarefa Alfa', revision: 7 }] };
  const proposals = [
    { _id: projectProposalId, version: 4, scope: 'project', taskId, executionId: '00000000-0000-4000-8000-000000000050', title: 'Proposta compartilhada', category: 'convention', status: 'pending', sources: [] },
    { _id: taskProposalId, version: 6, scope: 'task', ownerTaskId: siblingTaskId, taskId: siblingTaskId, executionId: '00000000-0000-4000-8000-000000000051', title: 'Proposta privada da tarefa', category: 'decision', status: 'pending', sources: [] }
  ];
  globalThis.fetch = apiFetch(calls, async (tool, args) => {
    if (tool === 'list_project_memories') return { items: [sharedMemory], next: null };
    if (tool === 'list_project_memory_proposals') {
      return { items: proposals.filter(proposal => (proposal._id !== taskProposalId || !approved) && (proposal._id !== projectProposalId || !rejected)), next: null };
    }
    if (tool === 'get_project_memory') return { ...sharedMemory, content: 'Conhecimento compartilhado.' };
    if (tool === 'get_project_memory_proposal') {
      const proposal = proposals.find(item => item._id === args.proposalId)!;
      return { ...proposal, content: proposal.scope === 'task' ? 'Conhecimento privado da tarefa.' : 'Sugestão compartilhada.', sources: [] };
    }
    if (tool === 'approve_project_memory_proposal') { approved = true; return { proposal: { status: 'approved' }, memory: { _id: taskMemoryId, scope: 'task', ownerTaskId: siblingTaskId } }; }
    if (tool === 'reject_project_memory_proposal') { rejected = true; return { proposal: { status: 'rejected' } }; }
    throw new Error(`Unexpected tool: ${tool}`);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const host = environment.dom.document.createElement('div');
  environment.dom.document.body.append(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host as unknown as Element);
  const render = () => createElement(QueryClientProvider, { client }, createElement(ProjectMemoryPanel, { token: 'token', projectId }));
  try {
    await act(async () => { root.render(render()); });
    await settleUntil(() => host.textContent?.includes('Proposta privada da tarefa') ?? false, 100);
    const memoryListCall = calls.find(call => call.tool === 'list_project_memories');
    const proposalListCall = calls.find(call => call.tool === 'list_project_memory_proposals');
    assert.equal(memoryListCall?.arguments.scope, 'project');
    assert.equal(proposalListCall?.arguments.scope, 'all');
    assert.match(host.textContent ?? '', /Escopo: compartilhada no projeto/);
    assert.match(host.textContent ?? '', /proveniência; o escopo compartilhado continua sendo do projeto/);
    assert.match(host.textContent ?? '', /Escopo: exclusivo da tarefa/);

    const taskArticle = articleByText(host, 'Proposta privada da tarefa');
    assert.ok(taskArticle);
    await act(async () => { click(taskArticle, 'Revisar conteúdo e fontes'); for (let i = 0; i < 30 && !host.textContent?.includes('Conhecimento privado da tarefa.'); i++) await tick(); });
    const taskProposalRead = calls.findLast(call => call.tool === 'get_project_memory_proposal');
    assert.equal(taskProposalRead?.arguments.ownerTaskId, siblingTaskId);
    assert.match(host.textContent ?? '', /Conhecimento privado da tarefa/);
    await act(async () => { click(taskArticle, 'Aprovar e publicar'); for (let i = 0; i < 30 && !calls.some(call => call.tool === 'approve_project_memory_proposal'); i++) await tick(); });
    const approve = calls.find(call => call.tool === 'approve_project_memory_proposal');
    assert.ok(approve);
    assert.equal(approve.arguments.version, 6);
    assert.equal(approve.arguments.proposalId, taskProposalId);
    assert.match(String(approve.arguments.operationId), /^[0-9a-f-]{36}$/i);

    const projectArticle = articleByText(host, 'Proposta compartilhada');
    assert.ok(projectArticle);
    await act(async () => { click(projectArticle, 'Revisar conteúdo e fontes'); for (let i = 0; i < 30 && !host.textContent?.includes('Sugestão compartilhada.'); i++) await tick(); });
    const projectProposalRead = calls.findLast(call => call.tool === 'get_project_memory_proposal');
    assert.equal(projectProposalRead?.arguments.ownerTaskId, undefined);
    await act(async () => { click(projectArticle, 'Rejeitar'); });
    await setField(projectArticle, 'Motivo da rejeição', 'Fonte insuficiente.');
    await act(async () => { click(projectArticle, 'Registrar rejeição'); for (let i = 0; i < 30 && !calls.some(call => call.tool === 'reject_project_memory_proposal'); i++) await tick(); });
    const reject = calls.find(call => call.tool === 'reject_project_memory_proposal');
    assert.ok(reject);
    assert.equal(reject.arguments.version, 4);
    assert.equal(reject.arguments.reason, 'Fonte insuficiente.');
    assert.match(String(reject.arguments.operationId), /^[0-9a-f-]{36}$/i);
    assert.ok(calls.some(call => call.tool === 'list_project_memories' && call.arguments.scope === 'project'), 'proposal review refreshes only the shared acervo query');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    globalThis.fetch = originalFetch;
    environment.restore();
  }
});
