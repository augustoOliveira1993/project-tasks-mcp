# Uso do MCP

Depois de instalar o MCP globalmente, use a skill `project-tasks-mcp` ou o prompt `iniciar_trabalho` quando o cliente oferecer esses recursos. Ao começar, leia `get_session_context`; se não houver projeto e o usuário não tiver indicado um, resolva-o pelo workspace com `resolve_project_context`. Só peça esclarecimento para projeto ambíguo/ausente ou quando a área necessária não puder ser inferida. O protocolo MCP não fornece ao servidor o ID da conversa do cliente; por isso, operações HTTP devem receber o `projectId` explicitamente quando a sessão não o injeta.

Para instruções operacionais completas de uma IA, consulte o [GUIA_AGENTE_MCP.md](GUIA_AGENTE_MCP.md).

## Listar projetos com resumo de tarefas

`GET /admin/projects/summary` retorna os projetos ativos aos quais a credencial humana tem acesso. Cada item inclui campos básicos do projeto, a `version` atual e `taskSummary`, com contagens por status e tipo, além de tarefas bloqueadas, restantes e concluídas. A resposta não inclui hashes de acesso.

Use `limit` (1 a 100, padrão 25) e `after` (UUID do cursor `next` anterior) para paginar. Envie a credencial no cabeçalho `Authorization: Bearer <token-humano>`. A resposta tem este formato: `{"items":[{"project":{"_id":"...","version":3,"name":"...","description":"...","visibility":"public","repositories":[],"createdAt":"...","updatedAt":"..."},"taskSummary":{"counts":{},"typeCounts":{},"blocked":0,"remaining":0,"completed":false}}],"next":null}`. O painel deve carregar essa versão do próprio retorno e enviá-la em ações administrativas que alteram o projeto, como `bind_repository_git`; a pessoa não precisa digitar nem descobrir `version`. Isso é separado de `task.version`, usada em mutações de uma tarefa.

## Colaboração Git opcional

`yarn bridge` expõe uma bridge MCP stdio para o checkout aberto. Configure `PTM_SERVICE_URL` e `PTM_BRIDGE_TOKEN` (credencial bearer de agente) e chame `status`. A bridge lê automaticamente o checkout Git atual (URL remota, commit raiz, branch e commit) e compara a URL remota canônica e o commit raiz com o vínculo Git registrado pelo administrador; esse vínculo resolve escopo, mas não concede acesso.

Um administrador humano registra o vínculo com `action: "bind_repository_git"`, `repositoryId`, `canonicalRemoteUrl` e `rootCommit`. Com um único vínculo compatível, `publish_task_diff` calcula arquivos e commits localmente e chama o servidor para gravar a evidência. O patch é opt-in (`includePatch: true`) e limitado a 100 KiB.

No painel administrativo (`/admin`), após selecionar um projeto, use **Vínculo Git** para escolher o repositório cadastrado e confirmar sua URL remota canônica e commit raiz. O painel obtém `project.version` automaticamente e a envia ao salvar; não copie essa versão manualmente. Depois chame `status` no Codex ou Claude Code.

`status` com `ready: true` significa que o checkout corresponde a exatamente um vínculo. `ready: false` com `missing` indicando vínculo ausente ou ambíguo significa que a bridge iniciou, mas ainda não conseguiu resolver o repositório para um projeto; peça a uma pessoa administradora para revisar **Vínculo Git** no projeto correto. Isso não significa, por si só, que a conexão MCP do Codex/Claude falhou. O vínculo não concede acesso ao projeto.

Use **Novidades** para consultar eventos recentes. Os detalhes de cada tarefa também incluem os metadados dos diffs publicados; patches não são renderizados por padrão.

Use `get_project_novelties` para obter eventos de outros participantes após o cursor de leitura e `mark_project_read` para avançar esse cursor. Eventos mantêm `action` e `data`, mas também incluem `kind`, `summary`, `actor` e dados Git quando disponíveis.

Fluxo recomendado para uma solicitação de trabalho:

1. Se o pedido referenciar uma task por UUID/prefixo curto sem indicar projeto, use `resolve_task_context` para assumir o projeto e a área da task; depois confira `get_session_context` e carregue `get_task_context`. Se a referência for ambígua, peça o UUID completo; se não for encontrada, não substitua pelo projeto do workspace. Projeto indicado explicitamente tem precedência. Sem referência a task, resolva o projeto e a área normalmente. Use `list_records` para procurar tasks, features ou projetos existentes; use `list_pending` apenas para tasks pendentes executáveis e resumos para visão geral. Não crie registros duplicados.
2. Para a task que corresponde claramente ao pedido, leia `get_task_context` e confira status, dependências, instruções, `acceptance` e `acceptanceProgress` antes de alterar estado ou arquivos. Se não houver correspondência clara, apresente o que encontrou e peça direção.
3. Assuma uma task executável com `claim_task`; registre marcos com `record_progress`, mantenha o lease com `heartbeat_task` e marque cada critério com evidência objetiva em `set_acceptance_criterion` assim que for comprovado.
4. Se outra task precisar coordenar contratos ou dependências, use as ferramentas de colaboração adequadas e inclua o ID relacionado. Não use o chat compartilhado como se ele despertasse outro agente.
5. Ao concluir, use `submit_task` com resumo, arquivos alterados, verificações e evidências. Para uma task em revisão, o agente revisor pode aprovar com `set_task_status` somente depois de conferir o diff e todos os critérios; caso contrário, devolve a task com lacunas específicas.

Em cada mutação use UUID novo em `operationId` e a `version` mais recente retornada; reutilize o mesmo UUID e argumentos somente ao repetir exatamente a mesma operação após falha. Dependências entre back e front devem estar registradas e satisfeitas antes de assumir a task dependente. A aprovação de mudanças administrativas continua no fluxo humano. Consulte [CONFIGURACAO_GLOBAL_MCP.md](CONFIGURACAO_GLOBAL_MCP.md) para instalar no perfil da IA.

## Cooperação entre back e front

Quando as tarefas pertencem à mesma feature ou têm dependência direta, use `subscribe_task_events` para acompanhar eventos na sessão HTTP stateful. `send_task_message` registra comunicação operacional da execução ativa; `send_collaboration_message` trata colaboração entre tasks, sujeita às regras de acesso e execução. Informe `relatedTaskId` para endereçar a tarefa parceira. Para o chat compartilhado, use `send_conversation_message`; isso persiste a mensagem, mas não desperta automaticamente uma sessão Codex/Claude. O servidor registra o autor autenticado e o nome do cliente MCP anunciado no initialize, que a interface usa para identificar a IA e mostrar o ícone. Envie somente o conteúdo, sem simular outra autoria ou adicionar prefixo manual. Uma pergunta ligada a outra task pode iniciar uma consulta somente quando as validações do servidor e uma automação previamente autorizada permitirem.

As mensagens de task são persistidas no MongoDB e aparecem em `get_task_context`. Se a sessão cair, continue pelo cursor retornado em `list_task_messages` ou aguarde com `wait_task_events` informando `after`. `send_task_message` exige execução ativa; expiração bloqueia novos envios. Mensagens não mudam o estado da task. Agentes podem revisar tarefas em `em_revisao` e aprovar, devolver para `pendente` ou cancelar usando `set_task_status`, respeitando os critérios e as transições válidas.

## Planejamento Markdown

Tasks podem ter `type`: `feature`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci` ou `revert`; `featureId` é opcional. Registros anteriores sem tipo são apresentados como `feature`.

Use `save_markdown` para gravar um documento `.md` de até 100 KiB no alvo `feature` ou `task`. Na criação envie `targetKind`, `targetId`, `name`, `summary` e `content`. Para atualizar, envie também o `id` e a `version` retornada. Cada alteração cria uma revisão imutável; conteúdo idêntico não cria revisão.

Outra máquina encontra planos com `list_markdowns`, consulta o histórico com `list_markdown_revisions` e lê somente o trecho necessário via `get_markdown` (`line` e `limit`). Listagens, eventos e `get_task_context` trazem apenas metadados e cursores, nunca o conteúdo do Markdown. As mesmas leituras estão disponíveis em `/admin/query` para o futuro frontend autenticado.

Para atualização sem sobrescrita concorrente, use `update_markdown` com `documentId`, `baseRevision`, `summary` e `content`. Em conflito, leia a revisão atual e resolva o conteúdo antes de tentar novamente. `save_markdown` permanece para criação e clientes legados.

## Resumo do projeto por área

Use `get_project_area_summary` com `projectId` para obter Markdown atualizado, separado em `Backend`, `Frontend` e `Outro`. Cada área mostra as tasks concluídas, pendentes e nos demais estados, incluindo status e tipo. Opcionalmente informe `featureId` para resumir somente uma feature. A ferramenta é somente leitura: ela não grava documento nem cria uma cópia que possa ficar desatualizada.
