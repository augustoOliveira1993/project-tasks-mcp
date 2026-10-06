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

  // Vinculado: resumo somente leitura com URL e commit raiz; edição só sob demanda.
  assert.match(html, /aria-label="Repositório backend"/);
  assert.ok(html.includes('https://example.com/backend.git'));
  assert.ok(html.includes(rootCommit.slice(0, 12)));
  assert.match(html, /✓ vinculado/);
  assert.match(html, />Editar vínculo</);
  // Sem vínculo: formulário já aberto, com a URL do cadastro sugerida e o comando para achar o commit raiz.
  assert.match(html, /sem vínculo/);
  assert.ok(html.includes('value="file:///frontend"'));
  assert.match(html, /git rev-list --max-parents=0 HEAD/);
  assert.match(html, /<button[^>]*disabled[^>]*>Salvar vínculo</, 'salvar só habilita com URL e commit válidos');
  assert.match(html, /Sem vínculo, a ponte Git não reconhece este repositório/);
  assert.match(html, /1 de 2 repositórios vinculados/);
});

test('validação do vínculo: commit raiz de 40 hex e URL de remoto', async () => {
  const { isValidRootCommit, isValidRemoteUrl } = await vite.ssrLoadModule('/src/components/admin/RepositoryGitBinding.tsx');
  assert.equal(isValidRootCommit('a'.repeat(40)), true);
  assert.equal(isValidRootCommit(' ' + 'A1'.repeat(20) + ' '), true);
  assert.equal(isValidRootCommit('a'.repeat(39)), false);
  assert.equal(isValidRootCommit('g'.repeat(40)), false);
  assert.equal(isValidRemoteUrl('https://github.com/org/repo.git'), true);
  assert.equal(isValidRemoteUrl('git@github.com:org/repo.git'), true);
  assert.equal(isValidRemoteUrl('ssh://git@host/org/repo.git'), true);
  assert.equal(isValidRemoteUrl('github.com/org/repo'), false);
  assert.equal(isValidRemoteUrl(''), false);
});
