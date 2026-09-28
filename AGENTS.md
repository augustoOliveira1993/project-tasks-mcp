# Uso do project-tasks-mcp por agentes

O MCP é global na IA. Não crie `.mcp.json`, `.codex/config.toml` ou configuração MCP dentro de repositórios de trabalho.

- Em `trusted_local`, cada cliente envia `X-Project-Tasks-Email`; esse e-mail é o autor de execuções e eventos.
- Antes de mudar código, chame `get_task_context` para a tarefa escolhida.
- Cada mutação usa UUID novo em `operationId`; repetições usam o mesmo UUID e argumentos idênticos.
- Use a `version` retornada a cada atualização.
- O estado dos critérios é separado do texto: escrever “ATENDIDO” ou adicionar emoji no critério não marca o progresso. Leia `acceptance` e `acceptanceProgress` em `get_task_context`; assim que houver evidência objetiva para um item, chame `set_acceptance_criterion` para aquele índice zero-based, sem esperar o fim da tarefa. Passe `complete: true`, evidência concisa, `executionId`, versão atual e UUID novo em `operationId`; use a versão retornada na próxima mutação. Deixe sem comprovação desmarcado e volte para `complete: false` se evidência posterior invalidar o atendimento. Se `set_acceptance_criterion` não estiver disponível na lista de ferramentas MCP conectadas, informe o bloqueio e não afirme que o contador foi atualizado; o cliente precisa carregar a versão do servidor que registra essa ferramenta.
- Back e front são tarefas separadas, cada uma no respectivo `repositoryId`; o front depende do back aprovado.
- Envie `heartbeat_task` e `record_progress` durante o trabalho. Ao terminar, use `submit_task` com resumo, arquivos, verificações e evidências.
- A IA pode revisar e alterar status de tarefas pelo MCP, sem depender da CLI humana: em `em_revisao`, use `set_task_status` para `concluida` quando o diff e as evidências confirmarem todos os critérios; use `pendente` quando forem necessários ajustes, descrevendo as lacunas no motivo; e use `cancelada` quando isso for solicitado ou claramente necessário. Também pode retornar tarefas `bloqueada` para `pendente` quando o MCP permitir a transição. Sempre use a versão atual, motivo explícito e UUID novo em `operationId`; respeite as transições aceitas pela ferramenta. Use `claim_task`, `block_task` e `submit_task` para as transições normais de execução. Operações administrativas fora das ferramentas MCP disponíveis continuam seguindo seus controles próprios.
- Não envie segredos, conversas completas ou raciocínio interno ao MCP.

Endpoint interno: `http://AVB-NB-00295:3443/mcp`. O modo `trusted_local` confia na rede privada; qualquer pessoa capaz de enviar o cabeçalho pode assumir o e-mail informado.
