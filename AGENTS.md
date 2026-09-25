# Uso do project-tasks-mcp por agentes

O MCP é global na IA. Não crie `.mcp.json`, `.codex/config.toml` ou configuração MCP dentro de repositórios de trabalho.

- Em `trusted_local`, cada cliente envia `X-Project-Tasks-Email`; esse e-mail é o autor de execuções e eventos.
- Antes de mudar código, chame `get_task_context` para a tarefa escolhida.
- Cada mutação usa UUID novo em `operationId`; repetições usam o mesmo UUID e argumentos idênticos.
- Use a `version` retornada a cada atualização.
- Back e front são tarefas separadas, cada uma no respectivo `repositoryId`; o front depende do back aprovado.
- Envie `heartbeat_task` e `record_progress` durante o trabalho. Ao terminar, use `submit_task` com resumo, arquivos, verificações e evidências.
- A IA pode aprovar automaticamente uma tarefa em `em_revisao` quando revisar o diff e confirmar todos os critérios de aceite com evidências. Use `set_task_status` para `concluida`, com a versão atual, motivo explícito e UUID novo em `operationId`; nunca aprove com versão desatualizada ou sem evidência. Desbloqueio, solicitação de ajustes e cancelamento continuam restritos à CLI humana.
- Não envie segredos, conversas completas ou raciocínio interno ao MCP.

Endpoint interno: `http://AVB-NB-00295:3443/mcp`. O modo `trusted_local` confia na rede privada; qualquer pessoa capaz de enviar o cabeçalho pode assumir o e-mail informado.
