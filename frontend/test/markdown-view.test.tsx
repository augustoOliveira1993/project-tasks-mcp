import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const [{ ProjectSummaryDialog }, { TaskSummaryPanel }, { MarkdownModeView }] = await Promise.all([
  vite.ssrLoadModule('/src/components/projects/ProjectSummaryDialog.tsx'),
  vite.ssrLoadModule('/src/components/tasks/TaskSummaryPanel.tsx'),
  vite.ssrLoadModule('/src/components/ui/MarkdownModeView.tsx')
]);
after(async () => { await vite.close(); });

const sampleMarkdown = '# Resumo\n\n**Destaque** e ~~removido~~.\n\n- [x] Revisado\n- [ ] Pendente\n\n| Área | Status |\n| --- | --- |\n| Frontend | ativo |\n\n```ts\nconst ativo = true;\n```\n\n<script>alert(1)</script>';

test('resumo do projeto renderiza GFM e oferece código e visualização', () => {
  const html = renderToStaticMarkup(createElement(ProjectSummaryDialog, {
    name: 'Projeto', taskCount: 3, markdown: sampleMarkdown, isPending: false, isError: false, onClose() {}
  }));

  assert.match(html, /Modo do resumo do projeto/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /<h1 class="[^"]*text-\[19px\][^"]*">Resumo<\/h1>/);
  assert.match(html, /<strong>Destaque<\/strong>/);
  assert.match(html, /<table class="[^"]*">/);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /<script>/);
});

test('visualização Código preserva o Markdown como texto literal', () => {
  const html = renderToStaticMarkup(createElement(MarkdownModeView, {
    content: sampleMarkdown, initialMode: 'source', label: 'Modo do resumo de teste'
  }));

  assert.match(html, /aria-pressed="true">Código<\/button>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\| Frontend \| ativo \|/);
});

test('resumo completo da tarefa reutiliza os modos e o renderer compartilhado', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['task-markdown-summary', 'nonce', 'project', 'task'], { markdown: sampleMarkdown, generatedAt: '2026-09-30T12:00:00.000Z' });
  const element = createElement(QueryClientProvider, { client: queryClient }, createElement(TaskSummaryPanel, {
    token: 'token', nonce: 'nonce', projectId: 'project', taskId: 'task'
  }));
  const html = renderToStaticMarkup(element);

  assert.match(html, /Modo do resumo da tarefa/);
  assert.match(html, /<h1 class="[^"]*text-\[19px\][^"]*">Resumo<\/h1>/);
  assert.match(html, /Visualizar/);
  assert.match(html, /Código/);
});
