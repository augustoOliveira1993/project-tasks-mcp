[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ServiceBaseUrl = 'http://AVB-NB-00295:3443'
$ServerUrl = "$ServiceBaseUrl/mcp"
$ServerName = 'project_tasks'
$BridgeServerName = 'project_tasks_git'
$McpRoot = Split-Path -Parent $PSScriptRoot
$BridgeLauncher = Join-Path $PSScriptRoot 'run-project-tasks-bridge.ps1'

function Read-Choice {
  param([string]$Prompt, [string[]]$Allowed)
  do { $value = (Read-Host $Prompt).Trim().ToLowerInvariant() } while ($value -notin $Allowed)
  return $value
}

function Read-Email {
  do { $email = (Read-Host 'E-mail que identificará suas execuções').Trim().ToLowerInvariant() } while ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  return $email
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

function Set-CodexMcp {
  param([string]$Email, [bool]$InstallBridge)
  $codexDirectory = Join-Path $env:USERPROFILE '.codex'
  $configPath = Join-Path $codexDirectory 'config.toml'
  New-Item -ItemType Directory -Path $codexDirectory -Force | Out-Null
  $current = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw } else { '' }
  $current = Remove-CodexServer -Content $current -Name $ServerName
  $current = Remove-CodexServer -Content $current -Name $BridgeServerName

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
cwd = $(ConvertTo-TomlString $McpRoot)
env = { PTM_SERVICE_URL = $(ConvertTo-TomlString $ServiceBaseUrl) }
startup_timeout_sec = 20
"@
  }
  $content = if ($current) { "$current`r`n`r`n$section" } else { $section }
  [System.IO.File]::WriteAllText($configPath, $content.TrimEnd() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Codex configurado globalmente em $configPath" -ForegroundColor Green
}

function Set-ClaudeMcp {
  param([string]$Email, [bool]$InstallBridge)
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  if (-not $claude) { throw 'Claude Code não foi encontrado no PATH. Instale-o e execute este script novamente.' }

  $configuration = @{ type = 'http'; url = $ServerUrl; headers = @{ 'X-Project-Tasks-Email' = $Email } } | ConvertTo-Json -Compress
  $null = & $claude.Source mcp get $ServerName 2>$null
  if ($LASTEXITCODE -eq 0) {
    & $claude.Source mcp remove $ServerName --scope user
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível substituir a configuração MCP HTTP existente no Claude Code.' }
  }
  & $claude.Source mcp add-json $ServerName $configuration --scope user
  if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração MCP HTTP.' }
  & $claude.Source mcp get $ServerName
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar a configuração MCP HTTP do Claude Code.' }

  if ($InstallBridge) {
    $null = & $claude.Source mcp get $BridgeServerName 2>$null
    if ($LASTEXITCODE -eq 0) {
      & $claude.Source mcp remove $BridgeServerName --scope user
      if ($LASTEXITCODE -ne 0) { throw 'Não foi possível substituir a bridge Git existente no Claude Code.' }
    }
    & $claude.Source mcp add --transport stdio --scope user $BridgeServerName --env "PTM_SERVICE_URL=$ServiceBaseUrl" -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BridgeLauncher
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração da bridge Git.' }
    & $claude.Source mcp get $BridgeServerName
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar a configuração da bridge Git do Claude Code.' }
  }
  Write-Host 'Claude Code configurado globalmente.' -ForegroundColor Green
}

Write-Host 'Instalador global do Project Tasks MCP' -ForegroundColor Cyan
Write-Host "Servidor fixo: $ServerUrl"
$email = Read-Email
$choice = Read-Choice 'IA: [c]odex, [l]claude ou [a]mbos' @('c', 'l', 'a')
$installBridge = (Read-Choice 'Configurar também a bridge Git local? [s/n]' @('s', 'n')) -eq 's'
if ($installBridge) { Save-BridgeToken }

if ($choice -in @('c', 'a')) { Set-CodexMcp -Email $email -InstallBridge $installBridge }
if ($choice -in @('l', 'a')) { Set-ClaudeMcp -Email $email -InstallBridge $installBridge }

Write-Host ''
Write-Host 'Concluído. Reinicie o Codex ou Claude Code antes de usar o MCP.' -ForegroundColor Green
if ($installBridge) { Write-Host 'A bridge Git será identificada pelo vínculo salvo e pelo checkout aberto; use status primeiro.' -ForegroundColor Green }
