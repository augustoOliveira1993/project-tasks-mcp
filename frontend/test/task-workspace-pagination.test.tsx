import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { TaskWorkspace } = await vite.ssrLoadModule('/src/features/tasks/TaskWorkspace.tsx');
after(async () => { await vite.close(); });

test('renderiza a página pedida e os controles de paginação', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search: '?page=3&pageSize=10' } }
  });

  try {
    const tasks = Array.from({ length: 23 }, (_, index) => ({
      _id: `task-${index + 1}`, version: 1, name: `Task ${index + 1}`, status: 'pendente'
    }));
    const html = renderToStaticMarkup(createElement(TaskWorkspace, {
      projectId: 'project', tasks, isPending: false, isError: false, error: null, saving: false,
      onRefresh() {}, onOpenTask() {}, onChangeStatus() {}, onToggleChecked() {},
      canHardDelete: false, onRequestHardDeleteTask() {}, onArchiveTask() {},
      async onApproveSelected() { return true; }, async onSetTasksChecked() { return []; }
    }));

    assert.match(html, /Mostrando 21–23 de 23/);
    assert.match(html, /Página 3 de 3/);
    assert.match(html, /<option selected="">10<\/option>/);
    assert.match(html, /<option>25<\/option>/);
    assert.match(html, /<option>50<\/option>/);
    assert.match(html, /<option>100<\/option>/);
    assert.match(html, /Task 21/);
    assert.match(html, /Task 23/);
    assert.doesNotMatch(html, /Task 20/);
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
    projectId: 'project', tasks: [task], isPending: false, isError: false, error: null, saving: false,
    onRefresh() {}, onOpenTask() {}, onChangeStatus() {}, onToggleChecked() {}, onRequestHardDeleteTask() {}, onArchiveTask() {},
    async onApproveSelected() { return true; }, async onSetTasksChecked() { return []; }
  };

  try {
    const adminHtml = renderToStaticMarkup(createElement(TaskWorkspace, { ...sharedProps, canHardDelete: true }));
    assert.match(adminHtml, /Arquivar/);
    assert.match(adminHtml, /Excluir/);
    const memberHtml = renderToStaticMarkup(createElement(TaskWorkspace, { ...sharedProps, canHardDelete: false }));
    assert.match(memberHtml, /Arquivar/);
    assert.doesNotMatch(memberHtml, /delete-row-action/);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
