import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ TaskAttachmentsPanel }, { TaskDetailsDialog }, api] = await Promise.all([
  vite.ssrLoadModule('/src/components/tasks/TaskAttachmentsPanel.tsx'),
  vite.ssrLoadModule('/src/components/tasks/TaskDetailsDialog.tsx'),
  vite.ssrLoadModule('/src/api.ts')
]);
after(async () => { await vite.close(); });

const image = { id: 'image-1', name: 'foto da tarefa.jpg', contentType: 'image/jpeg', size: 1536, createdAt: '2026-10-07T00:00:00.000Z' };
const documentFile = { id: 'document-1', name: 'relatorio.pdf', contentType: 'application/pdf', size: 2048, createdAt: '2026-10-07T00:00:00.000Z' };

test('detalhes da tarefa mostram a aba Arquivos e listam prévia e download', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const task = { _id: 'task-1', version: 1, name: 'Anexos da task', status: 'pendente', area: 'frontend' };
  client.setQueryData(['task-attachments', 'nonce', 'project-1', 'task-1'], [image, documentFile]);
  const panel = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskAttachmentsPanel, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', taskId: task._id
  })));
  assert.match(panel, /Adicionar arquivos/);
  assert.match(panel, /foto da tarefa\.jpg/);
  assert.match(panel, /relatorio\.pdf/);
  assert.match(panel, /Visualizar/);
  assert.match(panel, /Baixar/);

  client.setQueryData(['task-context', 'nonce', 'project-1', 'task-1'], {
    task: { ...task, acceptance: [], acceptanceProgress: [] }, feature: null, messages: [], executions: [], dependencies: [], markdowns: { task: { items: [] } }
  });
  client.setQueryData(['project-features', 'nonce', 'project-1'], []);
  client.setQueryData(['task-diffs', 'nonce', 'project-1', 'task-1'], { items: [] });
  client.setQueryData(['task-markdowns', 'nonce', 'project-1', 'task-1'], { items: [] });
  const details = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskDetailsDialog, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', project: { _id: 'project-1', version: 1, name: 'Projeto' }, tasks: [task], task, checking: false,
    notify() {}, onToggleChecked() {}, onOpenConversation() {}, onRequestTransfer() {}, close() {}
  })));
  client.clear();
  assert.match(details, /role="tab"[^>]*>Arquivos/);
});

test('API lista, envia com progresso autenticado e baixa anexos', async () => {
  const originalFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer human-token');
    return new Response(JSON.stringify({ items: [image] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const listed = await api.listTaskAttachments('human-token', 'project-1', 'task-1');
    assert.deepEqual(listed, [image]);
    assert.match(urls[0], /\/admin\/projects\/project-1\/tasks\/task-1\/attachments$/);
  } finally { globalThis.fetch = originalFetch; }

  class FakeXhr {
    static latest: FakeXhr;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    status = 201;
    responseText = JSON.stringify({ attachment: image });
    method = '';
    url = '';
    headers: Record<string, string> = {};
    sentBody: unknown;
    onload: ((event: ProgressEvent<EventTarget>) => void) | null = null;
    onerror: ((event: ProgressEvent<EventTarget>) => void) | null = null;
    onabort: ((event: ProgressEvent<EventTarget>) => void) | null = null;
    constructor() { FakeXhr.latest = this; }
    open(method: string, url: string) { this.method = method; this.url = url; }
    setRequestHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
    send(body: Document | XMLHttpRequestBodyInit | null) {
      this.sentBody = body;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 } as ProgressEvent);
      this.onload?.({} as ProgressEvent<EventTarget>);
    }
  }
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  try {
    const file = new File(['image bytes'], 'foto tarefa.jpg', { type: 'image/jpeg' });
    const progress: Array<number | null> = [];
    const uploaded = await api.uploadTaskAttachment('human-token', 'project-1', 'task-1', file, (value: number | null) => progress.push(value));
    assert.deepEqual(uploaded, image);
    assert.equal(FakeXhr.latest.method, 'POST');
    assert.match(FakeXhr.latest.url, /\/admin\/projects\/project-1\/tasks\/task-1\/attachments\?filename=foto\+tarefa\.jpg$/);
    assert.equal(FakeXhr.latest.headers.authorization, 'Bearer human-token');
    assert.equal(FakeXhr.latest.headers['content-type'], 'image/jpeg');
    assert.equal(FakeXhr.latest.sentBody, file);
    assert.deepEqual(progress, [25]);
  } finally { globalThis.XMLHttpRequest = originalXhr; }

  const originalDownloadFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/admin\/projects\/project-1\/tasks\/task-1\/attachments\/image-1$/);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer human-token');
    return new Response('image bytes', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  };
  try { assert.equal(await (await api.downloadTaskAttachment('human-token', 'project-1', 'task-1', image.id)).text(), 'image bytes'); }
  finally { globalThis.fetch = originalDownloadFetch; }
});
