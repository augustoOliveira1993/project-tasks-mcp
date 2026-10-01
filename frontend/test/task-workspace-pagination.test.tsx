import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { TaskWorkspace } = await vite.ssrLoadModule('/src/features/tasks/TaskWorkspace.tsx');
after(async () => { await vite.close(); });

test('renderiza a página pedida e os controles de paginação', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search: '?page=3&pageSize=10&featureId=feature-1' } }
  });

  try {
    const tasks = Array.from({ length: 23 }, (_, index) => ({
      _id: `task-${index + 1}`, version: 1, name: `Task ${index + 1}`, status: 'pendente', featureId: 'feature-1'
    }));
    const client = new QueryClient();
    client.setQueryData(['project-sync-report', 'session-nonce', 'project', 'feature-1'], {
      summary: { taskCount: 23, unreadTaskCount: 1, openQuestionCount: 1 },
      tasks: [{ taskId: 'task-21', unread: { count: 2 }, openQuestions: [{}], gitDiff: { commit: 'abc' } }]
    });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskWorkspace, {
      token: 'session-token', nonce: 'session-nonce', projectId: 'project', tasks, isPending: false, isError: false, error: null, saving: false,
      onRefresh() {}, onOpenTask() {}, onChangeStatus() {}, onToggleChecked() {},
      canHardDelete: false, onRequestHardDeleteTask() {}, onArchiveTask() {},
      async onApproveSelected() { return true; }, async onSetTasksChecked() { return []; }
    })));
    client.clear();

    assert.match(html, /Mostrando 21–23 de 23/);
    assert.match(html, /Nova task/);
    assert.match(html, /Nova feature/);
    assert.match(html, /Página 3 de 3/);
    assert.match(html, /<option selected="">10<\/option>/);
    assert.match(html, /<option>25<\/option>/);
    assert.match(html, /<option>50<\/option>/);
    assert.match(html, /<option>100<\/option>/);
    assert.match(html, /Task 21/);
    assert.match(html, /Task 23/);
    assert.doesNotMatch(html, /Task 20/);
    assert.match(html, /value="feature-1"/);
    assert.match(html, /Perguntas abertas/);
    assert.match(html, /1 pergunta\(s\)/);
    assert.match(html, /2 não lida\(s\)/);
    assert.match(html, /Diff Git/);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test('expõe arquivamento reversível e deixa exclusão definitiva apenas para systemAdmin', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' } } });
  const task = { _id: 'task-1', version: 1, name: 'Concluir entrega', status: 'concluida' };
  const sharedProps = {
    token: '', nonce: '', projectId: 'project', tasks: [task], isPending: false, isError: false, error: null, saving: false,
    onRefresh() {}, onOpenTask() {}, onChangeStatus() {}, onToggleChecked() {}, onRequestHardDeleteTask() {}, onArchiveTask() {},
    async onApproveSelected() { return true; }, async onSetTasksChecked() { return []; }
  };

  try {
    const adminClient = new QueryClient();
    const adminHtml = renderToStaticMarkup(createElement(QueryClientProvider, { client: adminClient }, createElement(TaskWorkspace, { ...sharedProps, canHardDelete: true })));
    adminClient.clear();
    assert.match(adminHtml, /Arquivar/);
    assert.match(adminHtml, /Excluir/);
    const memberClient = new QueryClient();
    const memberHtml = renderToStaticMarkup(createElement(QueryClientProvider, { client: memberClient }, createElement(TaskWorkspace, { ...sharedProps, canHardDelete: false })));
    memberClient.clear();
    assert.match(memberHtml, /Arquivar/);
    assert.doesNotMatch(memberHtml, /delete-row-action/);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
