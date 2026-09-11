import { envConfig } from '../env.config.js';

for (const [key, value] of Object.entries(envConfig)) {
  if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
}

const required = ['MONGODB_URI', 'PORT', 'SERVICE_URL', 'MCP_AUTH_MODE', 'LEASE_MINUTES'] as const;
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) throw new Error(`Configuração de ambiente incompleta. Defina: ${missing.join(', ')}.`);

const port = Number(process.env.PORT);
const leaseMinutes = Number(process.env.LEASE_MINUTES);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um inteiro entre 1 e 65535.');
if (!Number.isFinite(leaseMinutes) || leaseMinutes <= 0) throw new Error('LEASE_MINUTES deve ser um número positivo.');
if (!['trusted_local', 'bearer'].includes(process.env.MCP_AUTH_MODE!)) throw new Error('MCP_AUTH_MODE deve ser trusted_local ou bearer.');

export const env = {
  mongodbUri: process.env.MONGODB_URI!,
  port,
  serviceUrl: process.env.SERVICE_URL!,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean),
  authMode: process.env.MCP_AUTH_MODE! as 'trusted_local' | 'bearer',
  leaseMinutes,
  logLevel: process.env.LOG_LEVEL ?? 'info',
  mongodPath: process.env.MONGOD_PATH
};