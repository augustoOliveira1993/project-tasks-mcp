$ErrorActionPreference = 'Stop'

$tokenPath = Join-Path $env:LOCALAPPDATA 'ProjectTasks\bridge-token.dpapi'
if (-not (Test-Path -LiteralPath $tokenPath)) {
  [Console]::Error.WriteLine('Token da bridge ausente. Execute scripts/install-project-tasks-mcp.ps1 novamente e informe um token de agente.')
  exit 1
}

try {
  $encryptedToken = Get-Content -LiteralPath $tokenPath -Raw
  $secureToken = ConvertTo-SecureString $encryptedToken
  $env:PTM_BRIDGE_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
  $mcpRoot = Split-Path -Parent $PSScriptRoot
  Set-Location -LiteralPath $mcpRoot
  & yarn --silent bridge
  $exitCode = $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine("Falha ao iniciar a bridge Project Tasks: $($_.Exception.Message)")
  $exitCode = 1
} finally {
  Remove-Item Env:PTM_BRIDGE_TOKEN -ErrorAction SilentlyContinue
}
exit $exitCode
