import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { CreateTaskDialog } = await vite.ssrLoadModule('/src/features/tasks/CreateTaskDialog.tsx');
const { createTaskDataFromDraft, submitNewTask } = await vite.ssrLoadModule('/src/features/tasks/task-create.ts');
after(async () => { await vite.close(); });

const draft = (overrides: Record<string, unknown> = {}) => ({
  name: '  Criar relatório  ',
  instructions: '  Implementar a exportação.  ',
  acceptanceText: '  Filtra os resultados\n\n Baixa CSV  ',
  area: 'frontend', repositoryId: 'repo-1', featureId: 'feature-1', type: 'feature', priority: 2,
  dependencies: ['task-1'], responsible: '  dev@example.com  ', ...overrides
});

test('normaliza campos e cria a task associada a área, repositório, feature e dependências', () => {
  const data = createTaskDataFromDraft(draft() as Parameters<typeof createTaskDataFromDraft>[0]);
  assert.equal(data.name, 'Criar relatório');
  assert.equal(data.instructions, 'Implementar a exportação.');
  assert.deepEqual(data.acceptance, ['Filtra os resultados', 'Baixa CSV']);
  assert.equal(data.area, 'frontend');
  assert.equal(data.repositoryId, 'repo-1');
  assert.equal(data.featureId, 'feature-1');
  assert.equal(data.type, 'feature');
  assert.equal(data.priority, 2);
  assert.deepEqual(data.dependencies, ['task-1']);
  assert.deepEqual(createTaskDataFromDraft(draft({ dependencies: [] }) as Parameters<typeof createTaskDataFromDraft>[0]).dependencies, []);
  assert.deepEqual(createTaskDataFromDraft(draft({ dependencies: ['task-1', 'task-2'] }) as Parameters<typeof createTaskDataFromDraft>[0]).dependencies, ['task-1', 'task-2']);
  assert.equal(data.responsible, 'dev@example.com');
  assert.equal(createTaskDataFromDraft(draft({ featureId: '', responsible: '' }) as Parameters<typeof createTaskDataFromDraft>[0]).featureId, null);
  assert.throws(() => createTaskDataFromDraft(draft({ acceptanceText: '  \n ' }) as Parameters<typeof createTaskDataFromDraft>[0]), /ao menos um critério/);
});

test('dialog mostra áreas e associações e submete pelo endpoint administrativo', async () => {
  const client = new QueryClient();
  client.setQueryData(['project-features', 'nonce', 'project-1'], [{ _id: 'feature-1', name: 'Relatórios' }]);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(CreateTaskDialog, {
    token: 'human-token', nonce: 'nonce', projectId: 'project-1', repositories: [{ id: 'repo-1', name: 'frontend', url: 'https://example.com/front.git' }],
    tasks: [{ _id: 'task-1', name: 'Base', status: 'concluida', version: 1 }], defaultFeatureId: 'feature-1', close() {}, onCreated() {}
  })));
  client.clear();
  assert.match(html, /Criar tarefa/);
  assert.match(html, /abra Conversas, selecione esta task ao iniciar o chat/);
  assert.match(html, /Backend/);
  assert.match(html, /Frontend/);
  assert.match(html, /Outro/);
  assert.match(html, /Relatórios/);
  assert.match(html, /Dependências/);
  assert.match(html, /type="checkbox" name="dependencies" value="task-1"/);
  assert.doesNotMatch(html, /type="checkbox" name="dependencies" value="task-1" checked/);
  assert.match(html, /Responsável \(opcional\)/);

  const originalFetch = globalThis.fetch;
  let url = '';
  let init: RequestInit | undefined;
  const operationIds: string[] = [];
  const submittedBodies: Array<{ data: { dependencies: string[] } }> = [];
  globalThis.fetch = async (input, options) => {
    url = String(input);
    init = options;
    const body = JSON.parse(String(options?.body));
    operationIds.push(body.operationId);
    submittedBodies.push(body);
    return new Response(JSON.stringify({ _id: 'task-new', version: 1, name: 'Criar relatório', status: 'pendente' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await submitNewTask('human-token', 'project-1', draft() as Parameters<typeof submitNewTask>[2]);
    const body = JSON.parse(String(init?.body));
    assert.match(url, /\/admin\/tasks$/);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer human-token');
    assert.match(body.operationId, /^[0-9a-f-]{36}$/i);
    assert.equal(body.projectId, 'project-1');
    assert.equal(body.data.featureId, 'feature-1');
    assert.equal(body.data.area, 'frontend');
    assert.deepEqual(body.data.dependencies, ['task-1']);
    assert.equal(result._id, 'task-new');
    await submitNewTask('human-token', 'project-1', draft({ dependencies: [] }) as Parameters<typeof submitNewTask>[2]);
    assert.deepEqual(submittedBodies[1].data.dependencies, []);
    assert.notEqual(operationIds[0], operationIds[1]);
  } finally { globalThis.fetch = originalFetch; }
});

test('submission exposes server errors without swallowing them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'Project access denied' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(submitNewTask('human-token', 'project-1', draft() as Parameters<typeof submitNewTask>[2]), /Project access denied/);
  } finally { globalThis.fetch = originalFetch; }
});
