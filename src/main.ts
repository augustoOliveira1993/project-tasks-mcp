import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { connect } from './db.js';
import { Service } from './service.js';
import { createApp } from './http.js';

await connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/project_tasks?replicaSet=rs0');
const service = new Service(Number(process.env.LEASE_MINUTES ?? 30) * 60000);
const app = createApp(service, (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean));
const server = createServer(app);
await service.expire();
let sweeping = false;
const timer = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try { await service.expire(); } catch { console.error('Lease expiration sweep failed'); }
  finally { sweeping = false; }
}, 10000);
server.listen(Number(process.env.PORT ?? 3443), '0.0.0.0', () => console.log('project-tasks-mcp HTTP ready'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(timer); server.close(() => { void mongoose.disconnect().then(() => process.exit(0)); });
});