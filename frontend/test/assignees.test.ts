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

test('seletor sem digitação não oferece "Outro e-mail" e usa o texto vazio informado', () => {
  const html = renderToStaticMarkup(createElement(AssigneePicker, {
    assignees: [{ email: 'maria@x.com', kind: 'pessoa' }], allowCustom: false, emptyLabel: 'Selecione seu nome'
  }));
  assert.doesNotMatch(html, /Outro e-mail/);
  assert.match(html, /Selecione seu nome/);
  assert.match(html, /maria@x\.com/);
});

test('cadastro de responsável: tipos de token, projetos e restrição para quem não é administrador do sistema', async () => {
  const { ResponsibleRegistration, issuedText } = await vite.ssrLoadModule('/src/components/admin/ResponsibleRegistration.tsx');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const projects = [{ _id: 'p1', version: 1, name: 'AVBOne', visibility: 'private' }, { _id: 'p2', version: 2, name: 'Portal RH', visibility: 'shared' }];
  const render = (systemAdmin: boolean) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ResponsibleRegistration, {
    token: 't', projects, currentProjectId: 'p1', systemAdmin, knownEmails: [], notify() {}, onChanged() {}
  })));
  const admin = render(true);
  assert.match(admin, /Novo responsável/);
  assert.match(admin, /Token de acesso \(pessoa\)/);
  assert.match(admin, /Token de agente/);
  assert.match(admin, /type="checkbox"[^>]*name="project-access"/);
  const member = render(false);
  assert.match(member, /Somente administradores do sistema emitem tokens de agente/);
  assert.match(member, /type="radio"[^>]*name="project-access"/);
  const text = issuedText({ email: 'a@x.com', agent: { token: 'AG', credentialId: '1' }, person: { token: 'PE', credentialId: '2', projects: ['AVBOne', 'Portal RH'] }, failures: [] });
  assert.match(text, /Responsável: a@x\.com/);
  assert.match(text, /Token de agente[^\n]*: AG/);
  assert.match(text, /projetos: AVBOne, Portal RH\nPE/);
});

test('membros do projeto: agrupa tokens por e-mail e mostra avatares com cartão de detalhes', async () => {
  const { groupMembers } = await vite.ssrLoadModule('/src/features/projects/members.ts');
  const { AvatarStack } = await vite.ssrLoadModule('/src/components/ui/AvatarStack.tsx');
  const members = groupMembers([
    { credentialId: '1', email: 'Maria@x.com', scope: 'human', systemAdmin: false, state: 'active', createdAt: '2026-10-02T10:00:00Z', projects: [{ projectId: 'p1', projectName: 'AVBOne', role: 'colaborador' }, { projectId: 'p2', projectName: 'Portal RH', role: 'colaborador' }] },
    { credentialId: '2', email: 'maria@x.com', scope: 'human', systemAdmin: false, state: 'active', createdAt: '2026-09-01T10:00:00Z', projectId: 'p1', role: 'administrador' },
    { credentialId: '3', email: 'revogado@x.com', scope: 'human', systemAdmin: false, state: 'revoked', createdAt: null }
  ], 'p1');
  assert.equal(members.length, 1);
  assert.equal(members[0].credentials, 2);
  assert.deepEqual(members[0].roles, ['colaborador', 'administrador']);
  assert.equal(members[0].since, '2026-09-01T10:00:00Z');
  assert.deepEqual(members[0].otherProjects, ['Portal RH']);
  const people = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'].map(email => ({ email, lines: ['Papel: Colaborador'] }));
  const html = renderToStaticMarkup(createElement(AvatarStack, { people, max: 4, label: 'Responsáveis de AVBOne' }));
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 5);
  assert.match(html, /role="tooltip"/);
  assert.match(html, />\+2</);
  assert.match(html, /Papel: Colaborador/);
  assert.match(renderToStaticMarkup(createElement(AvatarStack, { people: [], label: 'x' })), /Sem responsáveis/);
});

test('cadastro de responsáveis: agrupa por e-mail, separa pessoa e agente e filtra', async () => {
  const { groupResponsibles } = await vite.ssrLoadModule('/src/features/responsibles/responsibles.ts');
  const { filterResponsibles, ResponsiblesCatalog } = await vite.ssrLoadModule('/src/features/catalogs/ResponsiblesCatalog.tsx');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const items = groupResponsibles([
    { credentialId: '1', email: 'Maria@x.com', scope: 'human', systemAdmin: false, state: 'active', createdAt: '2026-10-02T10:00:00Z', projects: [{ projectId: 'p1', projectName: 'AVBOne', role: 'colaborador' }] },
    { credentialId: '2', email: 'maria@x.com', scope: 'agent', systemAdmin: false, state: 'active', createdAt: '2026-09-01T10:00:00Z' },
    { credentialId: '3', email: 'joao@x.com', scope: 'human', systemAdmin: false, state: 'active', createdAt: null, projectId: 'p2', projectName: 'Portal RH' },
    { credentialId: '4', email: 'velho@x.com', scope: 'human', systemAdmin: false, state: 'revoked', createdAt: null }
  ]);
  assert.deepEqual(items.map((item: { email: string }) => item.email), ['joao@x.com', 'Maria@x.com']);
  const maria = items[1];
  assert.deepEqual(maria.kinds, ['pessoa', 'agente']);
  assert.equal(maria.tokens, 2);
  assert.deepEqual(maria.projects, ['AVBOne']);
  assert.equal(maria.since, '2026-09-01T10:00:00Z');
  assert.deepEqual(items[0].projects, ['Portal RH']);
  assert.equal(filterResponsibles(items, '', 'agente').length, 1);
  assert.equal(filterResponsibles(items, 'portal', 'todos').length, 1);
  assert.equal(filterResponsibles(items, 'zzz', 'todos').length, 0);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ResponsiblesCatalog, {
    token: 't', nonce: 'n', projects: [], project: { _id: 'p1', version: 1, name: 'AVBOne' }, systemAdmin: true, notify() {}, onChanged() {}
  })));
  assert.match(html, /<h2>Responsáveis<\/h2>/);
  assert.match(html, />Novo responsável</);
  assert.match(html, /aria-label="Buscar responsáveis"/);
});

test('cadastros não repetem o seletor de projeto (vem do menu lateral)', async () => {
  const { CatalogsPage } = await vite.ssrLoadModule('/src/features/catalogs/CatalogsPage.tsx');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(CatalogsPage, {
    section: 'responsibles', token: 't', nonce: 'n', projects: [{ _id: 'p1', version: 1, name: 'AVBOne' }], project: { _id: 'p1', version: 1, name: 'AVBOne' }, tasks: [],
    notify() {}, onProjectCreated() {}, onSelectProject() {}, onChanged() {}
  })));
  assert.doesNotMatch(html, /Projeto dos cadastros|catalog-project-picker|catalog-section-nav/);
  assert.match(html, /Projeto ativo: AVBOne/);
});
