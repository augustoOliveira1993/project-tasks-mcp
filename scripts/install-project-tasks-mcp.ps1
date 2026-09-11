[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ServerUrl = 'http://AVB-NB-00295:3443/mcp'
$ServerName = 'project_tasks'

function Read-Choice {
  param([string]$Prompt, [string[]]$Allowed)
  do { $value = (Read-Host $Prompt).Trim().ToLowerInvariant() } while ($value -notin $Allowed)
  return $value
}

function Read-Email {
  do { $email = (Read-Host 'E-mail que identificará suas execuções').Trim().ToLowerInvariant() } while ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  return $email
}

function Set-CodexMcp {
  param([string]$Email)
  $codexDirectory = Join-Path $env:USERPROFILE '.codex'
  $configPath = Join-Path $codexDirectory 'config.toml'
  New-Item -ItemType Directory -Path $codexDirectory -Force | Out-Null
  $current = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw } else { '' }
  $sectionPattern = '(?ms)^\[mcp_servers\.project_tasks\]\r?\n.*?(?=^\[|\z)'
  $withoutProjectTasks = [regex]::Replace($current, $sectionPattern, '').TrimEnd()
  $section = @"
[mcp_servers.project_tasks]
url = "$ServerUrl"
http_headers = { "X-Project-Tasks-Email" = "$Email" }
startup_timeout_sec = 20
"@
  $content = if ($withoutProjectTasks) { "$withoutProjectTasks`r`n`r`n$section" } else { $section }
  [System.IO.File]::WriteAllText($configPath, $content.TrimEnd() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Codex configurado globalmente em $configPath" -ForegroundColor Green
}

function Set-ClaudeMcp {
  param([string]$Email)
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  if (-not $claude) { throw 'Claude Code não foi encontrado no PATH. Instale-o e execute este script novamente.' }
  $configuration = @{ type = 'http'; url = $ServerUrl; headers = @{ 'X-Project-Tasks-Email' = $Email } } | ConvertTo-Json -Compress
  & $claude.Source mcp add-json --scope user $ServerName $configuration
  if ($LASTEXITCODE -ne 0) { throw 'Claude Code recusou a configuração MCP.' }
  & $claude.Source mcp get $ServerName
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível confirmar a configuração do Claude Code.' }
  Write-Host 'Claude Code configurado globalmente.' -ForegroundColor Green
}

Write-Host 'Instalador global do Project Tasks MCP' -ForegroundColor Cyan
Write-Host "Servidor fixo: $ServerUrl"
$email = Read-Email
$choice = Read-Choice 'IA: [c]odex, [l]claude ou [a]mbos' @('c', 'l', 'a')

if ($choice -in @('c', 'a')) { Set-CodexMcp -Email $email }
if ($choice -in @('l', 'a')) { Set-ClaudeMcp -Email $email }

Write-Host ''
Write-Host 'Concluído. Reinicie o Codex ou Claude Code antes de usar o MCP.' -ForegroundColor Green
