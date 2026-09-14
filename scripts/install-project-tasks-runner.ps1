param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [switch]$AutoStart
)
$ErrorActionPreference = 'Stop'
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$runnerDirectory = Join-Path $env:USERPROFILE '.project-tasks-runner'
$nodeBinary = (Get-Command node -ErrorAction Stop).Source
$tsxEntry = Join-Path $repositoryPath 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxEntry)) { throw 'Execute yarn install no repositorio antes de instalar o executor.' }
$config = Get-Content -Raw -LiteralPath $resolvedConfig | ConvertFrom-Json
if (-not $config.machineId -or -not $config.serviceUrl) { throw 'Config precisa de machineId e serviceUrl.' }
New-Item -ItemType Directory -Path $runnerDirectory -Force | Out-Null
$destination = Join-Path $runnerDirectory 'config.json'
if ($resolvedConfig -ne $destination) {
  if (Test-Path -LiteralPath $destination) { throw "Configuracao existente em $destination. Atualize-a explicitamente antes de reinstalar." }
  Copy-Item -LiteralPath $resolvedConfig -Destination $destination
}
$entry = Join-Path $repositoryPath 'src\runner\main.ts'
$launcher = Join-Path $runnerDirectory 'start-runner.ps1'
$escapeLiteral = { param([string]$value) "'" + $value.Replace("'", "''") + "'" }
$scriptText = '& ' + (& $escapeLiteral $nodeBinary) + ' ' + (& $escapeLiteral $tsxEntry) + ' ' + (& $escapeLiteral $entry) + ' ' + (& $escapeLiteral $destination)
Set-Content -LiteralPath $launcher -Value $scriptText -Encoding UTF8
if ($AutoStart) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $launcher + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'Project Tasks Runner' -Action $action -Trigger $trigger -Settings $settings -Description 'Executor supervisionado do project-tasks-mcp; usa RUNNER_TOKEN do ambiente do usuario.' -Force | Out-Null
}
Write-Host "Executor instalado em $launcher. Defina RUNNER_TOKEN no ambiente do usuario antes de iniciar. Nenhuma configuracao MCP do repositorio foi criada."
