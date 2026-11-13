export type IssuedCredentials = {
  email: string;
  agent?: { token: string; credentialId: string };
  person?: { token: string; credentialId: string; projects: string[] };
  admin?: { token: string; credentialId: string };
  failures: string[];
};

const serviceBaseUrl = () => import.meta.env.DEV ? 'http://127.0.0.1:3443' : window.location.origin;
const installerUrl = 'https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/scripts/install-project-tasks-mcp.sh';

export function installerFileBase(email: string) {
  const safeEmail = email.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `instalar-project-tasks-${safeEmail || 'responsavel'}`;
}

function powershellLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function shellLiteral(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function personalWindowsInstaller(email: string, agentToken?: string) {
  const agentSetup = agentToken
    ? `  Write-Warning 'ATENCAO: este arquivo contem um token de agente. Compartilhe somente com o responsavel por canal seguro e exclua-o depois de executar.'
  $env:PTM_ONBOARDING_AGENT_TOKEN = ${powershellLiteral(agentToken)}
  $env:PTM_ONBOARDING_AUTH_MODE = 'bearer'
`
    : `  Write-Warning 'Este arquivo nao contem credenciais secretas. Execute-o somente para o responsavel indicado.'
`;
  return `\uFEFF$ErrorActionPreference = 'Stop'
$installerPath = Join-Path $env:TEMP ('project-tasks-mcp-installer-' + [guid]::NewGuid().ToString('N') + '.ps1')
try {
${agentSetup}  $env:PTM_ONBOARDING_MCP_URL = ${powershellLiteral(serviceBaseUrl())}
  $env:PTM_ONBOARDING_EMAIL = ${powershellLiteral(email)}
  $env:PTM_ONBOARDING_INSTALL_BRIDGE = 'false'
  Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/augustoOliveira1993/project-tasks-mcp/main/scripts/install-project-tasks-mcp.ps1' -OutFile $installerPath -UseBasicParsing
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath
  if ($LASTEXITCODE -ne 0) { throw 'O instalador do Project Tasks MCP terminou com erro.' }
} finally {
  @('PTM_ONBOARDING_AGENT_TOKEN', 'PTM_ONBOARDING_EMAIL', 'PTM_ONBOARDING_MCP_URL', 'PTM_ONBOARDING_INSTALL_BRIDGE', 'PTM_ONBOARDING_AUTH_MODE') | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue }
}
`;
}

export function personalUbuntuInstaller(email: string, hasAgentToken: boolean) {
  const endpoint = `${serviceBaseUrl()}/mcp`;
  const authMode = hasAgentToken ? `export PTM_MCP_AUTH_MODE='bearer'\n` : '';
  return `#!/usr/bin/env bash
set -euo pipefail

installer_path="$(mktemp "\${TMPDIR:-/tmp}/project-tasks-mcp-installer.XXXXXX.sh")"
cleanup() {
  unset PTM_MCP_URL PTM_MCP_EMAIL PTM_MCP_AUTH_MODE PTM_MCP_AGENT_TOKEN PTM_MCP_CLIENTS
  rm -f -- "$installer_path"
  if [[ -n "\${BASH_SOURCE[0]:-}" ]]; then rm -f -- "\${BASH_SOURCE[0]}"; fi
}
trap cleanup EXIT

echo 'Este instalador temporario se apaga ao terminar. Se escolher Bearer, informe o token no prompt oculto.'
export PTM_MCP_URL=${shellLiteral(endpoint)}
export PTM_MCP_EMAIL=${shellLiteral(email)}
${authMode}if ! command -v curl >/dev/null 2>&1; then
  echo 'curl é necessário para baixar o instalador oficial.' >&2
  exit 1
fi
curl -fsSL ${shellLiteral(installerUrl)} -o "$installer_path"
bash "$installer_path"
`;
}

export function downloadTextFile(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function issuedCredentialHtml(issued: IssuedCredentials) {
  const credentials = [
    issued.person && { title: 'Token de acesso · pessoa', description: `Entrar no painel e acompanhar: ${issued.person.projects.join(', ')}.`, token: issued.person.token },
    issued.admin && { title: 'Token humano · administrador do sistema', description: 'Entrar no painel com permissões administrativas globais. Guarde este token como credencial de alto privilégio.', token: issued.admin.token },
    issued.agent && { title: 'Token de agente · automações MCP', description: 'Usado pelo Codex, Claude Code ou outra automação para autenticar chamadas MCP.', token: issued.agent.token },
  ].filter((credential): credential is { title: string; description: string; token: string } => Boolean(credential));
  return credentials.map(credential => `<section class="credential"><h2>${escapeHtml(credential.title)}</h2><p>${escapeHtml(credential.description)}</p><pre>${escapeHtml(credential.token)}</pre></section>`).join('');
}

export function buildInstallationGuideHtml(issued: IssuedCredentials, environment: 'windows' | 'ubuntu') {
  const base = installerFileBase(issued.email);
  const filename = `${base}.${environment === 'windows' ? 'ps1' : 'sh'}`;
  const instructions = environment === 'windows'
    ? `<p>Salve o arquivo <strong>${escapeHtml(filename)}</strong> na pasta Downloads do Windows. O script personalizado preenche o e-mail e o servidor. ${issued.agent ? 'Ele contém o token de agente e seleciona Bearer automaticamente.' : 'Selecione trusted_local na pergunta de autenticação; se escolher Bearer, informe um token de agente.'}</p><pre>powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\${escapeHtml(filename)}"</pre><p>Durante a instalação, escolha Codex, Claude Code ou ambos.</p>`
    : `<p>Salve <strong>${escapeHtml(filename)}</strong> em Downloads no Ubuntu. O instalador configura o endpoint e o e-mail. ${issued.agent ? 'Bearer será selecionado e o token de agente será solicitado no terminal sem eco.' : 'Escolha trusted_local ou Bearer; Bearer solicita o token de agente sem eco.'}</p><pre>cd "$HOME/Downloads"
chmod 700 "./${escapeHtml(filename)}"
"./${escapeHtml(filename)}"</pre><p>Durante a instalação, escolha Codex, Claude Code ou ambos.</p>`;
  const credentialContent = issuedCredentialHtml(issued);
  const date = new Date().toLocaleDateString('pt-BR');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Credenciais e instalação MCP</title>
<style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#182230;font-size:10pt;line-height:1.48;margin:0}header{border-bottom:2px solid #365cf5;padding-bottom:12px;margin-bottom:18px}.eyebrow{color:#365cf5;font-size:8pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{font-size:21pt;margin:6px 0}h2{font-size:12pt;margin:0 0 5px}.meta{color:#526078;font-size:9pt}.warning{border:1px solid #e5b84b;background:#fff8e3;padding:11px 13px;border-radius:6px;margin:16px 0}.warning strong{display:block;margin-bottom:3px}.credential{border:1px solid #d7dce5;border-radius:7px;padding:11px 13px;margin:10px 0;break-inside:avoid}.credential p{margin:0 0 8px;color:#526078}.credential pre,pre{font-family:Consolas,'Courier New',monospace;font-size:8.5pt;white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6fa;border:1px solid #e1e5ed;border-radius:5px;padding:10px;margin:8px 0}section{margin-top:18px}footer{border-top:1px solid #d7dce5;margin-top:22px;padding-top:8px;color:#687386;font-size:8pt}@media print{a{color:inherit}section,.credential,.warning{break-inside:avoid}}
</style></head><body>
<header><div class="eyebrow">Project Tasks MCP · Acesso e instalação</div><h1>Credenciais do responsável</h1><div class="meta">Responsável: ${escapeHtml(issued.email)} · Ambiente: ${environment === 'windows' ? 'Windows' : 'Ubuntu'} · Gerado em ${escapeHtml(date)}</div></header>
<div class="warning"><strong>Documento confidencial</strong>Este PDF contém credenciais de acesso. Envie somente ao responsável por um canal seguro e exclua cópias desnecessárias depois da instalação. A geração acontece localmente no navegador; os tokens não são enviados ao servidor para montar este documento.</div>
<section><h2>Credenciais emitidas</h2>${credentialContent}</section>
<section><h2>Instalação no ${environment === 'windows' ? 'Windows' : 'Ubuntu'}</h2>${instructions}</section>
<footer>Os tokens aparecem somente nesta emissão. Guarde o token humano para o painel e o token de agente para automações MCP.</footer>
</body></html>`;
}
