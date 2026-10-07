import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ TaskDetailsDialog }, { TaskSummaryPanel }, { openTaskConversation }] = await Promise.all([
  vite.ssrLoadModule('/src/components/tasks/TaskDetailsDialog.tsx'),
  vite.ssrLoadModule('/src/components/tasks/TaskSummaryPanel.tsx'),
  vite.ssrLoadModule('/src/features/tasks/task-conversation.ts')
]);
after(async () => { await vite.close(); });

test('detalhes exibem ações, chips de contexto e abas da gaveta', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const task = { _id: 'task-1', version: 2, name: 'Task da feature', status: 'pendente', area: 'frontend', featureId: 'feature-1', priority: 1 };
  client.setQueryData(['task-context', 'nonce', 'project-1', 'task-1'], {
    task: { ...task, responsible: null, updatedAt: '2026-09-30T12:00:00.000Z', acceptance: [], acceptanceProgress: [] },
    feature: { _id: 'feature-1', name: 'Conversas vinculadas' }, messages: [], executions: [], dependencies: [], markdowns: { task: { items: [] } }
  });
  client.setQueryData(['task-diffs', 'nonce', 'project-1', 'task-1'], { items: [] });
  client.setQueryData(['task-markdowns', 'nonce', 'project-1', 'task-1'], { items: [] });
  client.setQueryData(['project-features', 'nonce', 'project-1'], [{ _id: 'feature-1', name: 'Conversas vinculadas' }]);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskDetailsDialog, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', project: { _id: 'project-1', version: 1, name: 'Projeto' }, tasks: [task], task, checking: false,
    notify() {}, onToggleChecked() {}, onOpenConversation() {}, onRequestTransfer() {}, close() {}
  })));
  client.clear();
  assert.match(html, /Abrir conversa/);
  assert.match(html, /P1 · Alta/);
  assert.match(html, /Pendente/);
  assert.match(html, /entity-chip[^>]*>[\s\S]*Conversas vinculadas/);
  for (const tab of ['Visão geral', 'Critérios', 'Planejamento', 'Diffs', 'Atividade', 'Conversa']) assert.match(html, new RegExp('role="tab"[^>]*>' + tab));
  assert.match(html, /aria-label="Fechar detalhes \(Esc\)"/);
  assert.doesNotMatch(html, /Aprovar e concluir/);
});

test('tarefa em revisão mostra a barra de revisão com aprovar e devolver', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const task = { _id: 'task-2', version: 1, name: 'Revisar login', status: 'em_revisao', area: 'backend' };
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskDetailsDialog, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', project: { _id: 'project-1', version: 1, name: 'Projeto' }, tasks: [task], task, checking: false,
    notify() {}, onToggleChecked() {}, onOpenConversation() {}, onRequestTransfer() {}, async onReview() { return true; }, close() {}
  })));
  client.clear();
  assert.match(html, /Aprovar e concluir/);
  assert.match(html, /Devolver para ajustes/);
});

test('resumo mostra atividade Markdown e atalhos para conversas específicas', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['task-markdown-summary', 'nonce', 'project-1', 'task-1'], {
    markdown: '# Task da feature\n\n## Conversas vinculadas (1)\n\n- Resumo de atividade',
    generatedAt: '2026-09-30T12:00:00.000Z',
    linkedConversations: [{ conversationId: 'conversation-1', title: 'Alinhar critérios', lastActivityAt: '2026-09-30T11:00:00.000Z', messageCount: 3 }]
  });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskSummaryPanel, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', taskId: 'task-1', onOpenConversation() {}
  })));
  client.clear();
  assert.match(html, /<h2 class="[^"]*text-\[15px\][^"]*">Conversas vinculadas \(1\)<\/h2>/);
  assert.match(html, /aria-label="Abrir conversa Alinhar critérios"/);
  assert.match(html, /Atividade ·/);
});

test('resumo da task apresenta estados de carregamento e erro', () => {
  const loadingClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const loadingHtml = renderToStaticMarkup(createElement(QueryClientProvider, { client: loadingClient }, createElement(TaskSummaryPanel, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', taskId: 'task-pending'
  })));
  loadingClient.clear();
  assert.match(loadingHtml, /Gerando resumo/);

  const errorClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ['task-markdown-summary', 'nonce', 'project-1', 'task-error'];
  errorClient.setQueryData(queryKey, { markdown: 'Old summary' });
  errorClient.getQueryCache().find({ queryKey })?.setState({ ...errorClient.getQueryCache().find({ queryKey })!.state, status: 'error', error: new Error('Falha do resumo'), fetchStatus: 'idle' });
  const errorHtml = renderToStaticMarkup(createElement(QueryClientProvider, { client: errorClient }, createElement(TaskSummaryPanel, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', taskId: 'task-error'
  })));
  errorClient.clear();
  assert.match(errorHtml, /Falha do resumo/);
  assert.match(errorHtml, /Tentar novamente/);
});

test('abrir conversa envia a task e o projeto e aceita o recibo de reuso', async () => {
  const originalFetch = globalThis.fetch;
  let url = '';
  let init: RequestInit | undefined;
  globalThis.fetch = async (input, options) => {
    url = String(input); init = options;
    return new Response(JSON.stringify({ conversation: { _id: 'conversation-1', title: 'Task da feature', taskId: 'task-1' }, created: false }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await openTaskConversation('human-token', 'project-1', 'task-1');
    const body = JSON.parse(String(init?.body));
    assert.match(url, /\/admin\/tasks\/task-1\/conversation$/);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer human-token');
    assert.equal(body.projectId, 'project-1');
    assert.match(body.operationId, /^[0-9a-f-]{36}$/i);
    assert.equal(result.created, false);
    assert.equal(result.conversation._id, 'conversation-1');
  } finally { globalThis.fetch = originalFetch; }
});

test('falha ao abrir conversa é exposta para a interface', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'Task not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  try { await assert.rejects(openTaskConversation('human-token', 'project-1', 'missing-task'), /Task not found/); }
  finally { globalThis.fetch = originalFetch; }
});
