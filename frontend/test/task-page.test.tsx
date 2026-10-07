import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ TaskPage }, { TaskDetailsDialog }] = await Promise.all([
  vite.ssrLoadModule('/src/features/tasks/TaskPage.tsx'),
  vite.ssrLoadModule('/src/components/tasks/TaskDetailsDialog.tsx')
]);
after(async () => { await vite.close(); });

const task = { _id: 'task-1', version: 7, name: 'Redesenhar detalhes', status: 'em_execucao', area: 'frontend', featureId: 'feature-1', priority: 1, responsible: 'ana@example.com', updatedAt: '2026-09-30T12:00:00.000Z', acceptance: ['Primeiro critério', 'Segundo critério'], acceptanceProgress: [true, false] };
const base = {
  token: 'token', nonce: 'nonce', projectId: 'project-1', project: { _id: 'project-1', version: 1, name: 'Projeto' }, tasks: [task], checking: false,
  notify() {}, onToggleChecked() {}, onOpenConversation() {}, onRequestTransfer() {}, close() {}
};

function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['task-context', 'nonce', 'project-1', 'task-1'], { task, feature: { _id: 'feature-1', name: 'Detalhes' }, messages: [], executions: [], dependencies: [{ _id: 'task-0', name: 'API pronta', status: 'concluida', area: 'backend' }] });
  client.setQueryData(['task-diffs', 'nonce', 'project-1', 'task-1'], { items: [] });
  client.setQueryData(['task-markdowns', 'nonce', 'project-1', 'task-1'], { items: [] });
  client.setQueryData(['project-features', 'nonce', 'project-1'], [{ _id: 'feature-1', name: 'Detalhes' }]);
  client.setQueryData(['task-attachments', 'nonce', 'project-1', 'task-1'], [{ id: 'a1', fileName: 'a.png' }, { id: 'a2', fileName: 'b.pdf' }, { id: 'a3', fileName: 'c.txt' }]);
  client.setQueryData(['task-activity', 'nonce', 'project-1', 'task-1'], { items: [{ _id: 'e1', kind: 'task_progress', summary: 'x', createdAt: '2026-09-30T12:00:00.000Z' }, { _id: 'e2', kind: 'task_claimed', summary: 'y', createdAt: '2026-09-30T12:01:00.000Z' }] });
  return client;
}

test('página da tarefa mostra cabeçalho, trilho vertical com contadores e cards de progresso', () => {
  const client = seeded();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskPage, { ...base, taskId: 'task-1' })));
  client.clear();
  assert.match(html, /<section[^>]*aria-labelledby="details-title"/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.match(html, /Voltar às tarefas/);
  assert.match(html, /Redesenhar detalhes/);
  assert.match(html, /aria-orientation="vertical"/);
  for (const tab of ['Visão geral', 'Critérios', 'Planejamento', 'Diffs', 'Atividade', 'Arquivos', 'Conversa']) assert.match(html, new RegExp('role="tab"[^>]*>' + tab));
  assert.match(html, /role="tab"[^>]*>Arquivos<span class="[^"]*">3<\/span>/);
  assert.match(html, /role="tab"[^>]*>Atividade<span class="[^"]*">\d+<\/span>/);
  assert.match(html, /1 de 2 atendidos/);
  assert.match(html, /Segundo critério/);
  assert.match(html, /API pronta/);
  assert.match(html, /v7/);
  assert.doesNotMatch(html, /Fechar detalhes/);
  assert.doesNotMatch(html, /Abrir página/);
});

test('página da tarefa mostra carregamento enquanto o contexto não chega', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskPage, { ...base, taskId: 'task-9' })));
  client.clear();
  assert.match(html, /Carregando a tarefa/);
});

test('drawer usa o mesmo conteúdo com trilho horizontal e atalho para a página', () => {
  const client = seeded();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskDetailsDialog, { ...base, task, onOpenPage() {} })));
  client.clear();
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /aria-orientation="horizontal"/);
  assert.match(html, /Abrir página/);
  assert.match(html, /aria-label="Fechar detalhes \(Esc\)"/);
  assert.match(html, /1 de 2 atendidos/);
});
