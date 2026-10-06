import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { AdminPanel } = await vite.ssrLoadModule('/src/components/admin/AdminPanel.tsx');
const { exportChatText, copyProjectExport, downloadProjectExport } = await vite.ssrLoadModule('/src/components/admin/ProjectExportPanel.tsx');
after(async () => { await vite.close(); });

const bundle = { format: 'project-tasks-export', schemaVersion: 1, exportedAt: '2026-10-02T12:00:00.000Z',
  source: { projectId: 'project-1' }, counts: { tasks: 1 }, exclusions: [], migrationInstructions: 'Preserve IDs e não duplique.',
  data: { tasks: [{ _id: 'task-1', dependencies: ['task-2'], acceptance: ['Critério'], acceptanceProgress: [true] }] } };

test('administration exposes four linked tabs, hides export initially, and preserves administrative controls', () => {
  const client = new QueryClient();
  const project = { _id: 'project-1', version: 0, name: 'Projeto de teste', repositories: [] };
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AdminPanel, {
    token: 'test-token', project, projects: [project], onChanged() {}, notify() {}, canHardDelete: false, systemAdmin: true, actionPending: false,
    onRequestHardDeleteProject() {}, onArchiveProject() {}
  })));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.match(html, /id="admin-panel-danger"[^>]*hidden/);
  assert.match(html, /Zona de perigo/);
  assert.match(html, /aria-controls="admin-panel-tools"/);
  assert.match(html, /id="admin-panel-export"[^>]*hidden/);
  assert.match(html, /Emitir credencial de agente/);
  assert.match(html, /Vincular repositórios Git/);
  assert.match(html, /Baixar JSON completo/);
  assert.match(html, /Copiar para o chat/);
  assert.match(html, /Projeto de teste/);
  assert.doesNotMatch(html, /<details|test-token/);
  client.clear();
});

test('chat package preserves the entire JSON and instructions, clipboard failure is recoverable', async () => {
  const text = exportChatText(bundle);
  assert.ok(text.startsWith(bundle.migrationInstructions));
  assert.ok(text.endsWith(JSON.stringify(bundle, null, 2)));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let copied = '';
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(value: string) { copied = value; } } } });
    assert.equal(await copyProjectExport(bundle), true);
    assert.equal(copied, text);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    assert.equal(await copyProjectExport(bundle), false);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText() { throw new Error('Denied'); } } } });
    assert.equal(await copyProjectExport(bundle), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('download produces complete JSON with a stable project filename and releases object URL', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalTimeout = globalThis.setTimeout;
  let blob: Blob | undefined, clicked = false, removed = false, revoked = '';
  const anchor = { href: '', download: '', click() { clicked = true; }, remove() { removed = true; } };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild() {} } } });
    URL.createObjectURL = value => { blob = value as Blob; return 'blob:export'; };
    URL.revokeObjectURL = value => { revoked = value; };
    globalThis.setTimeout = ((callback: () => void) => { callback(); return 0; }) as any;
    downloadProjectExport(bundle);
    assert.equal(anchor.download, 'projeto-project-1-2026-10-02.json');
    assert.equal(clicked, true);
    assert.equal(removed, true);
    assert.equal(revoked, 'blob:export');
    assert.deepEqual(JSON.parse(await blob!.text()), bundle);
  } finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; globalThis.setTimeout = originalTimeout;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
