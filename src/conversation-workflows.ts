import { createHash } from 'node:crypto';

export const DEFAULT_CONVERSATION_TYPE_ID = '00000000-0000-4000-8000-000000000001';

export type ConversationWorkflowStage = {
  id: string;
  title: string;
  description: string;
  kind: 'instruction' | 'approval';
  required: boolean;
  instruction?: string;
  approvalLabel?: string;
};

export type ConversationTypeSeedTemplate = {
  key: string;
  name: string;
  description: string;
  taskType?: string;
  prepare: string;
  execute: string;
  validate: string;
};

function deterministicUuid(value: string) {
  const hex = createHash('sha1').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export function seededConversationTypeId(projectId: string, key: string) {
  return deterministicUuid(`project-tasks-mcp:conversation-type:${projectId}:${key}`);
}

const scopeInstruction = 'Leia o contexto da tarefa antes de responder: tipo, área, repositório, feature, dependências, instruções e critérios de aceite. Use a área e o repositório cadastrados para adaptar o trabalho, inclusive em projetos com áreas personalizadas. Trabalhe somente no escopo autorizado. Quando outra área precisar atuar, faça uma pergunta de colaboração ou registre a dependência/bloqueio; não execute o trabalho daquela área. Uma etapa de aprovação do fluxo não substitui a autorização humana explícita nem os controles de permissão do MCP.';

const definitions: ConversationTypeSeedTemplate[] = [
  { key: 'task-feature', taskType: 'feature', name: 'Tarefa · Funcionalidade', description: 'Fluxo para esclarecer, planejar, implementar e validar uma funcionalidade em qualquer área do projeto.', prepare: 'Divida o objetivo em comportamento observável, contratos afetados, dependências e critérios de aceite. Proponha a menor sequência de mudanças que conclua a entrega.', execute: 'Implemente a funcionalidade dentro do repositório e da área da tarefa. Preserve compatibilidade e comunique dependências entre áreas antes de ultrapassar o escopo.', validate: 'Relacione cada critério ao comportamento implementado e às verificações realizadas. Informe limitações e próximos passos sem afirmar evidência que não existe.' },
  { key: 'task-fix', taskType: 'fix', name: 'Tarefa · Correção de defeito', description: 'Fluxo para reproduzir, diagnosticar, corrigir e validar defeitos.', prepare: 'Colete sintomas, comportamento esperado, passos de reprodução, ambiente e evidências disponíveis. Separe fatos de hipóteses e identifique o risco de regressão.', execute: 'Localize a causa antes de alterar o código. Faça a menor correção que resolva a causa e evite mudanças sem relação com o defeito.', validate: 'Confirme a reprodução antes/depois quando possível, cubra o cenário corrigido e revise regressões relacionadas. Registre o que não foi possível verificar.' },
  { key: 'task-chore', taskType: 'chore', name: 'Tarefa · Manutenção técnica', description: 'Fluxo para manutenção operacional, atualização de configuração e tarefas técnicas sem nova funcionalidade principal.', prepare: 'Identifique o motivo da manutenção, os componentes afetados, riscos operacionais e condições para concluir. Confirme se há janela, dependência ou reversão necessária.', execute: 'Faça mudanças pequenas e rastreáveis. Preserve configurações e dados existentes e não exponha credenciais ou valores de ambiente.', validate: 'Verifique o estado final, compatibilidade e instruções operacionais afetadas. Resuma riscos residuais e como desfazer a mudança se aplicável.' },
  { key: 'task-docs', taskType: 'docs', name: 'Tarefa · Documentação', description: 'Fluxo para documentação técnica, guias de uso, referências e runbooks.', prepare: 'Identifique leitores, objetivo, fonte de verdade e formato esperado. Reúna evidências no código e marque como pergunta qualquer informação não confirmada.', execute: 'Atualize somente os documentos ligados ao escopo. Use exemplos válidos e mantenha comandos, nomes e contratos alinhados à implementação.', validate: 'Revise links, comandos, exemplos e renderização Markdown. Aponte qualquer item que dependa de confirmação humana.' },
  { key: 'task-refactor', taskType: 'refactor', name: 'Tarefa · Refatoração', description: 'Fluxo para reorganizar código ou estrutura preservando comportamento e contratos.', prepare: 'Delimite a área da refatoração, comportamento público que deve permanecer igual e dependências que podem ser afetadas. Defina como detectar regressões.', execute: 'Faça mudanças incrementais e evite misturar refatoração com alteração funcional não solicitada. Preserve interfaces e dados existentes.', validate: 'Compare o comportamento relevante antes/depois e confira contratos, integrações e cenários de regressão que cabem no escopo.' },
  { key: 'task-test', taskType: 'test', name: 'Tarefa · Qualidade e testes', description: 'Fluxo para planejar cobertura, automatizar cenários e validar regressões.', prepare: 'Converta requisitos e critérios de aceite em cenários positivos, negativos e de limite. Escolha o nível de teste adequado ao contrato.', execute: 'Adicione ou ajuste verificações focadas e determinísticas. Não altere produção para fazer o teste passar sem uma justificativa ligada à tarefa.', validate: 'Execute as verificações autorizadas, registre resultados e lacunas de cobertura, e diferencie falha do código de limitações do ambiente.' },
  { key: 'task-perf', taskType: 'perf', name: 'Tarefa · Performance', description: 'Fluxo para medir gargalos, implementar otimizações e comparar resultados.', prepare: 'Defina a métrica, cenário e baseline disponíveis. Identifique a hipótese de gargalo e um resultado mensurável antes de alterar o sistema.', execute: 'Otimize somente o caminho medido, preserve correção e considere custo de memória, concorrência e complexidade operacional.', validate: 'Compare a métrica no mesmo cenário quando possível, confira correção e declare limites da medição. Não alegue ganho sem evidência.' },
  { key: 'task-build', taskType: 'build', name: 'Tarefa · Build e dependências', description: 'Fluxo para configuração de build, empacotamento e dependências.', prepare: 'Identifique o comando, ambiente, erro ou necessidade de build, arquivos de configuração e impacto em instalação/produção.', execute: 'Altere a configuração ou dependência mínima necessária. Preserve compatibilidade e não atualize pacotes sem relação com o objetivo.', validate: 'Confira a saída do comando e os artefatos esperados, ou descreva com precisão por que a validação não foi executada.' },
  { key: 'task-ci', taskType: 'ci', name: 'Tarefa · Integração contínua', description: 'Fluxo para pipelines, automações de CI e verificações de entrega.', prepare: 'Mapeie gatilhos, jobs, dependências, permissões e artefatos do pipeline. Trate segredos como dados que não devem aparecer em logs ou exemplos.', execute: 'Implemente a mudança no pipeline respeitando os eventos e permissões mínimos. Evite executar deploy ou publicar artefatos sem autorização específica.', validate: 'Revise a configuração e os jobs afetados, informe resultados disponíveis e indique qualquer validação que dependa do provedor externo.' },
  { key: 'task-revert', taskType: 'revert', name: 'Tarefa · Reversão segura', description: 'Fluxo para desfazer uma mudança com escopo e impacto controlados.', prepare: 'Identifique a mudança e os arquivos/efeitos que devem ser revertidos. Preserve alterações independentes e avalie migrações ou dados que não são revertidos pelo código.', execute: 'Reverta somente a mudança autorizada. Não resete o checkout nem descarte trabalho alheio à tarefa.', validate: 'Confira o diff para confirmar que apenas o escopo pretendido foi desfeito. Verifique compatibilidade e descreva efeitos que exijam ação separada.' },
  { key: 'scenario-refinement', name: 'Cenário · Refinamento de requisito', description: 'Fluxo transversal para esclarecer necessidade, regras de negócio, restrições e critérios de aceite.', prepare: 'Pergunte sobre objetivo, usuários, resultado esperado, limites e casos excepcionais ainda ausentes. Reaproveite o contexto já fornecido.', execute: 'Organize requisitos funcionais e não funcionais, dependências, itens fora de escopo e critérios verificáveis. Não transforme hipótese em decisão.', validate: 'Leia o resumo de volta ao solicitante e destaque dúvidas ou decisões pendentes antes de propor execução.' },
  { key: 'scenario-planning', name: 'Cenário · Planejamento técnico', description: 'Fluxo transversal para decompor uma entrega em etapas executáveis e critérios claros.', prepare: 'Confirme objetivo, restrições, estado atual, áreas envolvidas, dependências e riscos relevantes.', execute: 'Proponha uma sequência pequena de etapas com responsabilidades, contratos e evidências de conclusão. Mantenha separadas as tarefas de áreas diferentes.', validate: 'Verifique que a proposta cobre todos os critérios e explicita bloqueios, decisões pendentes e condições de início.' },
  { key: 'scenario-investigation', name: 'Cenário · Investigação técnica', description: 'Fluxo transversal para levantar evidências e diagnosticar um problema sem presumir sua causa.', prepare: 'Delimite o sintoma, quando ocorre, alcance, ambiente e evidências seguras disponíveis. Faça perguntas pontuais para preencher lacunas.', execute: 'Teste hipóteses com observações reversíveis e dentro do acesso autorizado. Separe fatos, hipótese e evidência.', validate: 'Entregue causa provável com evidências, alternativas descartadas e próximo passo recomendado. Não declare correção se nenhuma mudança foi validada.' },
  { key: 'scenario-architecture', name: 'Cenário · Decisão de arquitetura', description: 'Fluxo para comparar alternativas de arquitetura e registrar uma decisão técnica.', prepare: 'Esclareça requisitos de qualidade, carga, limites de sistema, restrições e decisões já tomadas.', execute: 'Compare alternativas em compatibilidade, custo operacional, segurança, evolução e complexidade. Registre uma decisão e consequências, incluindo riscos.', validate: 'Confirme que a decisão responde aos requisitos e identifique migração, implementação ou aprovação ainda necessárias.' },
  { key: 'scenario-cross-area', name: 'Cenário · Integração entre áreas', description: 'Fluxo para acordar contratos, dependências e coordenação entre duas ou mais áreas.', prepare: 'Identifique áreas participantes, responsável por cada entrega, contrato compartilhado e dependências na ordem correta.', execute: 'Documente interfaces, formatos, estados de erro, compatibilidade e plano de integração. Direcione perguntas à área dona do contrato.', validate: 'Confirme que cada área aceita seu limite, que as dependências estão registradas e que há uma forma objetiva de validar a integração.' },
  { key: 'scenario-code-review', name: 'Cenário · Revisão de código', description: 'Fluxo transversal para revisar uma mudança priorizando correção, regressões e riscos.', prepare: 'Confirme o objetivo do diff, critérios de aceite, área autorizada e comportamento que deve permanecer.', execute: 'Analise mudanças concretas, fluxos de erro, permissões, concorrência e compatibilidade. Ordene achados por impacto e cite arquivo/trecho quando disponível.', validate: 'Separe bloqueios de sugestões, confirme quais critérios estão evidenciados e não aprove comportamento que não foi verificado.' },
  { key: 'scenario-security', name: 'Cenário · Segurança e privacidade', description: 'Fluxo transversal para modelar ameaças e revisar controles de acesso e tratamento de dados.', prepare: 'Identifique ativos, atores, limites de confiança, dados pessoais/segredos e impacto potencial, sem copiar valores sensíveis para a conversa.', execute: 'Revise autenticação, autorização, validação, exposição, retenção e logs. Recomende controles proporcionais e limitados ao escopo.', validate: 'Relacione cada risco a uma evidência e mitigação; destaque riscos aceitos ou avaliações que exijam revisão humana especializada.' },
  { key: 'scenario-release', name: 'Cenário · Release e implantação', description: 'Fluxo para preparar checklist, monitoramento e reversão de uma release.', prepare: 'Confirme versão, ambiente, escopo da publicação, responsáveis, dependências e critérios de prontidão.', execute: 'Prepare checklist, sinais de saúde, comunicação e plano de rollback. Não publique nem altere ambientes externos sem autorização explícita.', validate: 'Confira critérios de prontidão e registre o resultado da publicação apenas se houver evidência observada.' },
  { key: 'scenario-incident', name: 'Cenário · Incidente de produção', description: 'Fluxo para organizar triagem, contenção, recuperação e aprendizado de incidente.', prepare: 'Colete impacto, início, serviços afetados, sinais observáveis e ações já tentadas. Priorize segurança e redução de impacto.', execute: 'Sugira passos de diagnóstico e contenção reversíveis. Ações em produção exigem autorização específica e respeitam os controles existentes.', validate: 'Registre timeline, causa confirmada/provável, recuperação e acompanhamento. Proponha ações preventivas sem atribuir culpa.' },
  { key: 'scenario-spike', name: 'Cenário · Spike e prova de conceito', description: 'Fluxo transversal para responder uma pergunta técnica em tempo e escopo limitados.', prepare: 'Defina a pergunta, timebox, critérios para aceitar/rejeitar a hipótese e itens explicitamente fora de escopo.', execute: 'Faça experimento isolado e reversível, distinguindo protótipo de implementação pronta para produção.', validate: 'Apresente evidências, conclusão, limitações e recomendação de próximo passo. Não deixe protótipo ser confundido com entrega final.' },
  { key: 'area-backend', name: 'Área · Backend: API e dados', description: 'Fluxo especializado opcional para contratos de API, persistência e integrações backend.', prepare: 'Confirme consumidores do contrato, autorização, validação, consistência, concorrência e compatibilidade com dados existentes.', execute: 'Priorize limites de serviço, transações necessárias, migração segura e respostas acionáveis. Não exponha segredos em logs ou retornos.', validate: 'Revise contrato, permissões, dados legados, idempotência e falhas parciais.' },
  { key: 'area-frontend', name: 'Área · Frontend: experiência e acessibilidade', description: 'Fluxo especializado opcional para interfaces, estados de tela, acessibilidade e integração frontend.', prepare: 'Identifique usuários, fluxo de interação, estados carregando/vazio/erro e contrato da API consumida.', execute: 'Implemente comportamento acessível e responsivo, reaproveitando componentes e padrões existentes. Preserve tratamento de erros e foco/teclado.', validate: 'Revise estados de tela, navegação por teclado, responsividade e consistência com o contrato backend.' },
  { key: 'area-qa', name: 'Área · QA: automação e regressão', description: 'Fluxo especializado opcional para estratégia de QA, automação e regressão.', prepare: 'Mapeie risco, cobertura atual, ambientes e combinações de entrada relevantes.', execute: 'Escolha testes repetíveis e com assertivas claras. Mantenha dados de teste isolados e não dependa de serviços externos sem preparação.', validate: 'Registre cenários executados, resultados e limitações; diferencie falha de produto de instabilidade ambiental.' },
  { key: 'area-devops', name: 'Área · DevOps/SRE: operação e observabilidade', description: 'Fluxo especializado opcional para infraestrutura, operação, pipelines e observabilidade.', prepare: 'Identifique ambiente, serviço, permissões, sinais de saúde, janela e reversão possível.', execute: 'Use menor privilégio, mudanças auditáveis e passos reversíveis. Não faça deploy ou mudança em infraestrutura sem autorização explícita.', validate: 'Confira monitoramento, alertas, capacidade de rollback, logs sem segredo e documentação operacional.' },
  { key: 'area-documentation', name: 'Área · Documentação: guias e runbooks', description: 'Fluxo especializado opcional para documentação de produto, operação, APIs e processos.', prepare: 'Identifique público, tarefa que o leitor quer realizar, fonte de verdade e formato de publicação.', execute: 'Escreva instruções completas e reproduzíveis, marcando pré-requisitos, resultados esperados e recuperação de erros.', validate: 'Revise exemplos, links, comandos e termos com a implementação atual; sinalize fatos que precisam de confirmação.' }
];

function stagesFor(template: ConversationTypeSeedTemplate): ConversationWorkflowStage[] {
  const stage = (key: string, title: string, description: string, instruction: string, required = false): ConversationWorkflowStage => ({
    id: deterministicUuid(`project-tasks-mcp:conversation-stage:${template.key}:${key}`),
    title, description, instruction, kind: 'instruction', required
  });
  return [
    stage('context', 'Contexto e escopo', 'Entender a tarefa e o limite de atuação.', `${scopeInstruction}\n\n${template.description}`),
    stage('plan', 'Plano', 'Definir a abordagem antes de agir.', template.prepare),
    { id: deterministicUuid(`project-tasks-mcp:conversation-stage:${template.key}:approval`), title: 'Autorização', description: 'Aguardar autorização humana explícita antes de executar mudanças.', kind: 'approval', required: true, approvalLabel: 'Autorizar execução' },
    stage('execute', 'Execução', 'Conduzir o trabalho dentro do escopo aprovado.', template.execute),
    stage('validate', 'Validação e resumo', 'Conferir critérios e comunicar o resultado.', template.validate)
  ];
}

export const conversationTypeSeedTemplates = definitions.map(template => ({
  ...template,
  stages: stagesFor(template)
}));

export const taskTypeConversationKeys: Record<string, string> = Object.fromEntries(
  definitions.filter(template => template.taskType).map(template => [template.taskType!, template.key])
);

export function defaultConversationType(projectId: string) {
  return {
    _id: DEFAULT_CONVERSATION_TYPE_ID, projectId, version: 0, archived: false, isDefault: true,
    name: 'Geral', description: 'Fluxo padrão para conversas existentes e conversas sem tipo especializado.',
    stages: [
      { id: '00000000-0000-4000-8000-000000000011', title: 'Esclarecer', description: 'Entender objetivo, restrições e dúvidas.', kind: 'instruction', required: false, instruction: 'Esclareça o pedido e reúna o contexto necessário.' },
      { id: '00000000-0000-4000-8000-000000000012', title: 'Proposta', description: 'Preparar uma proposta de trabalho.', kind: 'instruction', required: false, instruction: 'Apresente a proposta e os critérios para revisão.' },
      { id: '00000000-0000-4000-8000-000000000013', title: 'Autorização', description: 'Aguardar autorização humana antes de executar.', kind: 'approval', required: true, approvalLabel: 'Autorizar execução' },
      { id: '00000000-0000-4000-8000-000000000014', title: 'Execução', description: 'Acompanhar a execução autorizada.', kind: 'instruction', required: false, instruction: 'Execute somente após a autorização explícita.' }
    ],
    createdAt: null, updatedAt: null
  };
}

export function conversationTypeDto(item: any) {
  return {
    _id: item._id, projectId: item.projectId, name: item.name, description: item.description ?? '',
    version: item.version ?? 0, archived: item.archived ?? false, isDefault: item.isDefault ?? false,
    stages: item.stages ?? [], createdAt: item.createdAt ?? null, updatedAt: item.updatedAt ?? null
  };
}
