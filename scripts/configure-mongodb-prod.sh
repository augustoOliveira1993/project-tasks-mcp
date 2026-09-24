#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="${MONGOD_CONFIG:-/etc/mongod.conf}"
SERVICE="mongod"
DEFAULT_KEYFILE="/etc/mongodb-keyfile"

die() { printf 'Erro: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

require_linux_tools() {
  [[ "$(uname -s)" == Linux ]] || die 'Este script deve ser executado no Ubuntu/Linux.'
  command -v python3 >/dev/null || die 'Instale Python 3 antes de continuar.'
  command -v systemctl >/dev/null || die 'systemd/systemctl não foi encontrado.'
  [[ -r "$CONFIG_FILE" ]] || die "Não consegui ler $CONFIG_FILE. Confira MONGOD_CONFIG e a instalação do MongoDB."
}

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Execute como root: sudo bash $0"
}

read_config() {
  python3 - "$CONFIG_FILE" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
lines = text.splitlines()

def scalar(section, key, default=""):
    headers = [i for i, line in enumerate(lines) if re.match(rf"^{re.escape(section)}:\s*(?:#.*)?$", line)]
    if len(headers) > 1:
        raise SystemExit(f"Configuração ambígua: bloco {section}: duplicado.")
    if not headers:
        return default
    start = headers[0] + 1
    end = next((i for i in range(start, len(lines)) if re.match(r"^[^\s#][^:]*:\s*", lines[i])), len(lines))
    matches = [re.match(rf"^  {re.escape(key)}:\s*(.*?)\s*(?:#.*)?$", lines[i]) for i in range(start, end)]
    values = [m.group(1).strip().strip("\"'") for m in matches if m]
    if len(values) > 1:
        raise SystemExit(f"Configuração ambígua: {section}.{key} duplicado.")
    return values[0] if values else default

port = scalar("net", "port", "27017")
if not port.isdigit() or not (1 <= int(port) <= 65535):
    raise SystemExit("net.port deve ser uma porta TCP válida.")
for key, value in (
    ("MONGOD_PORT", port),
    ("AUTHORIZATION", scalar("security", "authorization", "não configurada")),
    ("KEYFILE", scalar("security", "keyFile")),
    ("REPLICA_SET", scalar("replication", "replSetName")),
    ("BIND_IP", scalar("net", "bindIp", "não configurado")),
    ("BIND_IP_ALL", scalar("net", "bindIpAll", "false")),
):
    print(f"{key}={value}")
PY
}

diagnose() {
  require_linux_tools
  info 'Estado do MongoDB'
  systemctl show "$SERVICE" --property=LoadState,ActiveState,SubState --no-pager || true
  local values
  values="$(read_config)" || die 'Não foi possível interpretar as opções necessárias do mongod.conf.'
  printf '%s\n' "$values" | while IFS='=' read -r key value; do
    case "$key" in
      MONGOD_PORT) printf 'Porta: %s\n' "$value" ;;
      AUTHORIZATION) printf 'Autenticação: %s\n' "$value" ;;
      KEYFILE) [[ -n "$value" ]] && printf 'KeyFile: configurado (%s)\n' "$value" || printf 'KeyFile: ausente\n' ;;
      REPLICA_SET) [[ -n "$value" ]] && printf 'Replica set: %s\n' "$value" || printf 'Replica set: ausente\n' ;;
      BIND_IP) printf 'bindIp: %s\n' "$value" ;;
      BIND_IP_ALL) if [[ "$value" == true ]]; then printf 'bindIpAll: true\n'; fi ;;
    esac
  done
  if command -v ss >/dev/null; then
    printf '\nPortas Mongo em escuta:\n'
    ss -lntp 2>/dev/null | awk 'NR == 1 || /:27017|:27018/' || true
  fi
}

patch_config() {
  local target="$1" keyfile="$2"
  python3 - "$target" "$keyfile" <<'PY'
import re
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
keyfile = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines()

def set_values(section, values, remove=()):
    global lines
    headers = [i for i, line in enumerate(lines) if re.match(rf"^{re.escape(section)}:\s*(?:#.*)?$", line)]
    if len(headers) > 1:
        raise SystemExit(f"Configuração ambígua: bloco {section}: duplicado; arquivo não alterado.")
    if not headers:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(f"{section}:")
        headers = [len(lines) - 1]
    start = headers[0] + 1
    end = next((i for i in range(start, len(lines)) if re.match(r"^[^\s#][^:]*:\s*", lines[i])), len(lines))
    body = lines[start:end]
    for key in remove:
        body = [line for line in body if not re.match(rf"^  {re.escape(key)}:\s*", line)]
    for key, value in values.items():
        indexes = [i for i, line in enumerate(body) if re.match(rf"^  {re.escape(key)}:\s*", line)]
        if len(indexes) > 1:
            raise SystemExit(f"Configuração ambígua: {section}.{key} duplicado; arquivo não alterado.")
        line = f"  {key}: {value}"
        if indexes:
            body[indexes[0]] = line
        else:
            body.append(line)
    lines[start:end] = body

set_values("net", {"bindIp": "127.0.0.1"}, remove=("bindIpAll",))
set_values("security", {"keyFile": json.dumps(keyfile)})
set_values("replication", {"replSetName": "rs0"})
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

configure_all() {
  require_linux_tools
  require_root
  command -v mongosh >/dev/null || die 'Instale o cliente mongosh antes de continuar.'
  command -v openssl >/dev/null || die 'Instale o OpenSSL antes de continuar.'
  command -v mongod >/dev/null || die 'O executável mongod não foi encontrado.'

  local values auth configured_key replica bind_ip bind_all port keyfile backup temp_file username
  values="$(read_config)" || die 'Configuração YAML ambígua ou inválida nas opções usadas pelo script.'
  auth="$(sed -n 's/^AUTHORIZATION=//p' <<<"$values")"
  configured_key="$(sed -n 's/^KEYFILE=//p' <<<"$values")"
  replica="$(sed -n 's/^REPLICA_SET=//p' <<<"$values")"
  bind_ip="$(sed -n 's/^BIND_IP=//p' <<<"$values")"
  bind_all="$(sed -n 's/^BIND_IP_ALL=//p' <<<"$values")"
  port="$(sed -n 's/^MONGOD_PORT=//p' <<<"$values")"

  [[ "$auth" == enabled ]] || die 'A autenticação precisa já estar habilitada (security.authorization: enabled). O script não cria usuários nem habilita auth às cegas.'
  if [[ -n "$replica" && "$replica" != rs0 ]]; then
    die "Já existe outro replSetName ($replica). Nenhuma alteração foi feita."
  fi
  if [[ "$bind_ip" != 127.0.0.1 || "$bind_all" == true ]]; then
    printf 'O Mongo será limitado a 127.0.0.1. Clientes remotos deixarão de conectar; o MCP precisa estar neste mesmo servidor.\n'
    read -r -p 'Confirma? [s/N]: ' answer
    [[ "$answer" =~ ^[sS]$ ]] || die 'Cancelado sem alterar a configuração.'
  fi

  if ! id mongodb >/dev/null 2>&1; then
    die 'Usuário de serviço mongodb não existe; confirme a instalação oficial do MongoDB antes de continuar.'
  fi
  if [[ -n "$configured_key" ]]; then
    keyfile="$configured_key"
    [[ "$keyfile" == /* ]] || die 'O caminho de security.keyFile precisa ser absoluto.'
    [[ -f "$keyfile" ]] || die "O keyFile configurado não existe ($keyfile). Não vou gerar outro e invalidar credenciais internas."
    [[ ! -L "$keyfile" ]] || die 'O keyFile configurado é um link simbólico; inspecione-o manualmente antes de continuar.'
  else
    keyfile="$DEFAULT_KEYFILE"
    [[ ! -e "$keyfile" ]] || die "$keyfile já existe, mas não está configurado. Inspecione-o antes de continuar; nada foi sobrescrito."
  fi

  printf '\nSerá necessário autenticar com um usuário MongoDB existente que possa executar rs.initiate.\n'
  read -r -p 'Usuário MongoDB (authenticationDatabase admin): ' username
  [[ -n "$username" ]] || die 'Usuário não pode ficar vazio.'
  read -r -p 'Digite CONFIGURAR para prosseguir: ' answer
  [[ "$answer" == CONFIGURAR ]] || die 'Cancelado sem alterar a configuração.'

  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${CONFIG_FILE}.bak.${stamp}"
  [[ ! -e "$backup" ]] || die "O backup de destino já existe: $backup"
  cp -a -- "$CONFIG_FILE" "$backup"
  printf 'Backup salvo em: %s\n' "$backup"

  if [[ -z "$configured_key" ]]; then
    umask 077
    openssl rand -base64 756 > "$keyfile" || die 'Falha ao gerar keyFile.'
    chown mongodb:mongodb "$keyfile"
    chmod 400 "$keyfile"
    printf 'KeyFile criado com permissões restritas: %s\n' "$keyfile"
  else
    chown mongodb:mongodb "$keyfile"
    chmod 400 "$keyfile"
    printf 'Permissões do keyFile existente ajustadas para mongodb:mongodb 0400.\n'
  fi

  temp_file="$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")"
  cp -p -- "$CONFIG_FILE" "$temp_file"
  if ! patch_config "$temp_file" "$keyfile"; then
    rm -f -- "$temp_file"
    die "Não consegui atualizar o YAML; backup original preservado em $backup."
  fi
  if ! mongod --config "$temp_file" --outputConfig >/dev/null 2>&1; then
    rm -f -- "$temp_file"
    die "O mongod recusou a configuração temporária. A configuração ativa não foi trocada; backup: $backup"
  fi
  chown --reference="$CONFIG_FILE" "$temp_file"
  chmod --reference="$CONFIG_FILE" "$temp_file"
  mv -- "$temp_file" "$CONFIG_FILE"

  info 'Reiniciando o serviço mongod'
  if ! systemctl restart "$SERVICE"; then
    die "O Mongo não iniciou. Restaure manualmente o backup $backup e reinicie mongod; o script não altera os dados."
  fi

  info 'Aguardando o Mongo aceitar conexões locais'
  local ready=false
  for _ in $(seq 1 30); do
    if [[ "$(mongosh --host 127.0.0.1 --port "$port" --quiet --eval 'db.hello().ok' 2>/dev/null | tail -n 1)" == 1 ]]; then
      ready=true
      break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || die "mongod não ficou pronto. Confira 'sudo journalctl -u mongod -n 80 --no-pager'. Backup: $backup"

  info 'Inicializando o replica set (ou confirmando o existente)'
  printf 'O mongosh pedirá a senha de forma interativa; ela não será salva nem exibida.\n'
  local eval_script
  eval_script="const h = db.hello(); if (h.setName && h.setName !== 'rs0') { print('ERRO: já existe outro replica set: ' + h.setName); quit(3); } if (!h.setName) { printjson(rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:${port}'}]})); } else { print('Replica set rs0 já inicializado.'); } const deadline = Date.now() + 60000; while (Date.now() < deadline) { const state = db.hello(); if (state.setName === 'rs0' && state.isWritablePrimary) { print('rs0 está PRIMARY.'); quit(0); } sleep(1000); } print('ERRO: rs0 não elegeu PRIMARY em 60 segundos.'); quit(4);"
  if ! mongosh --host 127.0.0.1 --port "$port" --username "$username" --authenticationDatabase admin --quiet --eval "$eval_script"; then
    die "Falha na autenticação ou inicialização. Não desabilite auth; confira usuário/permissões. Configuração e backup: $backup"
  fi

  printf '\nConfiguração do Mongo concluída.\n'
  printf "Confira o primary com: mongosh --host 127.0.0.1 --port %s --username <usuario> --authenticationDatabase admin --eval 'db.hello()'\n" "$port"
  printf 'Backup: %s\n' "$backup"
  printf 'Ajuste a MONGODB_URI do MCP manualmente para a porta correta e ?replicaSet=rs0; este script não altera .env.\n'
}

main() {
  case "${1:-}" in
    --diagnose) diagnose ;;
    --configure) configure_all ;;
    "")
      printf 'Configurador MongoDB para Project Tasks MCP\n\n'
      printf '1) Diagnóstico (somente leitura)\n2) Configurar tudo (replica set rs0 e acesso local)\n3) Sair\n'
      read -r -p 'Escolha [1-3]: ' choice
      case "$choice" in
        1) diagnose ;;
        2) configure_all ;;
        3) printf 'Sem alterações.\n' ;;
        *) die 'Opção inválida.' ;;
      esac
      ;;
    *) die "Uso: sudo bash $0 [--diagnose|--configure]" ;;
  esac
}

main "$@"
