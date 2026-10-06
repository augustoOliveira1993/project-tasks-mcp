import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { fetchAssignees } = await vite.ssrLoadModule('/src/features/tasks/assignees.ts');
const { AssigneePicker } = await vite.ssrLoadModule('/src/components/ui/AssigneePicker.tsx');
after(async () => { await vite.close(); });

function stubCredentials(handler: (params: URLSearchParams) => unknown) {
  const original = globalThis.fetch;
  const calls: URLSearchParams[] = [];
  globalThis.fetch = (async (input: string) => {
    const params = new URL(String(input), 'http://x').searchParams;
    calls.push(params);
    return new Response(JSON.stringify(handler(params)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('lista pessoas do projeto e agentes ativos sem duplicar e-mails', async () => {
  const stub = stubCredentials(params => params.get('scope') === 'agent'
    ? { items: [{ email: 'codex@x.com' }, { email: 'Maria@x.com' }], next: null }
    : { items: [{ email: 'maria@x.com' }, { email: 'joao@x.com' }, { email: 'maria@x.com' }], next: null });
  try {
    const result = await fetchAssignees('token', 'project-1', true);
    assert.deepEqual(result, [
      { email: 'joao@x.com', kind: 'pessoa' }, { email: 'maria@x.com', kind: 'pessoa' }, { email: 'codex@x.com', kind: 'agente' }
    ]);
    const human = stub.calls.find(params => params.get('scope') === 'human')!;
    assert.equal(human.get('projectId'), 'project-1');
    assert.equal(human.get('status'), 'active');
    assert.equal(stub.calls.find(params => params.get('scope') === 'agent')!.get('projectId'), null);
  } finally { stub.restore(); }
});

test('quem não é administrador do sistema só vê pessoas (agentes exigem acesso global)', async () => {
  const stub = stubCredentials(() => ({ items: [{ email: 'ana@x.com' }], next: null }));
  try {
    const result = await fetchAssignees('token', 'project-1', false);
    assert.deepEqual(result, [{ email: 'ana@x.com', kind: 'pessoa' }]);
    assert.equal(stub.calls.some(params => params.get('scope') === 'agent'), false);
  } finally { stub.restore(); }
});

test('seletor agrupa pessoas e agentes, preserva responsável atual e oferece outro e-mail', () => {
  const html = renderToStaticMarkup(createElement(AssigneePicker, {
    name: 'responsible', defaultValue: 'antigo@x.com',
    assignees: [{ email: 'maria.silva@x.com', kind: 'pessoa' }, { email: 'codex@x.com', kind: 'agente' }]
  }));
  assert.match(html, /<optgroup label="Pessoas">/);
  assert.match(html, /<optgroup label="Agentes de IA">/);
  assert.match(html, /Maria · maria\.silva@x\.com/);
  assert.match(html, /antigo@x\.com \(atual, sem credencial ativa\)/);
  assert.match(html, /Outro e-mail…/);
  assert.match(html, /<input type="hidden" name="responsible" value="antigo@x\.com"/);
});
