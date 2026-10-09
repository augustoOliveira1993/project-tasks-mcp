import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { QueryClient } from '@tanstack/react-query';

test('task filter links update the queue without opening the advanced panel until requested', async () => {
  const browser = new Window({ url: 'http://localhost/tasks?featureId=other-feature&priority=2&status=bloqueada&sort=updated&page=4&projectId=project-1' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    fetch: globalThis.fetch,
    React: (globalThis as any).React
  };
  Object.assign(globalThis, { window: browser, document: browser.document, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser.navigator });

  const projectId = 'project-1';
  const featureId = 'feature-1';
  const task = {
    _id: 'task-1', version: 0, name: 'Clickable filters', status: 'em_revisao', area: 'backend', type: 'fix', priority: 2,
    responsible: 'ana@example.com', featureId, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    workspace: { unreadCount: 0, openQuestionCount: 0, hasGitDiff: false, latestDiff: null }
  };
  const unassignedTask = {
    ...task, _id: 'task-2', name: 'Unassigned task', responsible: undefined, priority: undefined, status: 'bloqueada'
  };
  const searchResult = {
    items: [task, unassignedTask], total: 2, next: null,
    summary: { total: 2, running: 0, review: 0, done: 0, checked: 0, sync: { questions: 0, unread: 0, diff: 0 } }
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), browser.location.href);
    if (url.pathname.endsWith('/admin/tasks/search')) return new Response(JSON.stringify(searchResult), { status: 200 });
    if (url.pathname.endsWith('/admin/query')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ items: body.arguments?.kind === 'feature' ? [{ _id: featureId, name: 'Queue feature' }] : [], next: null }), { status: 200 });
    }
    if (url.pathname.endsWith('/admin/credentials')) return new Response(JSON.stringify({ items: [], next: null }), { status: 200 });
    if (url.pathname.endsWith('/attachments')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
    return new Response(JSON.stringify({ error: 'Unexpected request' }), { status: 404 });
  }) as typeof fetch;

  const React = await import('react');
  (globalThis as any).React = React;
  const { createRoot } = await import('react-dom/client');
  const { QueryClientProvider } = await import('@tanstack/react-query');
  const { TaskWorkspace } = await import('../frontend/src/features/tasks/TaskWorkspace.js');
  const { EntityNavigationContext } = await import('../frontend/src/components/ui/Links.js');
  const container = browser.document.createElement('div');
  browser.document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  const setFilter = (param: string, value: string) => {
    const params = new URLSearchParams(browser.location.search);
    params.delete('page');
    params.set(param, value);
    params.set('projectId', projectId);
    browser.history.pushState({ route: 'tasks' }, '', `/tasks?${params.toString()}`);
    browser.dispatchEvent(new browser.PopStateEvent('popstate'));
  };
  const navigation = {
    projectId, openTask: () => undefined, openConversation: () => undefined,
    filterByFeature: (value: string) => setFilter('featureId', value), filterBy: setFilter
  };
  const props = {
    token: 'test-token', nonce: 'test-nonce', projectId, projectAreas: ['backend', 'frontend'], saving: false, onRefresh: () => undefined,
    onOpenTask: () => undefined, onOpenTaskConversation: () => undefined, onTransferTask: () => undefined,
    onChangeStatus: () => undefined, onToggleChecked: () => undefined, canHardDelete: false,
    onRequestHardDeleteTask: () => undefined, onArchiveTask: () => undefined,
    onApproveSelected: async () => false, onSetTasksChecked: async () => []
  };
  const act = React.act;
  const click = async (element: Element) => act(async () => { element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
  const waitFor = async (ready: () => boolean) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (ready()) return;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.fail('Timed out waiting for task workspace to update');
  };
  const clickLink = async (accessibleName: string) => {
    const link = Array.from(container.querySelectorAll('a')).find(element => element.getAttribute('aria-label') === accessibleName || element.title === accessibleName);
    assert.ok(link, `missing filter link: ${accessibleName}`);
    await click(link);
    await waitFor(() => new URLSearchParams(browser.location.search).has(accessibleName.includes('feature') ? 'featureId' : accessibleName.includes('área') ? 'area' : accessibleName.includes('tipo') ? 'type' : accessibleName.includes('prioridade') ? 'priority' : accessibleName.includes('responsável') ? 'responsible' : 'status'));
    await waitFor(() => Array.from(container.querySelectorAll('a')).some(element => element.getAttribute('aria-label') === accessibleName || element.title === accessibleName));
    assert.equal(container.querySelector('[role="dialog"]'), null, 'filtering a row value must leave the advanced panel closed');
  };

  try {
    await act(async () => root.render(React.createElement(QueryClientProvider, { client },
      React.createElement(EntityNavigationContext.Provider, { value: navigation }, React.createElement(TaskWorkspace, props as any))
    )));
    await waitFor(() => Boolean(container.querySelector('a[aria-label="Filtrar pela prioridade P2 · Média"]')));
    assert.equal(container.querySelector('[role="dialog"]'), null, 'an existing advanced URL filter must not auto-open the panel');
    assert.equal(new URLSearchParams(browser.location.search).has('page'), false, 'legacy page numbers do not carry into cursor pagination');

    const selection = container.querySelector<HTMLInputElement>('input[aria-label="Selecionar Clickable filters"]');
    assert.ok(selection && !selection.disabled, 'eligible task can be selected before changing filters');
    await act(async () => { selection.click(); });
    assert.match(container.textContent ?? '', /1 tarefa\(s\) selecionada\(s\)/);

    await clickLink('Filtrar pela área Backend');
    assert.doesNotMatch(container.textContent ?? '', /1 tarefa\(s\) selecionada\(s\)/, 'a filter change clears the old selection');
    assert.equal(new URLSearchParams(browser.location.search).get('priority'), '2');
    assert.equal(new URLSearchParams(browser.location.search).get('sort'), 'updated');
    assert.equal(new URLSearchParams(browser.location.search).has('page'), false, 'filter links restart cursor pagination');
    await clickLink('Filtrar pelo tipo Correção');
    await clickLink('Filtrar pela feature “Queue feature”');
    await clickLink('Filtrar pelo status Em revisão');
    assert.equal(new URLSearchParams(browser.location.search).get('status'), 'em_revisao', 'status click uses the exact status from the clicked task');
    await clickLink('Filtrar pela prioridade P2 · Média');
    await clickLink('Filtrar pelo responsável ana@example.com');
    await clickLink('Filtrar tarefas sem responsável');
    assert.equal(new URLSearchParams(browser.location.search).get('responsible'), 'sem-responsavel');

    const moreFilters = container.querySelector<HTMLButtonElement>('button[aria-label^="Mais filtros,"]');
    assert.ok(moreFilters, 'applied advanced filter count remains available on the explicit panel button');
    assert.match(moreFilters.textContent ?? '', /3/, 'badge counts priority, responsible, and feature filters');
    await click(moreFilters);
    assert.ok(container.querySelector('[role="dialog"]'), 'the advanced panel opens when the user explicitly requests it');
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por prioridade"]')?.value, '2');
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por responsável"]')?.value, 'sem-responsavel');
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por feature"]')?.value, featureId);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    await browser.happyDOM.abort();
    if (previous.window === undefined) delete (globalThis as any).window; else globalThis.window = previous.window;
    if (previous.document === undefined) delete (globalThis as any).document; else globalThis.document = previous.document;
    if (previous.navigator === undefined) delete (globalThis as any).navigator; else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator });
    globalThis.fetch = previous.fetch;
    if (previous.React === undefined) delete (globalThis as any).React; else (globalThis as any).React = previous.React;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
