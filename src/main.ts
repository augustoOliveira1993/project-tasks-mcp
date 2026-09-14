import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { env } from './env.js';
import { logger } from './logger.js';
import mongoose from 'mongoose';
import { connect } from './db.js';
import { Service } from './service.js';
import { createApp } from './http.js';

await connect(env.mongodbUri);
const service = new Service(env.leaseMinutes * 60000);
const app = createApp(service, env.allowedOrigins);
const server = env.tlsCertPath && env.tlsKeyPath ? createSecureServer({ cert: await readFile(env.tlsCertPath), key: await readFile(env.tlsKeyPath), minVersion: 'TLSv1.2' }, app) : createServer(app);
await service.expire();
await service.automation.expire();
let sweeping = false;
const timer = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try { await service.expire(); await service.automation.expire(); } catch { logger.error('Lease expiration sweep failed'); }
  finally { sweeping = false; }
}, 10000);
server.listen(env.port, '0.0.0.0', () => logger.info('Project Tasks MCP ready', { event: 'server_ready', port: env.port }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(timer); void app.locals.close().then(() => server.close(() => { void mongoose.disconnect().then(() => process.exit(0)); }));
});
