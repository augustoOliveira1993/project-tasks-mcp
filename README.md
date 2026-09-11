# project-tasks-mcp

Serviço independente Node.js, TypeScript e MongoDB para projetos, features, tarefas, dependências, execuções e revisão humana. Expõe Streamable HTTP em `POST /mcp` e não executa agentes nem acessa repositórios.

## Servidor local

```powershell
yarn install --frozen-lockfile
yarn mongo:local
# em outro terminal
yarn start
```

Acesse `http://localhost:3443/health` para verificar o serviço.

No `.env`, `MCP_AUTH_MODE=trusted_local` permite que o MCP aceite o cabeçalho `X-Project-Tasks-Email`, sem token de agente. A CLI administrativa continua usando `ADMIN_TOKEN` para aprovar, cancelar, desbloquear e administrar membros.

```powershell
yarn cli -- bootstrap augusto
```

Bootstrap é único por banco. Guarde o token humano retornado.

## Instalação nas IAs

Instale o MCP uma vez no perfil global de Codex ou Claude Code. Não use `.mcp.json` nos repositórios. Consulte [configuração global](docs/CONFIGURACAO_GLOBAL_MCP.md).

## FBI — PCP

O fluxo de back, front e aprovação do módulo PCP — Outros Processos está em [docs/FBI_PCP_OUTROS_PROCESSOS.md](docs/FBI_PCP_OUTROS_PROCESSOS.md). O fluxo geral de ferramentas está em [docs/USO_MCP.md](docs/USO_MCP.md). A cooperação persistente usa `send_task_message`, `list_task_messages`, `wait_task_events` e `subscribe_task_events`.

## Validação focada

```powershell
yarn test:flow
```

O modo `trusted_local` confia na rede privada e no e-mail enviado pelo cliente. Não exponha o MCP à internet.


A collection Postman atualizada está em [postman/project-tasks-mcp.postman_collection.json](postman/project-tasks-mcp.postman_collection.json). Execute Initialize primeiro; a sessão MCP é salva automaticamente em mcpSessionId.

Os logs exibem eventos http_request, mcp_tool e dmin_action. O evento mcp_tool registra 	ool, ctor, projectId, 	askId, outcome e duração; tokens e conteúdo das mensagens não são registrados.# project-tasks-mcp
