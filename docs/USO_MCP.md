# Uso do MCP

Depois de instalar globalmente o MCP, inicie o chat dizendo qual projeto e feature devem ser usados. O protocolo MCP não fornece ao servidor o ID da conversa; por isso, o agente deve resolver o projeto e enviar o `projectId` explicitamente em cada ferramenta.

Para instruções operacionais completas de uma IA, consulte o [GUIA_AGENTE_MCP.md](GUIA_AGENTE_MCP.md).

Fluxo recomendado:

1. `list_records` encontra o projeto FBI ou `create_project` o cria.
2. `create_feature` cadastra PCP — Outros Processos.
3. `create_task` cria a tarefa de back no `fbi_back`.
4. `create_task` cria a tarefa de front no repositório front, dependente da tarefa de back.
5. O agente chama `get_task_context`, assume com `claim_task`, registra progresso e envia `submit_task`.
6. A pessoa aprova pela CLI. A tarefa front passa a poder ser assumida.

Use UUID novo em cada `operationId`. Use a `version` devolvida pelo MCP na próxima atualização. Consulte [CONFIGURACAO_GLOBAL_MCP.md](CONFIGURACAO_GLOBAL_MCP.md) para instalar no perfil da IA.

## Cooperação entre back e front

Quando as tarefas pertencem à mesma feature ou têm dependência direta, o agente que possui uma execução ativa pode chamar `subscribe_task_events` e receber notificações MCP na sessão HTTP stateful. Use `send_task_message` com `type` `contrato`, `pergunta`, `resposta`, `bloqueio` ou `progresso`; informe `relatedTaskId` para endereçar a tarefa parceira.

As mensagens são persistidas no MongoDB e aparecem em `get_task_context`. Se a sessão cair, continue pelo cursor retornado em `list_task_messages` ou aguarde com `wait_task_events` informando `after`. Apenas execuções ativas enviam mensagens; expiração bloqueia novos envios. Mensagens não mudam o estado da tarefa e a aprovação continua sendo feita pela CLI humana.

## Planejamento Markdown

Tasks podem ter `type`: `feature`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci` ou `revert`; `featureId` é opcional. Registros anteriores sem tipo são apresentados como `feature`.

Use `save_markdown` para gravar um documento `.md` de até 100 KiB no alvo `feature` ou `task`. Na criação envie `targetKind`, `targetId`, `name`, `summary` e `content`. Para atualizar, envie também o `id` e a `version` retornada. Cada alteração cria uma revisão imutável; conteúdo idêntico não cria revisão.

Outra máquina encontra planos com `list_markdowns`, consulta o histórico com `list_markdown_revisions` e lê somente o trecho necessário via `get_markdown` (`line` e `limit`). Listagens, eventos e `get_task_context` trazem apenas metadados e cursores, nunca o conteúdo do Markdown. As mesmas leituras estão disponíveis em `/admin/query` para o futuro frontend autenticado.

## Resumo do projeto por área

Use `get_project_area_summary` com `projectId` para obter Markdown atualizado, separado em `Backend`, `Frontend` e `Outro`. Cada área mostra as tasks concluídas, pendentes e nos demais estados, incluindo status e tipo. Opcionalmente informe `featureId` para resumir somente uma feature. A ferramenta é somente leitura: ela não grava documento nem cria uma cópia que possa ficar desatualizada.
