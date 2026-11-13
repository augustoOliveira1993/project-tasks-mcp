[CmdletBinding()]
param([string]$McpAddress)

$ErrorActionPreference = 'Stop'
$DefaultServiceAddress = '192.168.17.26:3443'
$SkillUrl = if ([string]::IsNullOrWhiteSpace($env:PTM_SKILL_URL)) { 'https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/.codex/skills/project-tasks-mcp/SKILL.md' } else { $env:PTM_SKILL_URL.Trim() }
$SpecKitSkillUrl = if ([string]::IsNullOrWhiteSpace($env:PTM_SPECKIT_SKILL_URL)) { 'https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/.agents/skills/speckit-auto/SKILL.md' } else { $env:PTM_SPECKIT_SKILL_URL.Trim() }
$ServiceBaseUrl = $null
$ServerUrl = $null
$ServerName = 'project_tasks'
$BridgeServerName = 'project_tasks_git'
$McpRoot = Split-Path -Parent $PSScriptRoot
$BridgeLauncher = Join-Path $PSScriptRoot 'run-project-tasks-bridge.ps1'
$IsMcpCheckout = $false
$packagePath = Join-Path $McpRoot 'package.json'
if ((Split-Path -Leaf $PSScriptRoot) -eq 'scripts' -and (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  try { $IsMcpCheckout = (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).name -eq 'project-tasks-mcp' } catch { }
}

function Read-Choice {
  param([string]$Prompt, [string[]]$Allowed, [string]$Default)
  do {
    $value = (Read-Host $Prompt).Trim().ToLowerInvariant()
    if (-not $value -and $Default) { $value = $Default.ToLowerInvariant() }
  } while ($value -notin $Allowed)
  return $value
}

function Read-Email {
  do { $email = (Read-Host 'E-mail que identificará suas execuções').Trim().ToLowerInvariant() } while ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  return $email
}

function Read-McpAddress {
  param([string]$InputAddress)
  $parameterProvided = -not [string]::IsNullOrWhiteSpace($InputAddress)
  if (-not $parameterProvided -and -not [string]::IsNullOrWhiteSpace($env:PTM_ONBOARDING_MCP_URL)) {
    $InputAddress = $env:PTM_ONBOARDING_MCP_URL.Trim()
    $parameterProvided = $true
  }

  while ($true) {
    if ($parameterProvided) { $address = $InputAddress.Trim() }
    else { $address = (Read-Host "IP ou domínio do MCP [$DefaultServiceAddress]").Trim() }
    if (-not $address) { $address = $DefaultServiceAddress }

    if ($address -notmatch '^https?://') { $address = "http://$address" }
    $uri = $null
    $validUri = [System.Uri]::TryCreate($address, [System.UriKind]::Absolute, [ref]$uri)
    $validPath = $validUri -and $uri.AbsolutePath -in @('', '/', '/mcp', '/mcp/')
    $validPort = $validUri -and ($uri.IsDefaultPort -or ($uri.Port -ge 1 -and $uri.Port -le 65535))
    if ($validUri -and $uri.Scheme -in @('http', 'https') -and $uri.Host -and -not $uri.UserInfo -and -not $uri.Query -and -not $uri.Fragment -and $validPath -and $validPort) {
      return $uri.GetLeftPart([System.UriPartial]::Authority)
    }

    if ($parameterProvided) { throw 'Endereço MCP inválido. Use IP/domínio com porta opcional ou URL HTTP(S) sem caminho adicional.' }
    Write-Host 'Endereço inválido. Informe um IP ou domínio, com porta opcional, sem caminho adicional.' -ForegroundColor Yellow
  }
}

function Save-BridgeToken {
  param([string]$ProvidedToken)
  $secretDirectory = Join-Path $env:LOCALAPPDATA 'ProjectTasks'
  $secretPath = Join-Path $secretDirectory 'bridge-token.dpapi'
  New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
  $token = $ProvidedToken
  if (-not $token -and (Test-Path -LiteralPath $secretPath)) {
    $reuse = Read-Choice 'Já existe token protegido neste usuário. Reutilizar? [s/n]' @('s', 'n')
    if ($reuse -eq 's') {
      try {
        $storedToken = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw)
        $plainToken = [System.Net.NetworkCredential]::new('', $storedToken).Password
        if ($plainToken -match '^[a-fA-F0-9]{64}$') {
          $plainToken = $null
          Write-Host 'Token existente reutilizado.' -ForegroundColor Green
          return
        }
      } catch { }
      throw 'O token protegido existente não pôde ser lido. Escolha não reutilizar e informe um token válido.'
    }
  }
  if (-not $token) {
    $secureToken = Read-Host 'Token de agente exclusivo desta máquina' -AsSecureString
    $token = [System.Net.NetworkCredential]::new('', $secureToken).Password
  }
  if ($token -notmatch '^[a-fA-F0-9]{64}$') { throw 'O token de agente deve ter 64 caracteres hexadecimais.' }

  $encrypted = ConvertFrom-SecureString -SecureString (ConvertTo-SecureString $token -AsPlainText -Force)
  [System.IO.File]::WriteAllText($secretPath, $encrypted, [System.Text.UTF8Encoding]::new($false))
  $token = $null
  Write-Host 'Token de agente protegido para este usuário do Windows.' -ForegroundColor Green
}

function ConvertTo-TomlString {
  param([string]$Value)
  return ConvertTo-Json -InputObject $Value -Compress
}

function Remove-CodexServer {
  param([string]$Content, [string]$Name)
  $escapedName = [regex]::Escape($Name)
  $pattern = "(?ms)^\[mcp_servers\.$escapedName(?:\.[^\]]+)?\]\r?\n.*?(?=^\[|\z)"
  return [regex]::Replace($Content, $pattern, '').TrimEnd()
}

function Install-ClientSkill {
  param([string]$ClientRoot, [string]$ClientName)
  $source = Join-Path $McpRoot '.codex\skills\project-tasks-mcp\SKILL.md'
  if ($IsMcpCheckout -and (Test-Path -LiteralPath $source -PathType Leaf)) {
    $skillSource = $source
    $skillContent = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
  } else {
    $skillSource = $SkillUrl
    try {
      $skillContent = (Invoke-WebRequest -Uri $SkillUrl -UseBasicParsing -TimeoutSec 20).Content
    } catch {
      throw "Não foi possível carregar a skill local ($source) nem baixá-la de $SkillUrl. $($_.Exception.Message)"
    }
  }
  $frontMatter = [regex]::Match($skillContent, '(?ms)\A---\r?\n(.*?)\r?\n---(?:\r?\n|\z)')
  if (-not $frontMatter.Success -or $frontMatter.Groups[1].Value -notmatch '(?m)^name:\s*project-tasks-mcp\s*$') {
    throw "Conteúdo de skill inválido em $skillSource"
  }

  $skillDirectory = Join-Path $ClientRoot 'skills\project-tasks-mcp'
  $target = Join-Path $skillDirectory 'SKILL.md'
  New-Item -ItemType Directory -Path $skillDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $targetContent = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)
    if ($targetContent -ceq $skillContent) {
      Write-Host "Skill do $ClientName já está atualizada em $target" -ForegroundColor Green
      return
    }
    $backup = "$target.bak-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
    Copy-Item -LiteralPath $target -Destination $backup
    Write-Host "Skill anterior preservada em $backup" -ForegroundColor Yellow
  }
  [System.IO.File]::WriteAllText($target, $skillContent, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Skill do $ClientName instalada em $target" -ForegroundColor Green
}

function Install-SpecKitAutoSkill {
  param([string]$ClientRoot, [string]$ClientName)
  $source = Join-Path $McpRoot '.agents\skills\speckit-auto\SKILL.md'
  if ($IsMcpCheckout -and (Test-Path -LiteralPath $source -PathType Leaf)) {
    $skillSource = $source
    $skillContent = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
  } else {
    $skillSource = $SpecKitSkillUrl
    try {
      $skillContent = (Invoke-WebRequest -Uri $SpecKitSkillUrl -UseBasicParsing -TimeoutSec 20).Content
    } catch {
      throw "Não foi possível carregar a skill local ($source) nem baixá-la de $SpecKitSkillUrl. $($_.Exception.Message)"
    }
  }
  $frontMatter = [regex]::Match($skillContent, '(?ms)\A---\r?\n(.*?)\r?\n---(?:\r?\n|\z)')
  if (-not $frontMatter.Success -or $frontMatter.Groups[1].Value -notmatch '(?m)^name:\s*speckit-auto\s*$') {
    throw "Conteúdo de skill inválido em $skillSource"
  }

  $skillDirectory = Join-Path $ClientRoot 'skills\speckit-auto'
  $target = Join-Path $skillDirectory 'SKILL.md'
  New-Item -ItemType Directory -Path $skillDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $targetContent = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)
    if ($targetContent -ceq $skillContent) {
      Write-Host "Skill speckit-auto do $ClientName já está atualizada em $target" -ForegroundColor Green
      return
    }
    $backup = "$target.bak-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
    Copy-Item -LiteralPath $target -Destination $backup
    Write-Host "Skill anterior preservada em $backup" -ForegroundColor Yellow
  }
  [System.IO.File]::WriteAllText($target, $skillContent, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Skill speckit-auto do $ClientName instalada em $target" -ForegroundColor Green
}

function Set-CodexMcp {
  param([string]$Email, [bool]$InstallBridge, [string]$AuthMode, [string]$AgentToken)
  $codexDirectory = Join-Path $env:USERPROFILE '.codex'
  $configPath = Join-Path $codexDirectory 'config.toml'
  New-Item -ItemType Directory -Path $codexDirectory -Force | Out-Null
  $current = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw } else { '' }
  $current = Remove-CodexServer -Content $current -Name $ServerName
  if ($InstallBridge) { $current = Remove-CodexServer -Content $current -Name $BridgeServerName }

  $headers = if ($AuthMode -eq 'bearer') {
    '"Authorization" = ' + (ConvertTo-TomlString "Bearer $AgentToken")
  } else {
    '"X-Project-Tasks-Email" = ' + (ConvertTo-TomlString $Email)
  }
  $section = @"
[mcp_servers.$ServerName]
url = $(ConvertTo-TomlString $ServerUrl)
http_headers = { $headers }
startup_timeout_sec = 20
"@
  if ($InstallBridge) {
    $argsJson = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $BridgeLauncher) | ConvertTo-Json -Compress
    $section += @"

[mcp_servers.$BridgeServerName]
command = "powershell.exe"
args = $argsJson
env = { PTM_SERVICE_URL = $(ConvertTo-TomlString $ServiceBaseUrl) }
startup_timeout_sec = 20
"@
  }
  $content = if ($current) { "$current`r`n`r`n$section" } else { $section }
  [System.IO.File]::WriteAllText($configPath, $content.TrimEnd() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Codex configurado globalmente em $configPath" -ForegroundColor Green
  Install-ClientSkill -ClientRoot (Join-Path $env:USERPROFILE '.codex') -ClientName 'Codex'
}

function Test-ClaudeMcpServer {
  param([string]$ClaudePath, [string]$Name)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $null = & $ClaudePath mcp get $Name 2>$null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Set-ClaudeUserMcpConfiguration {
  param([System.Collections.IDictionary]$Headers)
  $configPath = Join-Path $env:USERPROFILE '.claude.json'
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'A configuração JSON do Claude Code não pôde ser lida; nenhum token foi exibido.' }
    if (-not $config -or $config -isnot [System.Management.Automation.PSCustomObject]) { throw 'A configuração do Claude Code tem formato incompatível.' }
  } else { $config = [pscustomobject]@{} }

  $serversProperty = $config.PSObject.Properties['mcpServers']
  if (-not $serversProperty) {
    $null = $config | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{})
    $servers = $config.mcpServers
  } else { $servers = $serversProperty.Value }
  if (-not $servers -or $servers -isnot [System.Management.Automation.PSCustomObject]) { throw 'A lista MCP da configuração do Claude Code tem formato incompatível.' }

  $entry = [pscustomobject]@{ type = 'http'; url = $ServerUrl; headers = [pscustomobject]$Headers }
  $serverProperty = $servers.PSObject.Properties[$ServerName]
  if ($serverProperty) { $serverProperty.Value = $entry }
  else { $null = $servers | Add-Member -NotePropertyName $ServerName -NotePropertyValue $entry }

  $tempPath = "$configPath.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $json = ConvertTo-Json -InputObject $config -Depth 100
    [System.IO.File]::WriteAllText($tempPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $configPath -Force
  } finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Claude Code configurado globalmente em $configPath" -ForegroundColor Green
}

function Set-ClaudeMcp {
  param([string]$Email, [bool]$InstallBridge, [string]$AuthMode, [string]$AgentToken)
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  if (-not $claude) { throw 'Claude Code não foi encontrado no PATH. Instale-o e execute este script novamente.' }

  if ($AuthMode -eq 'bearer') {
    Set-ClaudeUserMcpConfiguration -Headers ([ordered]@{ Authorization = "Bearer $AgentToken" })
  } else {
    if (Test-ClaudeMcpServer -ClaudePath $claude.Source -Name $ServerName) {
      & $claude.Source mcp remove $ServerName --scope user
      if ($LASTEXITCODE -ne 0) { throw 'Não foi possível substituir a configuração MCP HTTP existente no Claude Code.' }
    }
    & $claude.Source mcp add --transport http --scope user $ServerName $ServerUrl --header "X-Project-Tasks-Email: $Email"
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração MCP HTTP.' }
    & $claude.Source mcp get $ServerName
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar a configuração MCP HTTP do Claude Code.' }
  }

  if ($InstallBridge) {
    if (Test-ClaudeMcpServer -ClaudePath $claude.Source -Name $BridgeServerName) {
      & $claude.Source mcp remove $BridgeServerName --scope user
      if ($LASTEXITCODE -ne 0) { throw 'Não foi possível substituir a bridge Git existente no Claude Code.' }
    }
    & $claude.Source mcp add --transport stdio --scope user $BridgeServerName --env "PTM_SERVICE_URL=$ServiceBaseUrl" -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BridgeLauncher
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração da bridge Git.' }
    $bridgeStatus = & $claude.Source mcp get $BridgeServerName 2>&1
    $bridgeExitCode = $LASTEXITCODE
    $bridgeStatus | ForEach-Object { Write-Host $_ }
    if ($bridgeExitCode -ne 0) { throw 'Não foi possível confirmar a configuração da bridge Git do Claude Code.' }
    if (($bridgeStatus -join "`n") -match '(?i)Failed to connect|CONNECTION_CLOSED|Connection closed') { throw 'A bridge Git foi configurada, mas o Claude Code não conseguiu conectar. Confira o erro do servidor acima e execute o instalador novamente após corrigi-lo.' }
    if (($bridgeStatus -join "`n") -notmatch '(?im)^\s*Status:\s*.*\bConnected\b') { throw 'O Claude Code não confirmou a conexão da bridge Git; confira a saída acima antes de usar a bridge.' }
  }
  Install-ClientSkill -ClientRoot (Join-Path $env:USERPROFILE '.claude') -ClientName 'Claude Code'
  Write-Host 'Claude Code configurado globalmente.' -ForegroundColor Green
}

$agentToken = $null
$secureAgentToken = $null
try {
  Write-Host 'Instalador global do Project Tasks MCP' -ForegroundColor Cyan
  $addressInput = if (-not [string]::IsNullOrWhiteSpace($McpAddress)) { $McpAddress } else { $env:PTM_ONBOARDING_MCP_URL }
  $ServiceBaseUrl = Read-McpAddress -InputAddress $addressInput
  $ServerUrl = "$ServiceBaseUrl/mcp"
  Write-Host "Servidor MCP: $ServerUrl"

  $email = if ([string]::IsNullOrWhiteSpace($env:PTM_ONBOARDING_EMAIL)) { Read-Email } else { $env:PTM_ONBOARDING_EMAIL.Trim().ToLowerInvariant() }
  if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'E-mail inválido.' }

  $authMode = $env:PTM_ONBOARDING_AUTH_MODE
  if ($authMode -notin @('trusted_local', 'bearer')) {
    $authChoice = Read-Choice 'Autenticação: [t]rusted_local ou [b]earer' @('t', 'b') 't'
    $authMode = if ($authChoice -eq 'b') { 'bearer' } else { 'trusted_local' }
  }
  $agentToken = $env:PTM_ONBOARDING_AGENT_TOKEN
  if ($authMode -eq 'bearer' -and [string]::IsNullOrWhiteSpace($agentToken)) {
    $secureAgentToken = Read-Host 'Token de agente' -AsSecureString
    $agentToken = [System.Net.NetworkCredential]::new('', $secureAgentToken).Password
  }
  if (-not [string]::IsNullOrWhiteSpace($agentToken) -and $agentToken -notmatch '^[a-fA-F0-9]{64}$') { throw 'O token de agente deve ter 64 caracteres hexadecimais.' }
  if ($authMode -eq 'bearer' -and [string]::IsNullOrWhiteSpace($agentToken)) { throw 'Informe um token de agente para autenticação Bearer.' }

  $choice = Read-Choice 'IA: [c]odex, [l]claude ou [a]mbos' @('c', 'l', 'a')
  if (-not [string]::IsNullOrWhiteSpace($env:PTM_ONBOARDING_INSTALL_BRIDGE)) {
    $installBridge = $env:PTM_ONBOARDING_INSTALL_BRIDGE -match '^(?i:1|true|yes|s)$'
  } elseif ($IsMcpCheckout) {
    $installBridge = (Read-Choice 'Configurar também a bridge Git local? [S/n]' @('s', 'n') 's') -eq 's'
  } else { $installBridge = $false }
  if ($installBridge -and -not $IsMcpCheckout) { throw 'A bridge Git local exige executar o instalador a partir do checkout do Project Tasks MCP; execute pelo repositório ou escolha n para configurar somente o MCP HTTP.' }
  if ($installBridge) { Save-BridgeToken -ProvidedToken $agentToken }

  if ($choice -in @('c', 'a')) {
    Set-CodexMcp -Email $email -InstallBridge $installBridge -AuthMode $authMode -AgentToken $agentToken
    Install-SpecKitAutoSkill -ClientRoot (Join-Path $env:USERPROFILE '.agents') -ClientName 'Codex'
  }
  if ($choice -in @('l', 'a')) {
    Set-ClaudeMcp -Email $email -InstallBridge $installBridge -AuthMode $authMode -AgentToken $agentToken
    Install-SpecKitAutoSkill -ClientRoot (Join-Path $env:USERPROFILE '.claude') -ClientName 'Claude Code'
  }

  Write-Host ''
  Write-Host 'Concluído. As skills project-tasks-mcp e speckit-auto foram instaladas/atualizadas para os clientes selecionados.' -ForegroundColor Green
  Write-Host 'Ativação: Codex usa $project-tasks-mcp e $speckit-auto; Claude Code usa /project-tasks-mcp e /speckit-auto.' -ForegroundColor Green
  Write-Host 'Reinicie Codex ou Claude Code para carregar as skills atualizadas. O prompt iniciar_trabalho vem do servidor MCP atualizado.' -ForegroundColor Green
  if ($installBridge) { Write-Host 'A bridge Git será identificada pelo vínculo salvo e pelo checkout aberto; use status primeiro.' -ForegroundColor Green }
} finally {
  $agentToken = $null
  $secureAgentToken = $null
  @('PTM_ONBOARDING_AGENT_TOKEN', 'PTM_ONBOARDING_EMAIL', 'PTM_ONBOARDING_MCP_URL', 'PTM_ONBOARDING_AUTH_MODE', 'PTM_ONBOARDING_INSTALL_BRIDGE') | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}
