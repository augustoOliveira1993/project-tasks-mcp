# Project Tasks MCP

Servidor MCP para coordenar projetos, features e tarefas entre equipes. Mantém dependências, execução, progresso, mensagens e revisão humana em MongoDB; expõe a API Streamable HTTP em `POST /mcp`.

O serviço não executa agentes nem acessa repositórios de trabalho.

Opcionalmente, `yarn bridge` inicia uma bridge MCP stdio local. Ela lê somente o Git do checkout atual, resolve um repositório previamente vinculado e publica diffs; o MCP HTTP continua sendo a API canônica.

## Executar localmente

```powershell
yarn install --frozen-lockfile
yarn dev
```

`yarn dev` inicia o MongoDB local na porta `27018` e o MCP no mesmo terminal. Alterações em `src/` reiniciam o MCP via nodemon; ao encerrar o comando, o MongoDB iniciado por ele também é encerrado.

Para executar os processos separadamente, use `yarn mongo:local` e `yarn start` em terminais distintos.

Verifique o serviço em `http://localhost:3443/health`.

## Produção

```powershell
yarn install --frozen-lockfile --production=false
yarn build
yarn start:prod
```

`yarn build` gera os arquivos JavaScript em `dist/`; `yarn start:prod` executa essa saída compilada. Ajuste `env.config.ts` ou defina variáveis no ambiente de produção; valores do ambiente e de `.env` têm precedência sobre `env.config.ts`. A inicialização informa os valores obrigatórios ausentes antes de abrir o servidor. Use `LOG_LEVEL` em `env.config.ts`, `.env` ou no ambiente para controlar os logs Winston do terminal.

Para criar o primeiro administrador:

```powershell
yarn cli -- bootstrap <usuario>
```

O bootstrap é único por banco. Guarde o token humano retornado; ele é usado pela CLI para aprovar, cancelar, desbloquear tarefas e administrar membros.

## Instalar nas IAs

A configuração é global: instale o MCP uma vez no perfil de Codex ou Claude Code. Não crie `.mcp.json` em repositórios de trabalho.

Consulte o guia de [configuração global](docs/CONFIGURACAO_GLOBAL_MCP.md) para as instruções completas.

## Documentação

| Assunto | Documento |
| --- | --- |
| Instalação passo a passo: Windows, Ubuntu, clientes e executores | [Guia de instalação](docs/INSTALACAO_PASSO_A_PASSO.md) |
| Fluxo de projetos, tarefas, dependências e revisão | [Uso do MCP](docs/USO_MCP.md) |
| Configuração global no Codex e Claude Code | [Configuração global](docs/CONFIGURACAO_GLOBAL_MCP.md) |
| Operação do servidor na rede privada | [Rede interna](docs/REDE_INTERNA.md) |
| Cadastro e execução de tarefas de backend | [Tarefas de backend](docs/TAREFAS_BACKEND.md) |
| Cadastro e execução de tarefas de frontend | [Tarefas de frontend](docs/TAREFAS_FRONTEND.md) |
| Chamadas HTTP administrativas | [Collection Postman](postman/project-tasks-mcp.postman_collection.json) |
| Colaboração Git, diffs e contexto automático | [Uso do MCP](docs/USO_MCP.md) |
| Runner e plano de colaboração autônoma entre IAs | [Loop autônomo de IA](docs/LOOP_AUTONOMO_IA.md) |

## Validação

```powershell
yarn test:flow
```

## Segurança

`MCP_AUTH_MODE=trusted_local` aceita a identidade enviada em `X-Project-Tasks-Email`. Use esse modo somente em rede privada controlada e não exponha o serviço à internet.

A revisão humana continua exigindo `ADMIN_TOKEN` na CLI. Logs registram metadados operacionais — sem tokens ou conteúdo de mensagens.
