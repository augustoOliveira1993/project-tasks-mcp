# Configurar o MCP em outras máquinas

Este guia conecta o Codex e/ou Claude Code de outra máquina ao servidor MCP já instalado. Ele não instala nem inicia o servidor.

Endereço padrão:

```text
http://192.168.17.26:3443/mcp
```

Os exemplos usam `trusted_local`: o cliente envia o e-mail da pessoa no cabeçalho `X-Project-Tasks-Email`, sem token de agente. Use esse modo somente na rede privada confiável; não exponha a porta do MCP à internet. Se o servidor estiver configurado em modo `bearer`, siga a seção de autenticação bearer do [guia completo](INSTALACAO_PASSO_A_PASSO.md), pois os instaladores deste documento usam `trusted_local`.

Antes de configurar o cliente, confirme que a máquina alcança o servidor:

```powershell
Invoke-RestMethod http://192.168.17.26:3443/health
```

No Ubuntu:

```bash
curl -fsS http://192.168.17.26:3443/health
```

## Windows

Baixe o instalador atualizado do repositório e execute com o endereço padrão:

```powershell
$installer = Join-Path $env:TEMP 'install-project-tasks-mcp.ps1'
Invoke-WebRequest 'https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/scripts/install-project-tasks-mcp.ps1' -OutFile $installer
& $installer -McpAddress '192.168.17.26:3443'
```

Se você já clonou o repositório, também pode executá-lo diretamente:

```powershell
.\scripts\install-project-tasks-mcp.ps1 -McpAddress '192.168.17.26:3443'
```

O parâmetro aceita IP ou domínio, com porta opcional, e URL `http://` ou `https://`. Se omitir `-McpAddress`, o instalador solicita o endereço e sugere `192.168.17.26:3443`. Informe o e-mail que deve aparecer como autor das execuções e escolha Codex, Claude Code ou ambos. Claude Code precisa estar instalado e disponível no `PATH`.

Para apontar para outro endereço sem editar este Markdown, passe-o no parâmetro (use `$installer` se baixou o script):

```powershell
.\scripts\install-project-tasks-mcp.ps1 -McpAddress 'mcp.empresa.local:3443'
```

A bridge Git é opcional e requer o checkout local do MCP e um token `agent` exclusivo para essa máquina. Para usar somente o MCP remoto HTTP, responda `n` à pergunta da bridge.

## Ubuntu/Linux

O instalador Bash pode ser executado a partir deste repositório ou baixado sozinho. Requer Bash e Python 3; Claude Code CLI também é necessário se você selecionar Claude. Para baixar somente o script:

```bash
curl -fsSLo install-project-tasks-mcp.sh https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/scripts/install-project-tasks-mcp.sh
```

Para usar os valores deste servidor e informar o e-mail/clientes de forma não interativa:

```bash
PTM_MCP_URL='http://192.168.17.26:3443/mcp' \
PTM_MCP_EMAIL='pessoa@empresa.com' \
PTM_MCP_CLIENTS='a' \
bash ./install-project-tasks-mcp.sh
```

`PTM_MCP_CLIENTS` aceita `c` para Codex, `l` para Claude Code ou `a` para ambos. Para trocar o servidor, altere apenas `PTM_MCP_URL`, por exemplo:

```bash
PTM_MCP_URL='https://mcp.empresa.com/mcp' \
PTM_MCP_EMAIL='pessoa@empresa.com' \
PTM_MCP_CLIENTS='c' \
bash ./install-project-tasks-mcp.sh
```

Sem essas variáveis, o instalador pergunta URL, e-mail e clientes. O script configura somente o MCP HTTP remoto; não instala a bridge Git.

## Conferir a conexão

Depois da instalação, reinicie o cliente escolhido. No Claude Code, confira com:

```powershell
claude mcp get project_tasks
```

No Codex CLI, confira com:

```powershell
codex mcp list
```

O endpoint `/health` confirma disponibilidade de rede, mas não testa identidade ou permissões do MCP.
