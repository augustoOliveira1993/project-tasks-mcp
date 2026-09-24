#!/usr/bin/env bash
set -euo pipefail

DEFAULT_URL="http://192.168.17.26:3443/mcp"
SERVER_NAME="project_tasks"

read_value() {
  local prompt="$1" default="${2:-}" value
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value
    printf '%s' "${value:-$default}"
  else
    read -r -p "$prompt: " value
    printf '%s' "$value"
  fi
}

if [[ -n "${PTM_MCP_URL:-}" ]]; then url="$PTM_MCP_URL"; else url="$(read_value 'URL do MCP' "$DEFAULT_URL")"; fi
if [[ -n "${PTM_MCP_EMAIL:-}" ]]; then email="$PTM_MCP_EMAIL"; else email="$(read_value 'E-mail de identidade')"; fi
[[ "$url" =~ ^https?://[^[:space:]]+/mcp/?$ ]] || { echo 'Informe uma URL HTTP(S) terminada em /mcp.' >&2; exit 1; }
[[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo 'E-mail inválido.' >&2; exit 1; }

echo 'Clientes: [c]odex, [l]claude ou [a]mbos'
if [[ -n "${PTM_MCP_CLIENTS:-}" ]]; then clients="$PTM_MCP_CLIENTS"; else clients="$(read_value 'Escolha' 'a')"; fi
case "$clients" in
  c|l|a) ;;
  *) echo 'Escolha c, l ou a.' >&2; exit 1 ;;
esac
if [[ "$clients" == l || "$clients" == a ]]; then
  command -v python3 >/dev/null || { echo 'Python 3 é necessário para configurar o Claude Code.' >&2; exit 1; }
  command -v claude >/dev/null || { echo 'Claude Code CLI não encontrado; instale-o antes de selecioná-lo.' >&2; exit 1; }
fi
if [[ "$clients" == c || "$clients" == a ]]; then
  command -v python3 >/dev/null || { echo 'Python 3 é necessário para atualizar config.toml com segurança.' >&2; exit 1; }
fi

configure_codex() {
  command -v python3 >/dev/null || { echo 'Python 3 é necessário para atualizar config.toml com segurança.' >&2; exit 1; }
  local config="$HOME/.codex/config.toml"
  mkdir -p "$(dirname "$config")"
  python3 - "$config" "$SERVER_NAME" "$url" "$email" <<'PY'
import datetime
import json
import os
import pathlib
import re
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
name, url, email = sys.argv[2:]
content = path.read_text() if path.exists() else ""
escaped = re.escape(name)
pattern = re.compile(
    rf"(?ms)^\[mcp_servers\.{escaped}(?:\.[^\]\r\n]+)?\][ \t]*\r?\n.*?(?=^\[|\Z)"
)
content = pattern.sub("", content).rstrip()
section = (
    f"[mcp_servers.{name}]\n"
    f"url = {json.dumps(url)}\n"
    f"http_headers = {{ \"X-Project-Tasks-Email\" = {json.dumps(email)} }}\n"
    "startup_timeout_sec = 20"
)
updated = (content + "\n\n" if content else "") + section + "\n"
if path.exists():
    backup = path.with_name(path.name + ".bak-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S%f"))
    backup.write_bytes(path.read_bytes())
    mode = path.stat().st_mode
else:
    mode = 0o600
fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
try:
    with os.fdopen(fd, "w") as temp:
        temp.write(updated)
    os.chmod(temp_name, mode)
    os.replace(temp_name, path)
except BaseException:
    try:
        os.unlink(temp_name)
    except FileNotFoundError:
        pass
    raise
print(f"Codex configurado em {path}")
PY
}

configure_claude() {
  local configuration
  configuration="$(python3 - "$url" "$email" <<'PY'
import json, sys
print(json.dumps({"type": "http", "url": sys.argv[1], "headers": {"X-Project-Tasks-Email": sys.argv[2]}}, separators=(",", ":")))
PY
)"
  claude mcp remove "$SERVER_NAME" --scope user >/dev/null 2>&1 || true
  claude mcp add-json "$SERVER_NAME" "$configuration" --scope user
  claude mcp get "$SERVER_NAME"
}

if [[ "$clients" == c || "$clients" == a ]]; then configure_codex; fi
if [[ "$clients" == l || "$clients" == a ]]; then configure_claude; fi
echo 'Concluído. Reinicie os clientes MCP para carregar a configuração.'
