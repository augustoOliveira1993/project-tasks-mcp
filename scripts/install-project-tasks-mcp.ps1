[CmdletBinding()]
param([string]$McpAddress)

$ErrorActionPreference = 'Stop'
$DefaultServiceAddress = '192.168.17.26:3443'
$SkillUrl = if ([string]::IsNullOrWhiteSpace($env:PTM_SKILL_URL)) { 'https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/.codex/skills/project-tasks-mcp/SKILL.md' } else { $env:PTM_SKILL_URL.Trim() }
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
  param()
  $secretDirectory = Join-Path $env:LOCALAPPDATA 'ProjectTasks'
  $secretPath = Join-Path $secretDirectory 'bridge-token.dpapi'
  New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $secretPath) {
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
  $secureToken = Read-Host 'Token de agente exclusivo desta máquina' -AsSecureString
  $token = [System.Net.NetworkCredential]::new('', $secureToken).Password
  if ($token -notmatch '^[a-fA-F0-9]{64}$') { throw 'O token de agente deve ter 64 caracteres hexadecimais.' }

  $encrypted = ConvertFrom-SecureString -SecureString (ConvertTo-SecureString $token -AsPlainText -Force)
  [System.IO.File]::WriteAllText($secretPath, $encrypted, [System.Text.UTF8Encoding]::new($false))
  $token = $null
  Write-Host "Token protegido para este usuário do Windows em $secretPath" -ForegroundColor Green
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

function Set-CodexMcp {
  param([string]$Email, [bool]$InstallBridge)
  $codexDirectory = Join-Path $env:USERPROFILE '.codex'
  $configPath = Join-Path $codexDirectory 'config.toml'
  New-Item -ItemType Directory -Path $codexDirectory -Force | Out-Null
  $current = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw } else { '' }
  $current = Remove-CodexServer -Content $current -Name $ServerName
  if ($InstallBridge) { $current = Remove-CodexServer -Content $current -Name $BridgeServerName }

  $section = @"
[mcp_servers.$ServerName]
url = $(ConvertTo-TomlString $ServerUrl)
http_headers = { "X-Project-Tasks-Email" = $(ConvertTo-TomlString $Email) }
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

function Set-ClaudeMcp {
  param([string]$Email, [bool]$InstallBridge)
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  if (-not $claude) { throw 'Claude Code não foi encontrado no PATH. Instale-o e execute este script novamente.' }

  if (Test-ClaudeMcpServer -ClaudePath $claude.Source -Name $ServerName) {
    & $claude.Source mcp remove $ServerName --scope user
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível substituir a configuração MCP HTTP existente no Claude Code.' }
  }
  & $claude.Source mcp add --transport http --scope user $ServerName $ServerUrl --header "X-Project-Tasks-Email: $Email"
  if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração MCP HTTP.' }
  & $claude.Source mcp get $ServerName
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar a configuração MCP HTTP do Claude Code.' }

  if ($InstallBridge) {
    if (Test-ClaudeMcpServer -ClaudePath $claude.Source -Name $BridgeServerName) {
      & $claude.Source mcp remove $BridgeServerName --scope user
      if ($LASTEXITCODE -ne 0) { throw 'Não foi possível substituir a bridge Git existente no Claude Code.' }
    }
    & $claude.Source mcp add --transport stdio --scope user $BridgeServerName --env "PTM_SERVICE_URL=$ServiceBaseUrl" -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BridgeLauncher
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração da bridge Git.' }
    & $claude.Source mcp get $BridgeServerName
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar a configuração da bridge Git do Claude Code.' }
  }
  Install-ClientSkill -ClientRoot (Join-Path $env:USERPROFILE '.claude') -ClientName 'Claude Code'
  Write-Host 'Claude Code configurado globalmente.' -ForegroundColor Green
}

Write-Host 'Instalador global do Project Tasks MCP' -ForegroundColor Cyan
$ServiceBaseUrl = Read-McpAddress -InputAddress $McpAddress
$ServerUrl = "$ServiceBaseUrl/mcp"
Write-Host "Servidor MCP: $ServerUrl"
$email = Read-Email
$choice = Read-Choice 'IA: [c]odex, [l]claude ou [a]mbos' @('c', 'l', 'a')
$installBridge = (Read-Choice 'Configurar também a bridge Git local? [S/n]' @('s', 'n') 's') -eq 's'
if ($installBridge -and -not $IsMcpCheckout) { throw 'A bridge Git local exige executar o instalador a partir do checkout do Project Tasks MCP; execute pelo repositório ou responda n para configurar somente o MCP HTTP.' }
if ($installBridge) { Save-BridgeToken }

if ($choice -in @('c', 'a')) { Set-CodexMcp -Email $email -InstallBridge $installBridge }
if ($choice -in @('l', 'a')) { Set-ClaudeMcp -Email $email -InstallBridge $installBridge }

Write-Host ''
Write-Host 'Concluído. A skill global project-tasks-mcp foi instalada para cada cliente selecionado.' -ForegroundColor Green
Write-Host 'Ativação da skill: Codex usa $project-tasks-mcp; Claude Code usa /project-tasks-mcp.' -ForegroundColor Green
Write-Host 'O prompt MCP iniciar_trabalho é fornecido pelo servidor; atualize e reinicie o cliente para carregá-lo.' -ForegroundColor Green
if ($installBridge) { Write-Host 'A bridge Git será identificada pelo vínculo salvo e pelo checkout aberto; use status primeiro.' -ForegroundColor Green }
