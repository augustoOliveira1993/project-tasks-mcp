# Executores supervisionados (0.2)

Automacao e aditiva e desabilitada por padrao. O fluxo manual, as ferramentas existentes, o historico e a revisao humana continuam disponiveis. Nao exponha a porta MongoDB aos executores.

## Servidor e transporte

Use o replica set MongoDB existente. `connect` cria as novas colecoes e indices; nao ha reescrita de historico. Cada instancia HTTP abre um Change Stream compartilhado sobre DeliveryEvent. O registro transacional e o cursor por projeto recuperam lacunas; notificacoes sao apenas avisos. Entrega e pelo menos uma vez. Consumidores deduplicam pelo `_id`.

Para HTTPS nativo, defina `TLS_CERT_PATH`, `TLS_KEY_PATH` e `SERVICE_URL=https://host:porta`. Alternativamente termine TLS no proxy e restrinja o HTTP interno ao proxy. Configure a CA corporativa com `NODE_EXTRA_CA_CERTS` nos clientes; nunca desabilite validacao de certificados. Executores recusam HTTP fora de loopback. `trusted_local` continua aceito no MCP manual; `/runner` sempre exige bearer de agente.

Duas instancias HTTP precisam de afinidade por `Mcp-Session-Id`. Se uma cair, reinicialize a sessao e reinscreva com o cursor duravel. Nao misture instancias 0.1 e 0.2 durante ativacao: instancias antigas nao geram o novo feed. Atualize os escritores antes de liberar automacao.

## Configuracao local

Instale dependencias com `yarn install --frozen-lockfile`. Use Codex CLI e Claude Code autenticados no perfil de cada operador. O SDK Claude esta fixado no lockfile. O servidor nunca recebe credenciais dos provedores.

Crie um JSON fora dos repositorios de trabalho, substituindo os UUIDs e caminhos:

```json
{
  "serviceUrl": "https://mcp.interno:3443",
  "machineId": "11111111-1111-4111-8111-111111111111",
  "projects": ["22222222-2222-4222-8222-222222222222"],
  "providers": ["codex", "claude"],
  "repositories": {"33333333-3333-4333-8333-333333333333": "C:/dev/projeto"},
  "worktreeRoot": "C:/Users/operador/.project-tasks-runner/worktrees",
  "maxConcurrent": 2
}
```

`codexBinary`, `claudeBinary` e `models` sao opcionais; por padrao usam os clientes instalados e seus modelos padrao. O checkout parte do HEAD confirmado do repositorio registrado, sem incorporar alteracoes locais. Um worktree e uma branch `codex/task-...` sao mantidos por trabalho. Nao ha limpeza automatica de evidencias.

Defina `RUNNER_TOKEN` com uma credencial bearer `agent` individual, emitida pela CLI humana. Nao inclua tokens no JSON ou em comandos salvos. Execute `yarn runner C:/caminho/config.json`.

Para instalar o launcher global: `powershell -File scripts/install-project-tasks-runner.ps1 -ConfigPath C:/caminho/config.json`. `-AutoStart` registra inicio oculto no logon do usuario; nao inicia trabalho antes de configuracao e liberacao. O launcher referencia esta instalacao; mantenha o repositorio e dependencias disponiveis. O lock por machineId impede dois processos locais da mesma configuracao.

## Liberacao e supervisao humanas

Use `yarn cli apply arquivo.json` com `ADMIN_TOKEN` humano. Cada mutacao recebe um UUID novo em `operationId`; retry identico reaproveita o UUID e todo o payload. Use a versao retornada.

- `automation_policy`: `projectId`, `version` (0 inicialmente), `enabled`, `maxConcurrent` (10 por padrao), `routes: [{repositoryId, area, provider}]`.
- `automation_release`: `projectId`, `taskId`, `version` atual da task, `provider` opcional. Sem rota nem sobrescrita nao ha liberacao. As dependencias devem estar aprovadas para iniciar escrita.
- `automation_resolve`: `projectId`, `jobId`, `version` atual do job, `decision: allow|deny`, `reason`. A decisao vale para a solicitacao de permissao pendente, nao para aprovar a task.
- `yarn cli automation PROJECT_ID`: politica, fila, sessoes, consumo, erros, pedidos humanos e executores. Ha paginacao via `get_automation_status`/`query`.

Edicao de escopo e solicitacao de ajustes invalidam liberacoes. Uma execucao expirada exige desbloqueio e nova liberacao humanos. Aprovacao e cancelamento das tasks continuam usando `review`. Agentes nao podem chamar operacoes administrativas.

Perguntas dirigidas podem criar consultas somente leitura para tasks ja liberadas, mesmo com dependencia pendente. Consultas nao adquirem lease de escrita nem desbloqueiam a task. Respostas, recibos e progresso nao iniciam novas consultas. Limites iniciais: dez turnos e trinta minutos por cadeia, duas execucoes por maquina e dez por projeto. O limite de turnos do SDK Claude tambem protege o loop interno. Consumo desconhecido fica `null`; os incrementos reportados por turno sao acumulados por job, incluindo tokens de cache quando informados, sem estimar dinheiro. Se a retomada Codex nao informar uma base de uso, o incremento daquele turno fica desconhecido.

## Contratos de eventos

- `subscribe_project_events({projectId, taskIds?, actions?, cursor?})`: sem cursor devolve marco atual; com cursor recupera backlog. Inicie a inscricao antes de ler o snapshot da task para evitar lacunas.
- `wait_project_events({...filtros, cursor, timeoutMs?, limit?})`: `items`, `cursor`, `hasMore`. Use o cursor mesmo em pagina vazia/incompleta. Nao altere filtros ao reaproveitar cursor.
- `unsubscribe_project_events({...filtros})`: remove avisos da sessao. Cursor duravel permanece utilizavel.
- `wait_task_events`: `after` continua cursor de mensagens; `eventAfter` e cursor independente do feed. Retorna `messageCursor` e `eventCursor`, preservando `items/events/next` legados. Sem `eventAfter`, a primeira leitura de eventos continua sendo snapshot do historico.
- `send_collaboration_message`: `operationId`, `projectId`, `taskId`, `relatedTaskId?`, `type`, `message`, `references?`, `conversationId?`, `replyTo?`, `correlationId?`. Exige participacao na task. Nao concede escrita. Os campos de conversa tambem sao opcionais em `send_task_message`.

O executor usa um MCP local com token efemero restrito ao job. Identidade, task, versao e executionId sao fornecidos pelo processo supervisor. Chamadas de heartbeat e ferramentas passam por fila serial por execucao. Os provedores nao recebem o bearer do servidor.

## Recuperacao e rollback

Reserve, registre checkout/sessao e confirme cada turno. Uma queda no meio de um turno deixa resultado incerto: bloquear e revisar a sessao e os arquivos antes de nova liberacao. Nunca repetir automaticamente publicacoes ou comandos externos. Retomada segura exige mesma maquina, checkout, sessao e reserva ainda ativa. O lease do executor e 90 segundos, renovado a cada 20 segundos; o lease da task permanece com a configuracao existente.

Para rollback, desabilite `automation_policy`, aguarde interrupcao supervisionada e pare os launchers/tarefa agendada. Preserve colecoes, worktrees e evidencias. O uso manual permanece disponivel. Nao remova os dados novos nem volte a liberar tasks com escritores antigos conectados.

## Verificacao focada

- `yarn test:realtime`: regras do feed/fila, seguranca e fluxo com adaptadores simulados.
- `CODEX_BIN` habilita probe do protocolo Codex sem geracao no teste do executor.
- `PTM_REAL_CLIENTS=1`, `CODEX_BIN` e `CLAUDE_BIN` habilitam prova real, com consumo dos provedores, apenas em repositorio e banco temporarios.
- `PTM_LOAD_TEST=1` habilita benchmark de 50 clientes HTTP; registrar hardware, versoes e percentil 95 antes de usar a meta como capacidade de producao.

Nao ha aprovacao automatica de tasks, merge, deploy ou painel web novo. Builds e suites globais nao fazem parte do launcher.

### Evidencias locais — 2026-09-12

- Os 11 cenarios existentes de fluxo passaram, incluindo concorrencia, idempotencia, documentos e revisao humana.
- A prova real executou Codex -> contrato `fixture-v1` -> aprovacao pelo canal humano -> Claude. As duas tasks foram submetidas para revisao em worktrees separados, usando apenas um repositorio e banco temporarios. A autenticacao usada foi ChatGPT no Codex e claude.ai no Claude; nao foram criadas chaves de API.
- Clientes observados: Codex CLI `0.154.0-alpha.6.2`, Claude Code `2.1.267`, Node `24.13.1`. O SDK Claude desta entrega e `0.3.269`.
- Na prova real, o Claude reportou US$ 0,0809956; o Codex nao informou custo monetario. O teste imprime os dados de uso retornados pelos provedores, sem inferir cobranca da assinatura.
- Benchmark separado: 50 clientes MCP HTTP simultaneos, p95 de 632 ms e maximo de 633 ms da publicacao transacional ao recebimento. Ambiente: Windows, Intel Core Ultra 7 155H (22 processadores logicos), aproximadamente 15,5 GiB RAM e replica set de teste local. Nao e um SLA de producao nem medicao de latencia dos modelos.
- O teste de capacidade confirmou dez reservas em cinco executores e rejeicao da decima primeira. A prova com provedores validou contexto, leitura e cooperacao; nao executou build, deploy ou uma carga de dez modelos reais.
- O sandbox de comandos do Codex nesta maquina apresentou erro de ACL na primeira tentativa. A leitura confinada `read_repository_file` foi validada, incluindo rejeicao de caminhos externos e links. Execucao de comandos reais requer um sandbox Windows funcional; o executor nao desabilita essa protecao.
