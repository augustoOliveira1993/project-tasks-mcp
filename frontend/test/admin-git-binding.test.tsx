import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { AdminPanel, repositoryGitFields } = await vite.ssrLoadModule('/src/components/admin/AdminPanel.tsx');
after(async () => { await vite.close(); });

test('carrega e renderiza os campos Git salvos para o repositório selecionado', () => {
  const rootCommit = 'a'.repeat(40);
  const project = {
    _id: 'project-id', version: 2, name: 'Workspace', repositories: [
      { id: 'bound-repository', name: 'backend', url: 'file:///backend', git: { canonicalRemoteUrl: 'https://example.com/backend.git', rootCommit } },
      { id: 'unbound-repository', name: 'frontend', url: 'file:///frontend' }
    ]
  };

  assert.deepEqual(repositoryGitFields(project, 'bound-repository'), {
    remoteUrl: 'https://example.com/backend.git', rootCommit
  });
  assert.deepEqual(repositoryGitFields(project, 'unbound-repository'), { remoteUrl: '', rootCommit: '' });

  const client = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AdminPanel, {
    token: 'token', project, projects: [project], onChanged() {}, notify() {}, canHardDelete: false, actionPending: false,
    onRequestHardDeleteProject() {}, onArchiveProject() {}
  })));

  assert.ok(html.includes('value="https://example.com/backend.git"'));
  assert.ok(html.includes(`value="${rootCommit}"`));
  assert.match(html, /vinculado/);
  assert.match(html, /sem vínculo/);
});
