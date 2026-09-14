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
