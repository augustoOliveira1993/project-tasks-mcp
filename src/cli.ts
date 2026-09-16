import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { connect } from './db.js';
import { env } from './env.js';
import { bootstrap, recoverHumanToken, restoreSystemAdminToken } from './service.js';
import { adminSchema } from './schema.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'bootstrap') {
    if (!args[0]) throw new Error('Usage: yarn cli -- bootstrap <userId>');
    await connect(env.mongodbUri);
    try { console.log(JSON.stringify({ token: await bootstrap(args[0]) })); }
    finally { await mongoose.disconnect(); }
    return;
  }
  if (command === 'recover') {
    if (!args[0] || args[1] !== '--confirm') throw new Error('Usage: yarn cli -- recover <userId> --confirm');
    await connect(env.mongodbUri);
    try { console.log(JSON.stringify({ token: await recoverHumanToken(args[0]) })); }
    finally { await mongoose.disconnect(); }
    return;
  }
  if (command === 'restore-system-admin') {
    if (!args[0] || args[1] !== '--confirm') throw new Error('Usage: yarn cli restore-system-admin <userId> --confirm');
    await connect(env.mongodbUri);
    try { console.log(JSON.stringify({ token: await restoreSystemAdminToken(args[0]) })); }
    finally { await mongoose.disconnect(); }
    return;
  }
  let body: any;
  let endpoint = '/admin';
  if (command === 'context') {
    endpoint = '/admin/query';
    body = { tool: 'get_task_context', arguments: { projectId: args[0], taskId: args[1] } };
  } else if (command === 'automation' && args[0]) {
    endpoint = '/admin/query'; body = { tool: 'get_automation_status', arguments: { projectId: args[0] } };
  } else if (command === 'query' && args[0] && args[1]) {
    endpoint = '/admin/query';
    body = { tool: args[0], arguments: JSON.parse(await readFile(args[1], 'utf8')) };
  } else if (command === 'issue') {
    body = { action: 'issue', operationId: randomUUID(), userId: args[0], scope: args[1], token: randomBytes(32).toString('hex') };
  } else if (command === 'apply' && args[0]) body = JSON.parse(await readFile(args[0], 'utf8'));
  else throw new Error('Usage: cli bootstrap <userId> | recover <userId> --confirm | restore-system-admin <userId> --confirm | issue <userId> <agent|human> | apply <operation.json> | context <projectId> <taskId> | query <tool> <arguments.json>');
  if (endpoint === '/admin') adminSchema.parse(body);
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminToken)) throw new Error('ADMIN_TOKEN must be the active 64-character hexadecimal human token; a credentialId UUID or agent token will not work.');
  const url = new URL(endpoint, env.serviceUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP(S) required');
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  console.log(JSON.stringify({ ...await response.json() as object, ...(body.action === 'issue' ? { token: body.token } : {}) }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
