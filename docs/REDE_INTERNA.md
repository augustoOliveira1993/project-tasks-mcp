# Rede interna

## Servidor AVB-NB-00295

No `.env`:

```dotenv
MONGODB_URI=mongodb://localhost:27018/project_tasks?replicaSet=rs0
PORT=3443
SERVICE_URL=http://AVB-NB-00295:3443
ALLOWED_ORIGINS=http://AVB-NB-00295:3443
MCP_AUTH_MODE=trusted_local
```

```powershell
yarn install --frozen-lockfile
yarn mongo:local
# em outro terminal
yarn start
Invoke-WebRequest http://AVB-NB-00295:3443/health
```

Mantenha MongoDB em localhost. Libere somente TCP 3443 na rede privada.

## Máquinas de desenvolvimento

Cada pessoa configura Codex ou Claude Code no próprio perfil, conforme [CONFIGURACAO_GLOBAL_MCP.md](CONFIGURACAO_GLOBAL_MCP.md). Não rode MongoDB, `yarn mongo:local` ou `yarn start` do MCP nas máquinas de desenvolvimento.

HTTP e `trusted_local` confiam na rede e no cabeçalho de e-mail. Não publique a porta 3443 na internet.
