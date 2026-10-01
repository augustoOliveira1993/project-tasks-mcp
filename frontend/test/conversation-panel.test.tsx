import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { ConversationPanel } = await vite.ssrLoadModule('/src/components/conversations/ConversationPanel.tsx');
after(async () => { await vite.close(); });

function renderPanel(items: Array<Record<string, unknown>>, next: string | null = null, error?: Error, requestedConversationId?: string, messages: Array<Record<string, unknown>> = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const queryKey = ['conversations', 'session-nonce', 'project-id'];
  client.setQueryData(queryKey, { items, next });
  client.setQueryData(['project-features', 'session-nonce', 'project-id'], [{ _id: 'feature-1', name: 'Colaboração por task' }]);
  if (requestedConversationId) client.setQueryData(['conversation', 'session-nonce', 'project-id', requestedConversationId], {
    conversation: { _id: requestedConversationId, projectId: 'project-id', taskId: null, title: 'Teste dos ícones', status: 'open', version: 0 },
    messages, next: null, proposals: [], task: null, jobs: []
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
    { _id: 'codex-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', clientName: 'Codex', content: 'Resposta Codex', createdAt: '2026-10-01T12:00:00.000Z' },
    { _id: 'claude-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', clientName: 'Claude', content: 'Resposta Claude', createdAt: '2026-10-01T12:01:00.000Z' },
    { _id: 'legacy-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', content: 'Resposta legada', createdAt: '2026-10-01T12:02:00.000Z' },
    { _id: 'unknown-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'agent', clientName: 'Agente local', content: 'Resposta desconhecida', createdAt: '2026-10-01T12:03:00.000Z' },
    { _id: 'human-message', author: 'augusto.oliveira@ferroeste.com.br', authorType: 'human', clientName: 'Codex', content: 'Mensagem humana', createdAt: '2026-10-01T12:04:00.000Z' }
  ]);

  assert.match(html, /conversation-agent-icon codex/);
  assert.match(html, /conversation-agent-icon claude/);
  assert.match(html, /Codex \(Augusto\)/);
  assert.match(html, /Claude \(Augusto\)/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /conversation-agent-icon generic/);
  assert.match(html, /IA \(Augusto\)/);
  assert.match(html, /Agente local \(Augusto\)/);

  const humanArticle = html.match(/<article class="conversation-message human">[\s\S]*?<\/article>/)?.[0];
  assert.ok(humanArticle);
  assert.match(humanArticle, /Pessoa \(Augusto\)/);
  assert.doesNotMatch(humanArticle, /conversation-agent-icon/);
});
