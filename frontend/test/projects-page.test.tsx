import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { ProjectsPage } = await vite.ssrLoadModule('/src/components/projects/ProjectsPage.tsx');
after(async () => { await vite.close(); });

test('página /projects lista projetos acessíveis e oferece a ação para abrir tasks', () => {
  const html = renderToStaticMarkup(createElement(ProjectsPage, {
    projects: [{ project: { _id: 'project-1', version: 0, name: 'Projeto principal', description: 'Descrição', visibility: 'private' }, taskSummary: { counts: { pendente: 2, concluida: 1 } } }],
    isPending: false, activeProjectId: '', search: '', currentPage: 1, pages: 1, total: 1, onSearchChange() {}, onPageChange() {}, onSelect() {}
  }));

  assert.match(html, /Projetos acessíveis/);
  assert.match(html, /Projeto principal/);
  assert.match(html, /Abrir tasks/);
  assert.match(html, /Privado/);
});
