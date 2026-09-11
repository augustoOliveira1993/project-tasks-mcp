# Uso do MCP

Depois de instalar globalmente o MCP, inicie o chat dizendo qual projeto e feature devem ser usados. O protocolo MCP não fornece ao servidor o ID da conversa; por isso, o agente deve resolver o projeto e enviar o `projectId` explicitamente em cada ferramenta.

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