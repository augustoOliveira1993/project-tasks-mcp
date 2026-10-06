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
      tasks: [{ taskId: 'task-21', unread: { count: 2 }, openQuestions: [{ conversationId: 'task-message-thread-1' }], gitDiff: { commit: 'abc' } }]
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
    assert.match(html, /aria-label="Abrir conversa de Task 21, 1 pergunta aberta"/);
    assert.doesNotMatch(html, /task-message-thread-1|conversationId=/);
    assert.match(html, /aria-label="Abrir detalhes de Task 21, 2 atividades não lidas"/);
    assert.match(html, /aria-label="Diff Git publicado"/);
    assert.match(html, /href="\/tasks\?taskId=task-21&amp;projectId=project"/);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test('menu da linha expõe arquivamento reversível e deixa exclusão definitiva apenas para systemAdmin', async () => {
  const { buildTaskMenu } = await vite.ssrLoadModule('/src/features/tasks/task-actions.ts');
  const done = { status: 'concluida', checked: false };
  const ids = (menu: Array<{ id: string }>) => menu.map(item => item.id);
  assert.ok(ids(buildTaskMenu(done, { canHardDelete: true, saving: false })).includes('archive'));
  assert.ok(ids(buildTaskMenu(done, { canHardDelete: true, saving: false })).includes('delete'));
  assert.ok(ids(buildTaskMenu(done, { canHardDelete: false, saving: false })).includes('archive'));
  assert.ok(!ids(buildTaskMenu(done, { canHardDelete: false, saving: false })).includes('delete'));
  assert.ok(!ids(buildTaskMenu({ status: 'pendente' }, { canHardDelete: false, saving: false })).includes('archive'));
});

test('ação primária da linha segue o estágio do fluxo', async () => {
  const { primaryActionFor } = await vite.ssrLoadModule('/src/features/tasks/task-actions.ts');
  assert.deepEqual(primaryActionFor({ status: 'em_revisao' }), { id: 'details', label: 'Revisar', emphasis: true });
  assert.deepEqual(primaryActionFor({ status: 'concluida', checked: false }), { id: 'check', label: 'Conferir', emphasis: true });
  assert.equal(primaryActionFor({ status: 'concluida', checked: true }).label, 'Abrir');
  assert.equal(primaryActionFor({ status: 'bloqueada' }).label, 'Ver bloqueio');
});
