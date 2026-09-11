/** Carrega as variáveis locais antes de aplicar os valores padrão de desenvolvimento. */
try {
  process.loadEnvFile('.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}


export const envConfig = {
  MONGODB_URI: 'mongodb://127.0.0.1:27018/project_tasks?replicaSet=rs0',
  PORT: '3443',
  SERVICE_URL: 'http://localhost:3443',
  ALLOWED_ORIGINS: 'http://localhost:3443',
  MCP_AUTH_MODE: 'trusted_local',
  LEASE_MINUTES: '30',
  LOG_LEVEL: 'info',
  MONGOD_PATH: undefined
} as const;