import { envConfig } from './env.config.js';

const required = ['MONGODB_URI', 'PORT', 'SERVICE_URL', 'MCP_AUTH_MODE', 'LEASE_MINUTES'] as const;
const missing = required.filter(key => !envConfig[key]?.trim());
if (missing.length) throw new Error(`Configuração incompleta no .env. Defina: ${missing.join(', ')}.`);

const port = Number(envConfig.PORT);
const leaseMinutes = Number(envConfig.LEASE_MINUTES);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um inteiro entre 1 e 65535.');
if (!Number.isFinite(leaseMinutes) || leaseMinutes <= 0) throw new Error('LEASE_MINUTES deve ser um número positivo.');
if (!['trusted_local', 'bearer'].includes(envConfig.MCP_AUTH_MODE!)) throw new Error('MCP_AUTH_MODE deve ser trusted_local ou bearer.');
if (!!envConfig.TLS_CERT_PATH !== !!envConfig.TLS_KEY_PATH) throw new Error('TLS_CERT_PATH e TLS_KEY_PATH devem ser definidos juntos.');

export const env = {
  mongodbUri: envConfig.MONGODB_URI!,
  port,
  serviceUrl: envConfig.SERVICE_URL!,
  allowedOrigins: (envConfig.ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean),
  authMode: envConfig.MCP_AUTH_MODE! as 'trusted_local' | 'bearer',
  tlsCertPath: envConfig.TLS_CERT_PATH,
  tlsKeyPath: envConfig.TLS_KEY_PATH,
  leaseMinutes,
  logLevel: envConfig.LOG_LEVEL ?? 'info',
  mongodPath: envConfig.MONGOD_PATH
};
