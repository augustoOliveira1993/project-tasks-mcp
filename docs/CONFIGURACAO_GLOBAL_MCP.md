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

Em `C:\Users\<usuario>\.codex\config.toml`:

```toml
[mcp_servers.project_tasks]
url = "http://AVB-NB-00295:3443/mcp"
http_headers = { "X-Project-Tasks-Email" = "pessoa@empresa.com" }
startup_timeout_sec = 20
```

Reinicie Codex. Essa configuração é global para Codex CLI, IDE e aplicativo desktop.

## Claude Code

Remova uma entrada antiga de projeto, caso exista:

```powershell
claude mcp remove project_tasks -s project
```

Adicione no perfil do usuário. A ordem abaixo é compatível com versões que tratam `--header` como lista:

```powershell
$serverUrl = 'http' + '://AVB-NB-00295:3443/mcp'
$email = 'pessoa@empresa.com'
claude mcp add --transport http --scope user project_tasks $serverUrl --header "X-Project-Tasks-Email: $email"
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
