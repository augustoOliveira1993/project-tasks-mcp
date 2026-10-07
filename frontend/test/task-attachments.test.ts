import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import * as XLSX from 'xlsx';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ TaskAttachmentsPanel }, { TaskDetailsDialog }, api] = await Promise.all([
  vite.ssrLoadModule('/src/components/tasks/TaskAttachmentsPanel.tsx'),
  vite.ssrLoadModule('/src/components/tasks/TaskDetailsDialog.tsx'),
  vite.ssrLoadModule('/src/api.ts')
]);
after(async () => { await vite.close(); });

const image = { id: 'image-1', name: 'foto da tarefa.jpg', contentType: 'image/jpeg', size: 1536, createdAt: '2026-10-07T00:00:00.000Z' };
const documentFile = { id: 'document-1', name: 'relatorio.pdf', contentType: 'application/pdf', size: 2048, createdAt: '2026-10-07T00:00:00.000Z' };
const spreadsheetFile = { id: 'sheet-1', name: 'dados.xlsx', contentType: 'application/octet-stream', size: 3072, createdAt: '2026-10-07T00:00:00.000Z' };
const csvFile = { id: 'csv-1', name: 'dados.csv', contentType: 'text/csv', size: 64, createdAt: '2026-10-07T00:00:00.000Z' };
const otherFile = { id: 'archive-1', name: 'pacote.zip', contentType: 'application/zip', size: 4096, createdAt: '2026-10-07T00:00:00.000Z' };

test('detalhes da tarefa mostram a aba Arquivos e listam prévia e download', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const task = { _id: 'task-1', version: 1, name: 'Anexos da task', status: 'pendente', area: 'frontend' };
  client.setQueryData(['task-attachments', 'nonce', 'project-1', 'task-1'], [image, documentFile, spreadsheetFile, csvFile, otherFile]);
  const panel = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskAttachmentsPanel, {
    token: 'token', nonce: 'nonce', projectId: 'project-1', taskId: task._id
  })));
  assert.match(panel, /Adicionar arquivos/);
  assert.match(panel, /foto da tarefa\.jpg/);
  assert.match(panel, /relatorio\.pdf/);
  assert.match(panel, /dados\.xlsx/);
  assert.match(panel, /dados\.csv/);
  assert.match(panel, /pacote\.zip/);
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

  const mutations: Array<{ method: string; url: string; body?: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    mutations.push({ method: init?.method ?? 'GET', url: String(input), ...(typeof init?.body === 'string' ? { body: init.body } : {}), authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ attachment: { ...image, name: 'foto renomeada.jpg' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal((await api.renameTaskAttachment('human-token', 'project-1', 'task-1', image.id, 'foto renomeada.jpg')).name, 'foto renomeada.jpg');
    assert.equal(mutations[0].method, 'PATCH');
    assert.match(mutations[0].url, /\/admin\/projects\/project-1\/tasks\/task-1\/attachments\/image-1$/);
    assert.deepEqual(JSON.parse(mutations[0].body ?? '{}'), { fileName: 'foto renomeada.jpg' });
    assert.equal(mutations[0].authorization, 'Bearer human-token');
    const deleted = await api.deleteTaskAttachment('human-token', 'project-1', 'task-1', image.id);
    assert.equal(mutations[1].method, 'DELETE');
    assert.equal(mutations[1].url, mutations[0].url);
    assert.equal(mutations[1].authorization, 'Bearer human-token');
    assert.equal(deleted, undefined);
  } finally { globalThis.fetch = originalDownloadFetch; }
});

test('painel mostra previews por tipo e exige confirmação antes de excluir', async () => {
  const dom = new Window({ url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom : (dom as unknown as Record<string, unknown>)[key] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const current = [image, documentFile, spreadsheetFile, csvFile, otherFile];
  const methods: string[] = [];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Nome', 'Valor'], ['Ana', '12']]), 'Resumo');
  const filledXlsx = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const response = (body: BodyInit | null, status = 200, contentType = 'application/json') => new Response(body, { status, headers: { 'content-type': contentType } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    methods.push(method);
    if (method === 'PATCH') {
      const fileName = JSON.parse(String(init?.body)).fileName as string;
      const renamed = { ...current[0], name: fileName };
      current[0] = renamed;
      return response(JSON.stringify({ attachment: renamed }));
    }
    if (method === 'DELETE') {
      if (url.endsWith('/csv-1')) return response(JSON.stringify({ error: 'Sem permissão para excluir.' }), 403);
      const id = url.split('/').at(-1);
      const index = current.findIndex(file => file.id === id);
      if (index >= 0) current.splice(index, 1);
      return response(null, 204);
    }
    if (url.endsWith('/image-1')) return response(new Blob(['image bytes'], { type: 'image/jpeg' }), 200, 'image/jpeg');
    if (url.endsWith('/document-1')) return response(new Blob(['%PDF sample'], { type: 'application/pdf' }), 200, 'application/pdf');
    if (url.endsWith('/sheet-1')) return response(new Blob([filledXlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 200, 'application/octet-stream');
    if (url.endsWith('/csv-1')) return response(new Blob(['Nome,Valor\nBia,18'], { type: 'text/csv' }), 200, 'text/csv');
    return response(JSON.stringify({ items: current }));
  };
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  client.setQueryData(['task-attachments', 'nonce', 'project-1', 'task-1'], current);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const select = (selector: string) => host.querySelector(selector) as unknown as HTMLElement | null;
  const findButton = (label: string) => select(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  const listedNames = () => (Array.from(host.querySelectorAll('.task-attachment-card > .task-attachment-info > strong')) as unknown as HTMLElement[]).map(node => node.textContent);
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TaskAttachmentsPanel, {
      token: 'token', nonce: 'nonce', projectId: 'project-1', taskId: 'task-1'
    }))));
    assert.ok(findButton('Visualizar foto da tarefa.jpg'));
    assert.ok(findButton('Visualizar relatorio.pdf'));
    assert.ok(findButton('Visualizar dados.xlsx'));
    assert.ok(findButton('Visualizar dados.csv'));
    assert.equal(findButton('Visualizar pacote.zip'), null);

    await act(async () => { findButton('Visualizar foto da tarefa.jpg')?.click(); for (let i = 0; i < 5 && !host.querySelector('img[alt="Prévia de foto da tarefa.jpg"]'); i++) await tick(); });
    assert.ok(host.querySelector('img[alt="Prévia de foto da tarefa.jpg"]'));
    await act(async () => { findButton('Visualizar relatorio.pdf')?.click(); for (let i = 0; i < 5 && !host.querySelector('iframe[title="Prévia de relatorio.pdf"]'); i++) await tick(); });
    assert.ok(host.querySelector('iframe[title="Prévia de relatorio.pdf"]'));
    await act(async () => { findButton('Visualizar dados.xlsx')?.click(); for (let i = 0; i < 20 && !host.querySelector('th'); i++) await tick(); });
    assert.equal(host.querySelector('th')?.textContent, 'Nome');
    assert.match(host.textContent ?? '', /Ana/);
    await act(async () => { findButton('Visualizar dados.csv')?.click(); for (let i = 0; i < 20 && host.querySelectorAll('th').length < 4; i++) await tick(); });
    assert.equal(host.querySelectorAll('th').length, 4);
    assert.match(host.textContent ?? '', /Bia/);

    await act(async () => { findButton('Renomear foto da tarefa.jpg')?.click(); });
    const input = select('#attachment-name-image-1') as HTMLInputElement | null;
    assert.ok(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, 'foto renomeada.jpg');
      input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
      input.dispatchEvent(new dom.Event('change', { bubbles: true }) as unknown as Event);
      (select('.task-attachment-edit') as HTMLFormElement | null)?.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
      for (let i = 0; i < 20 && !host.textContent?.includes('foto renomeada.jpg'); i++) await tick();
    });
    assert.ok(listedNames().includes('foto renomeada.jpg'));
    assert.ok(methods.includes('PATCH'));

    await act(async () => { findButton('Excluir foto renomeada.jpg')?.click(); });
    assert.ok(host.querySelector('[role="group"][aria-label="Confirmação para excluir foto renomeada.jpg"]'));
    await act(async () => { (Array.from(host.querySelectorAll('button')) as unknown as HTMLButtonElement[]).find(button => button.textContent === 'Cancelar')?.click(); });
    assert.equal(methods.filter(method => method === 'DELETE').length, 0);
    assert.equal(host.querySelector('[role="group"][aria-label="Confirmação para excluir foto renomeada.jpg"]'), null);

    await act(async () => { findButton('Excluir foto renomeada.jpg')?.click(); });
    await act(async () => { (Array.from(host.querySelectorAll('button')) as unknown as HTMLButtonElement[]).find(button => button.textContent === 'Confirmar exclusão')?.click(); for (let i = 0; i < 20 && current.some(file => file.id === 'image-1'); i++) await tick(); });
    assert.equal(methods.filter(method => method === 'DELETE').length, 1);
    assert.ok(!listedNames().includes('foto renomeada.jpg'));
    await act(async () => { findButton('Excluir dados.csv')?.click(); });
    await act(async () => { (Array.from(host.querySelectorAll('button')) as unknown as HTMLButtonElement[]).find(button => button.textContent === 'Confirmar exclusão')?.click(); for (let i = 0; i < 20 && !host.querySelector('[role="alert"]'); i++) await tick(); });
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? '', /Sem permissão/);
    assert.equal(methods.filter(method => method === 'DELETE').length, 2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    globalThis.fetch = originalFetch;
    dom.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  }
});
