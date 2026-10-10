import { projectMemoryEvaluation } from './project-memory-evaluation.v1.js';

/** Synthetic, public-safe cases that test whether verified source metadata helps retrieval. */
export const PROJECT_MEMORY_EVALUATION_V2_VERSION = '2.0.0';

const sourceContexts = [
  { key: 'backend-keyset', title: 'Releitura dos lotes da fila sem varredura geral' },
  { key: 'backend-optimistic-version', title: 'Impedir que formulário antigo apague edição nova' },
  { key: 'backend-context-budget', title: 'Enxugar envelope enviado ao agente' },
  { key: 'backend-active-state', title: 'Desconsiderar notas retiradas da base atual' },
  { key: 'frontend-markdown', title: 'Manter apresentação rica nos detalhes do projeto' },
  { key: 'frontend-keyboard-dialog', title: 'Usar janelas modais sem mouse' },
  { key: 'frontend-filter-url', title: 'Compartilhar seleção de filtros por endereço' },
  { key: 'frontend-memory-snippets', title: 'Carregar resumos antes das páginas completas' },
  { key: 'devops-runner-capacity', title: 'Evitar disputa simultânea por vagas de execução' },
  { key: 'devops-heartbeat-lease', title: 'Não recuperar reserva expirada por um sinal tardio' },
  { key: 'devops-reconnect', title: 'Continuar o trabalho depois da reinicialização do executor' },
  { key: 'devops-secret-redaction', title: 'Omitir credenciais nos relatórios de operação' },
  { key: 'docs-markdown-revision', title: 'Editar somente depois de conferir a versão lida' },
  { key: 'docs-acceptance-evidence', title: 'Demonstrar a entrega antes de encerrar o cartão' },
  { key: 'docs-rank-uncertainty', title: 'Explicar incerteza das posições de relevância' },
  { key: 'docs-export-provenance', title: 'Rastrear registros quando migram entre ambientes' },
  { key: 'other-custom-area', title: 'Registrar divisões próprias sem alterar o legado' },
  { key: 'other-delivery-cursor', title: 'Retomar notificações após período desconectado' },
  { key: 'other-diacritics', title: 'Pesquisar grafias portuguesas com sinal gráfico' },
  { key: 'other-human-review', title: 'Exigir validação humana antes de publicar uma nota' }
] as const;

export const projectMemoryEvaluationV2Memories = projectMemoryEvaluation.map(memory => {
  const source = sourceContexts.find(item => item.key === memory.key);
  if (!source) throw new Error(`Missing source context for ${memory.key}`);
  return { ...memory, sourceTitle: source.title };
});

export const projectMemoryEvaluationV2Queries = [
  ...projectMemoryEvaluation.map(memory => ({
    id: `direct-${memory.key}`,
    kind: 'direct' as const,
    query: memory.query,
    expectedKeys: [memory.key]
  })),
  ...sourceContexts.map(source => ({
    id: `source-${source.key}`,
    kind: 'source' as const,
    query: `Na tarefa “${source.title}”, qual orientação ficou registrada?`,
    expectedKeys: [source.key]
  })),
  { id: 'paraphrase-keyset', kind: 'paraphrase' as const, query: 'Ao continuar uma consulta extensa, como evitar receber novamente os mesmos resultados das páginas anteriores?', expectedKeys: ['backend-keyset'] },
  { id: 'paraphrase-optimistic-version', kind: 'paraphrase' as const, query: 'Qual proteção impede duas pessoas de perder alterações ao salvar quase ao mesmo tempo?', expectedKeys: ['backend-optimistic-version'] },
  { id: 'paraphrase-context-budget', kind: 'paraphrase' as const, query: 'Como o sistema decide o que cabe no pacote de informações enviado à inteligência artificial?', expectedKeys: ['backend-context-budget'] },
  { id: 'paraphrase-active-state', kind: 'paraphrase' as const, query: 'Como evitar respostas atuais baseadas em anotações que já foram substituídas?', expectedKeys: ['backend-active-state'] },
  { id: 'paraphrase-markdown', kind: 'paraphrase' as const, query: 'Que recursos de formatação permanecem legíveis no resumo de uma entrega?', expectedKeys: ['frontend-markdown'] },
  { id: 'paraphrase-keyboard-dialog', kind: 'paraphrase' as const, query: 'Como devolver o controle à tela que abriu uma janela sobreposta?', expectedKeys: ['frontend-keyboard-dialog'] },
  { id: 'paraphrase-runner-capacity', kind: 'paraphrase' as const, query: 'Qual limite evita que muitos trabalhos rodem ao mesmo tempo?', expectedKeys: ['devops-runner-capacity'] },
  { id: 'paraphrase-delivery-cursor', kind: 'paraphrase' as const, query: 'Como retomar as novidades do ponto anterior sem carregar todo o histórico?', expectedKeys: ['other-delivery-cursor'] },
  {
    id: 'ambiguous-architecture',
    kind: 'ambiguous' as const,
    query: 'architecture',
    expectedKeys: projectMemoryEvaluation.filter(memory => memory.category === 'architecture').map(memory => memory.key)
  },
  { id: 'no-match-quasar', kind: 'no-match' as const, query: 'quasar xanthoria fumarola 987654321', expectedKeys: [] }
] as const;
