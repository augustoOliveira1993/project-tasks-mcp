import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { markTaskReadIfUnread } = await vite.ssrLoadModule('/src/features/tasks/task-read.ts');
after(async () => { await vite.close(); });

test('marca cursor não lido sem enviar identidade e invalida o resumo para atualizar o badge', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  let invalidations = 0;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ cursor: 42 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const marked = await markTaskReadIfUnread({
      token: 'human-token', projectId: 'project-1', taskId: 'task-1', operationId: '580e3e64-88fc-4bc4-a637-1637796cb866',
      unread: { count: 2, cursor: 42 }
    }, async () => { invalidations += 1; });
    assert.equal(marked, true);
    assert.ok(requestUrl.endsWith('/admin/tasks/read'));
    assert.equal(new Headers(requestInit?.headers).get('authorization'), 'Bearer human-token');
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      operationId: '580e3e64-88fc-4bc4-a637-1637796cb866', projectId: 'project-1', taskId: 'task-1', cursor: 42
    });
    assert.equal(invalidations, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('não chama a rota quando a task não tem cursor não lido', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let invalidations = 0;
  globalThis.fetch = (async () => { requests += 1; return new Response('{}'); }) as typeof fetch;
  try {
    const marked = await markTaskReadIfUnread({
      token: 'human-token', projectId: 'project-1', taskId: 'task-1', operationId: '32df29ad-2f1f-44d6-ad5c-d67916902d21',
      unread: { count: 0, cursor: null }
    }, async () => { invalidations += 1; });
    assert.equal(marked, false);
    assert.equal(requests, 0);
    assert.equal(invalidations, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('propaga falha da rota para mostrar retry e permite repetir a mesma operação', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  let shouldFail = true;
  let invalidations = 0;
  globalThis.fetch = (async (_input, init) => {
    bodies.push(String(init?.body));
    return shouldFail
      ? new Response(JSON.stringify({ error: 'Serviço indisponível' }), { status: 503, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ cursor: 42 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const input = {
    token: 'human-token', projectId: 'project-1', taskId: 'task-1', operationId: '7e126285-8f4d-4d95-a7cc-a98681e9c956',
    unread: { count: 1, cursor: 42 }
  };
  const invalidate = async () => { invalidations += 1; };
  try {
    await assert.rejects(markTaskReadIfUnread(input, invalidate), /Serviço indisponível/);
    assert.equal(invalidations, 0);
    shouldFail = false;
    assert.equal(await markTaskReadIfUnread(input, invalidate), true);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(invalidations, 1);
  } finally { globalThis.fetch = originalFetch; }
});
