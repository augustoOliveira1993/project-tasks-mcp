# Configuração global do MCP

Configure uma vez no perfil de cada IA. Nenhum repositório recebe `.mcp.json`.

Para instalar o servidor no Windows ou Ubuntu, configurar clientes com bearer/HTTPS e executores opcionais, siga o [guia passo a passo de instalação](INSTALACAO_PASSO_A_PASSO.md). As instruções abaixo descrevem a conexão privada existente com `trusted_local`.

## Servidor

No `.env` de `project-tasks-mcp`:

```dotenv
MCP_AUTH_MODE=trusted_local
```

Reinicie `yarn start` depois de alterar esse valor. Para voltar ao modelo anterior com Bearer token, use `MCP_AUTH_MODE=bearer` e reinicie.

## Codex

No Linux, em `~/.codex/config.toml` (no Windows, em `C:\Users\<usuario>\.codex\config.toml`):

```toml
[mcp_servers.project_tasks]
url = "http://AVB-NB-00295:3443/mcp"
http_headers = { "X-Project-Tasks-Email" = "pessoa@empresa.com" }
startup_timeout_sec = 20
```

Reinicie Codex. Essa configuração é global para Codex CLI, IDE e aplicativo desktop.

## Claude Code

Em Ubuntu/Linux, para configurar Codex, Claude Code ou ambos sem clonar o repositório do MCP, use o instalador independente `scripts/install-project-tasks-mcp.sh`. Ele pede URL, e-mail e clientes; cria backup antes de alterar o TOML do Codex e substitui a entrada `project_tasks` do Claude no escopo do usuário. Requer Bash e Python 3; para Claude, também requer o comando `claude` instalado. Execute com `bash scripts/install-project-tasks-mcp.sh`. Para baixar somente o script de uma versão já publicada no GitHub:

```bash
curl -fsSLo install-project-tasks-mcp.sh https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/scripts/install-project-tasks-mcp.sh
bash ./install-project-tasks-mcp.sh
```

Não é necessário clonar o projeto nem instalar suas dependências.

Este script configura apenas o MCP remoto HTTP. Não instala o servidor, não clona o MCP e não instala a bridge Git. A bridge é opcional e precisa executar localmente no checkout que será identificado.

O instalador substitui uma entrada de usuário existente. Se preferir configurar manualmente, os comandos são:

```bash
claude mcp remove project_tasks --scope user 2>/dev/null || true
claude mcp add --transport http --scope user project_tasks "http://AVB-NB-00295:3443/mcp" --header "X-Project-Tasks-Email: pessoa@empresa.com"
```

Confirme e abra o chat:

```powershell
claude mcp get project_tasks
claude
```

No chat, use `/mcp` e então peça: `Use project_tasks no projeto FBI, feature PCP — Outros Processos.`

## Identidade e revisão

O e-mail é registrado em eventos e execuções sem token de agente. A aprovação humana ainda exige `ADMIN_TOKEN` pela CLI. Não use `trusted_local` fora de uma rede privada controlada.

## Bridge Git opcional

No Windows, emita uma credencial `agent` individual no servidor para cada máquina e execute `scripts/install-project-tasks-mcp.ps1`. O instalador configura a bridge opcional globalmente para Codex e/ou Claude Code, recebe o token de forma oculta e o protege com DPAPI em `%LOCALAPPDATA%\ProjectTasks\bridge-token.dpapi`. Claude Code e Codex podem compartilhar o token na mesma máquina; em outra, emita outro token. Em nova execução, o instalador oferece reutilizar o token protegido local. Nunca coloque o token em arquivos do repositório ou no `config.toml`.

A bridge recebe `PTM_SERVICE_URL` e o launcher local recupera o token protegido apenas no processo. Abra o chat no checkout esperado e chame `status` primeiro. No Claude Code, a bridge lê `CLAUDE_PROJECT_DIR`; no Codex desta instalação, o `cwd` global aponta para o checkout `project-tasks-mcp`. A seleção exige um único vínculo que coincida com a URL remota canônica e o commit raiz, e não concede acesso ao projeto.
