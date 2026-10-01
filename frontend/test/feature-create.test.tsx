import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ CreateFeatureDialog }, { featureDataFromDraft, submitNewFeature }] = await Promise.all([
  vite.ssrLoadModule('/src/features/tasks/CreateFeatureDialog.tsx'),
  vite.ssrLoadModule('/src/features/tasks/feature-create.ts')
]);
after(async () => { await vite.close(); });

const draft = (overrides: Record<string, unknown> = {}) => ({
  name: '  Colaboração  ', objective: '  Abrir conversa por task  ', context: '  Contexto de projeto  ', acceptance: ['  Reusa conversa aberta  ', '', '  Mostra atividade recente  '], ...overrides
});

test('normaliza feature e critérios para o contrato create_feature', () => {
  assert.deepEqual(featureDataFromDraft(draft() as Parameters<typeof featureDataFromDraft>[0]), {
    name: 'Colaboração', objective: 'Abrir conversa por task', context: 'Contexto de projeto',
    acceptance: ['Reusa conversa aberta', 'Mostra atividade recente']
  });
  assert.throws(() => featureDataFromDraft(draft({ name: ' ' }) as Parameters<typeof featureDataFromDraft>[0]), /nome, objetivo e contexto/);
  assert.throws(() => featureDataFromDraft(draft({ acceptance: [' ', ''] }) as Parameters<typeof featureDataFromDraft>[0]), /ao menos um critério/);
});

test('dialog oferece campos e edição dinâmica dos critérios de aceite', () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(CreateFeatureDialog, {
    token: 'human-token', nonce: 'nonce', projectId: 'project-1', close() {}, onCreated() {}
  })));
  client.clear();
  assert.match(html, /Criar feature/);
  assert.match(html, /name="name"/);
  assert.match(html, /name="objective"/);
  assert.match(html, /name="context"/);
  assert.match(html, /Critérios de aceite/);
  assert.match(html, /aria-label="Remover critério 1"/);
  assert.match(html, /\+ Critério/);
});

test('submete criação de feature no projeto com operationId novo e apresenta erros HTTP', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(input), init, body });
    return new Response(JSON.stringify({ _id: 'feature-new', name: body.data.name, ...body.data }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await submitNewFeature('human-token', 'project-1', draft() as Parameters<typeof submitNewFeature>[2]);
    assert.match(requests[0].url, /\/admin\/features$/);
    assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer human-token');
    assert.match(requests[0].body.operationId, /^[0-9a-f-]{36}$/i);
    assert.equal(requests[0].body.projectId, 'project-1');
    assert.deepEqual(requests[0].body.data.acceptance, ['Reusa conversa aberta', 'Mostra atividade recente']);
    assert.equal(result._id, 'feature-new');
  } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'Project access denied' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try { await assert.rejects(submitNewFeature('human-token', 'project-1', draft() as Parameters<typeof submitNewFeature>[2]), /Project access denied/); }
  finally { globalThis.fetch = originalFetch; }
});
