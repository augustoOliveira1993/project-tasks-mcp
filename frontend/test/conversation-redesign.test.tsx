import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const ui = await vite.ssrLoadModule('/src/lib/conversation-ui.ts');
const { ConversationStepper } = await vite.ssrLoadModule('/src/components/conversations/ConversationStepper.tsx');
const { ProposalCard } = await vite.ssrLoadModule('/src/components/conversations/ProposalCard.tsx');
const { ConversationAside } = await vite.ssrLoadModule('/src/components/conversations/ConversationAside.tsx');
after(async () => { await vite.close(); });

test('título sem prefixo "Task:" e título curto do critério', () => {
  assert.equal(ui.stripTaskPrefix('Task: Plano Mestre'), 'Plano Mestre');
  assert.equal(ui.stripTaskPrefix('  task :  x'), 'x');
  assert.equal(ui.stripTaskPrefix('Conversa geral'), 'Conversa geral');
  assert.equal(ui.shortCriterionTitle('O login retorna o token. Depois registra auditoria.'), 'O login retorna o token');
  const long = ui.shortCriterionTitle('Um critério muito longo que não cabe em sessenta caracteres e precisa ser resumido pelo componente');
  assert.ok(long.length <= 61 && long.endsWith('…'), long);
  assert.equal(ui.shortCriterionTitle('**Negrito** com `código` no texto'), 'Negrito com código no texto');
});

test('filtro de critérios, fases e texto de atividade', () => {
  const items = [{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: false }];
  assert.equal(ui.filterCriteria(items, 'all').length, 3);
  assert.deepEqual(ui.filterCriteria(items, 'pending').map((item: { id: number }) => item.id), [2, 3]);
  assert.deepEqual(ui.filterCriteria(items, 'done').map((item: { id: number }) => item.id), [1]);
  assert.equal(ui.conversationPhase([]), 1);
  assert.equal(ui.conversationPhase([{ status: 'pending', stale: false }]), 3);
  assert.equal(ui.conversationPhase([{ status: 'pending', stale: true }]), 1);
  assert.equal(ui.conversationPhase([{ status: 'approved' }]), 4);
  assert.equal(ui.activityText(2, '2026-01-01', () => 'agora'), 'Não lida');
  assert.equal(ui.activityText(0, '2026-01-01', () => 'agora'), 'Lida · agora');
  assert.equal(ui.activityText(0, null, () => 'agora'), 'Sem mensagens ainda');
  assert.equal(ui.suggestionsFor({ name: 'x' }, 10).length, 4);
  assert.match(ui.suggestionsFor({ name: 'x' }, 10)[0], /dos 10 critérios/);
});

test('stepper marca concluída, atual e futura com texto para leitores de tela', () => {
  const html = renderToStaticMarkup(createElement(ConversationStepper, { phase: 3 }));
  assert.match(html, /aria-label="Fases da conversa"/);
  assert.equal((html.match(/step-done/g) ?? []).length, 2);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /Autorização<span class="sr-only"> \(fase atual\)/);
  assert.match(html, /Passo 3 de 4 · Autorização/);
});

const proposal = (overrides = {}) => ({ _id: 'p1', taskId: 't1', expectedTaskVersion: 3, title: 'Executar login', summary: 'Resumo', taskPatch: { instructions: 'Passo 1', acceptance: ['A', 'B'] }, status: 'pending', version: 2, stale: false, ...overrides });
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ProposalCard, { taskVersion: 3, approving: false, onApprove() {}, onRequestChanges() {}, ...props }));

test('cartão de proposta: pendente oferece pedir ajustes e autorizar; autorizada mostra autor e horário', () => {
  const pending = render({ proposal: proposal() });
  assert.match(pending, /Aguardando autorização/);
  assert.match(pending, />Pedir ajustes</);
  assert.match(pending, />Autorizar execução</);
  assert.doesNotMatch(pending, /Confirmar e executar/, 'a confirmação só aparece depois do clique');
  const approved = render({ proposal: proposal({ status: 'approved', approvedBy: 'maria.silva@x.com', approvedAt: '2026-10-06T12:00:00.000Z', jobId: 'j1' }), job: { _id: 'j1', status: 'running', failed: false, permissionTitle: null } });
  assert.match(approved, /Execução autorizada/);
  assert.match(approved, /Autorizada por <strong>Maria<\/strong>/);
  assert.match(approved, /Em execução/);
  assert.doesNotMatch(approved, />Autorizar execução</);
  const outdated = render({ proposal: proposal(), taskVersion: 9 });
  assert.match(outdated, /Desatualizada/);
  assert.match(outdated, /<button[^>]*authorize-button[^>]*disabled/);
});

test('critérios: resumo "N de M", barra segmentada, filtros e disclosure', () => {
  const client = new QueryClient();
  const taskContext = { isPending: false, isError: false, error: null, refetch() {}, data: {
    task: { _id: 't', version: 1, status: 'em_revisao', acceptance: ['Primeiro critério. Detalhe.', 'Segundo critério', 'Terceiro critério'], acceptanceProgress: [true, false, true], acceptanceEvidence: ['Teste passou', null, null] },
    messages: [], executions: []
  } };
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ConversationAside, {
    detail: { conversation: {}, messages: [], proposals: [], task: { _id: 't', version: 1, status: 'em_revisao', name: 'T' }, jobs: [] }, taskContext, onOpenAdmin() {}
  })));
  assert.match(html, /2 de 3 atendidos/);
  assert.match(html, /role="img" aria-label="2 de 3 critérios atendidos"/);
  assert.equal((html.match(/class="segment( done)?"/g) ?? []).length, 3);
  assert.match(html, /Todos 3/);
  assert.match(html, /Pendentes 1/);
  assert.match(html, /Atendidos 2/);
  assert.match(html, /aria-expanded="true"[\s\S]*?Primeiro critério/, 'o primeiro item abre por padrão');
  assert.match(html, /Teste passou/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  assert.match(html, /aria-label="Atendido"/);
  assert.match(html, /aria-label="Pendente"/);
});
