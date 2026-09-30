import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ HardDeleteDialog, matchesHardDeleteConfirmation }, { AdminPanel }] = await Promise.all([
  vite.ssrLoadModule('/src/components/ui/HardDeleteDialog.tsx'),
  vite.ssrLoadModule('/src/components/admin/AdminPanel.tsx')
]);
const { ApiRequestError, request } = await vite.ssrLoadModule('/src/api.ts');
after(async () => { await vite.close(); });

test('confirmação aceita somente nome completo ou ID completo, ignorando caixa e espaços externos', () => {
  const target = { kind: 'project', name: 'Projeto Exemplo', id: '2cf125f1-138a-4237-9467-2480d600af7f' } as const;
  assert.equal(matchesHardDeleteConfirmation('  projeto exemplo ', target), true);
  assert.equal(matchesHardDeleteConfirmation(target.id.toUpperCase(), target), true);
  assert.equal(matchesHardDeleteConfirmation('Projeto', target), false);
  assert.equal(matchesHardDeleteConfirmation('', target), false);
});

test('request preserva o status HTTP para tratar 403 e 409 sem supor sucesso', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Conflict' }), { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(request('token', '/delete', { method: 'DELETE', body: { operationId: 'operation' } }), (error: unknown) => error instanceof ApiRequestError && error.status === 409 && error.message === 'Conflict');
  } finally { globalThis.fetch = originalFetch; }
});

test('diálogo de projeto explica a cascata e mantém confirmação desabilitada sem digitação', () => {
  const html = renderToStaticMarkup(createElement(HardDeleteDialog, {
    target: { kind: 'project', id: '2cf125f1-138a-4237-9467-2480d600af7f', name: 'Projeto Exemplo' },
    busy: false, onClose() {}, onConfirm() {}
  }));
  assert.match(html, /Excluir projeto definitivamente/);
  assert.match(html, /Credenciais humanas compartilhadas/);
  assert.match(html, /execução ou automação ativa/);
  assert.match(html, /Digite o nome exato ou o ID completo/);
  assert.match(html, /class="button danger-button" disabled="">Excluir definitivamente/);
});

test('diálogo de tarefa mostra projeto, estado e escopo de remoção', () => {
  const html = renderToStaticMarkup(createElement(HardDeleteDialog, {
    target: { kind: 'task', id: 'task-id-full', name: 'Corrigir filtro', projectId: 'project-id', projectName: 'Workspace', status: 'pendente', responsible: 'pessoa@empresa.com' },
    busy: true, onClose() {}, onConfirm() {}
  }));
  assert.match(html, /Projeto: Workspace · Status: pendente · Responsável: pessoa@empresa.com/);
  assert.match(html, /as tarefas irmãs permanecem/);
  assert.match(html, /Excluindo e atualizando as listas/);
  assert.match(html, /disabled=""/);
});

test('painel mantém arquivamento separado e só mostra exclusão de projeto com capability ativa', () => {
  const project = { _id: 'project-id', version: 2, name: 'Workspace', repositories: [] };
  function renderAdmin(canHardDelete: boolean) {
    const client = new QueryClient();
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AdminPanel, {
      token: 'token', project, projects: [project], onChanged() {}, notify() {}, canHardDelete, actionPending: false,
      onRequestHardDeleteProject() {}, onArchiveProject() {}
    })));
  }

  const privileged = renderAdmin(true);
  assert.match(privileged, /Arquivar projeto/);
  assert.match(privileged, /Preserva histórico/);
  assert.match(privileged, /Excluir projeto e dados relacionados/);
  const member = renderAdmin(false);
  assert.match(member, /Arquivar projeto/);
  assert.doesNotMatch(member, /Excluir projeto e dados relacionados/);
});
