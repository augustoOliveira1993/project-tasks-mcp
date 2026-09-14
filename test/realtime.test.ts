import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connect, DeliveryEvent, AutomationJob, Task, Execution, Event } from '../src/db.js';
import { Service, bootstrap, authenticate, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet; let service: Service; let human: Actor; let agent: Actor; let rival: Actor;
let agentToken: string; let rivalToken: string;
const op = randomUUID;
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await connect(repl.getUri('realtime'));
  service = new Service(); service.events.start();
  human = await authenticate(await bootstrap('owner'), 'human');
  agentToken = randomBytes(32).toString('hex'); rivalToken = randomBytes(32).toString('hex');
  for (const token of [agentToken, rivalToken]) await service.admin(human, { action: 'issue', operationId: op(), userId: 'owner', scope: 'agent', token });
  agent = await authenticate(agentToken, 'agent'); rival = await authenticate(rivalToken, 'agent');
});
after(async () => { await service.events.close(); await mongoose.disconnect(); await repl.stop(); });
async function fixture() {
  const repositoryId = op();
  const p = await service.call(agent, 'create_project', { operationId: op(), data: { name: 'Realtime', description: 'Test', instructions: 'Focused', repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/repo', instructions: 'Local' }] } });
  const f = await service.call(agent, 'create_feature', { operationId: op(), projectId: p._id, data: { name: 'F', objective: 'Test', context: 'Test', acceptance: ['Works'] } });
  const create = (name: string, dependencies: string[] = []) => service.call(agent, 'create_task', { operationId: op(), projectId: p._id, data: { name, instructions: 'Test', acceptance: ['Works'], repositoryId, featureId: f._id, area: 'backend', priority: 1, dependencies } });
  const policy = (enabled = true) => service.admin(human, { action: 'automation_policy', operationId: op(), projectId: p._id, version: 0, enabled, routes: [{ repositoryId, area: 'backend', provider: 'codex' }] });
  const release = (t: any) => service.admin(human, { action: 'automation_release', operationId: op(), projectId: p._id, taskId: t._id, version: t.version });
  const register = (who = agent, maxConcurrent = 2) => service.automation.runner(who, { action: 'register', operationId: op(), machineId: op(), providers: ['codex', 'claude'], repositories: [repositoryId], maxConcurrent });
  const reserve = (runner: any, who = agent) => service.automation.runner(who, { action: 'reserve', operationId: op(), projectId: p._id, runnerId: runner._id });
  return { p, f, create, policy, release, register, reserve };
}
const taskCall = (job: any, tool: string, args: any = {}, who = agent) => service.automation.runner(who, { action: 'task_call', projectId: job.projectId, runnerId: job.runnerId, jobId: job._id, tool, arguments: { projectId: job.projectId, taskId: job.taskId, ...args } });
const claim = (job: any, version = 0) => taskCall(job, 'claim_task', { operationId: op(), version, agent: job.provider });
const result = { summary: 'Done', changedFiles: [], checksRun: ['focused'], checksOmitted: [], evidence: ['passed'] };

test('durable cursors wait without repeats, validate scope and wake both tasks across instances', async () => {
  const { p, create } = await fixture(); const back = await create('back'); const front = await create('front', [back._id]);
  const second = new Service(); second.events.start();
  try {
    const filter = { projectId: p._id, taskIds: [front._id], actions: ['task_message'] };
    const subscribed = await second.call(agent, 'subscribe_project_events', filter);
    const waiting = second.call(agent, 'wait_project_events', { ...filter, cursor: subscribed.cursor, timeoutMs: 3000 });
    const t = await service.call(agent, 'claim_task', { operationId: op(), projectId: p._id, taskId: back._id, version: back.version, agent: 'codex' });
    const args = { operationId: op(), projectId: p._id, taskId: back._id, executionId: t.executionId, version: t.version, relatedTaskId: front._id, type: 'contrato', message: 'Contract', references: [] };
    await service.call(agent, 'send_task_message', args); await service.call(agent, 'send_task_message', args);
    const events = await waiting; assert.equal(events.items.length, 1); assert.deepEqual(new Set(events.items[0].taskIds), new Set([back._id, front._id]));
    const empty = await service.call(agent, 'wait_project_events', { ...filter, cursor: events.cursor, timeoutMs: 20 }); assert.equal(empty.items.length, 0);
    await assert.rejects(service.call(agent, 'wait_project_events', { ...filter, taskIds: [back._id], cursor: events.cursor, timeoutMs: 0 }), /cursor/);
    const legacy = await service.call(agent, 'wait_task_events', { projectId: p._id, taskId: back._id, timeoutMs: 0 });
    const incremental = await service.call(agent, 'wait_task_events', { projectId: p._id, taskId: back._id, after: legacy.messageCursor, eventAfter: legacy.eventCursor, timeoutMs: 20 });
    assert.equal(incremental.events.length, 0); assert.equal(incremental.items.length, 0); assert.ok(incremental.eventCursor);
  } finally { await second.events.close(); }
});

test('rollback does not publish and committed feed survives consumer restart', async () => {
  const { p } = await fixture(); const start = await service.call(agent, 'subscribe_project_events', { projectId: p._id });
  await assert.rejects(service.mutate(agent, 'test_rollback', { operationId: op(), projectId: p._id }, async s => { await service.event(s, agent, 'rollback', p._id, p._id, {}); throw new Error('rollback'); }), /rollback/);
  assert.equal(await DeliveryEvent.countDocuments({ projectId: p._id, action: 'rollback' }), 0);
  await service.mutate(agent, 'test_commit', { operationId: op(), projectId: p._id }, async s => { await service.event(s, agent, 'committed', p._id, p._id, {}); return { committed: true }; });
  const replacement = new Service();
  const events = await replacement.call(agent, 'wait_project_events', { projectId: p._id, cursor: start.cursor, timeoutMs: 0 }); assert.equal(events.items[0].action, 'committed');
});

test('human release, dependency approval, atomic reservation and managed mutation ownership', async () => {
  const f = await fixture(); const back = await f.create('back'); const front = await f.create('front', [back._id]);
  await f.policy(); await f.release(back); await f.release(front);
  const r1 = await f.register(); const r2 = await f.register(rival);
  const reservations = await Promise.all([f.reserve(r1), f.reserve(r2, rival)]);
  assert.equal(reservations.filter(Boolean).length, 1);
  const job = reservations.find(Boolean); const who = job.runnerId === r1._id ? agent : rival;
  let t = await taskCall(job, 'claim_task', { operationId: op(), version: 0, agent: 'codex' }, who);
  await assert.rejects(service.call(who, 'heartbeat_task', { operationId: op(), projectId: f.p._id, taskId: t._id, executionId: t.executionId, version: t.version }), /requires its runner/);
  await assert.rejects(taskCall(job, 'heartbeat_task', { operationId: op(), executionId: t.executionId, version: t.version }, who === agent ? rival : agent), /another credential/);
  const submission = { operationId: op(), executionId: t.executionId, version: t.version, result };
  t = await taskCall(job, 'submit_task', submission, who);
  assert.equal((await taskCall(job, 'submit_task', submission, who)).version, t.version);
  assert.equal(await f.reserve(r1), null);
  await service.admin(human, { action: 'review', operationId: op(), projectId: f.p._id, taskId: t._id, version: t.version, decision: 'approve', reason: 'OK' });
  assert.equal((await f.reserve(r1)).taskId, front._id);
});

test('scope edits invalidate release; expired reservations cannot revive executions', async () => {
  const f = await fixture(); let t = await f.create('scope'); await f.policy(); await f.release(t); const runner = await f.register();
  t = await service.call(agent, 'edit_record', { operationId: op(), projectId: f.p._id, kind: 'task', id: t._id, version: t.version, data: { instructions: 'Changed' } });
  assert.equal(await f.reserve(runner), null);
  await f.release(t); const job = await f.reserve(runner); const execution = await claim(job, t.version);
  await AutomationJob.updateOne({ _id: job._id }, { reservationUntil: new Date(0) });
  await service.automation.runner(agent, { action: 'heartbeat', operationId: op(), runnerId: runner._id });
  await service.automation.expire();
  assert.equal((await Task.findById(t._id))!.status, 'bloqueada');
  assert.equal((await Execution.findById(execution.executionId))!.status, 'expired');
  await assert.rejects(taskCall(job, 'heartbeat_task', { operationId: op(), version: execution.version, executionId: execution.executionId }), /inactive/);
});

test('consultations can answer a blocked dependency without acquiring a write lease', async () => {
  const f = await fixture(); const back = await f.create('back'); const front = await f.create('front', [back._id]); await f.policy(); await f.release(front);
  const activeBack = await service.call(agent, 'claim_task', { operationId: op(), projectId: f.p._id, taskId: back._id, version: 0, agent: 'manual' });
  await service.call(agent, 'send_task_message', { operationId: op(), projectId: f.p._id, taskId: back._id, relatedTaskId: front._id, executionId: activeBack.executionId, version: activeBack.version, type: 'pergunta', message: 'Which contract?' });
  const runner = await f.register(); const consultation = await f.reserve(runner);
  assert.equal(consultation.mode, 'consultation'); assert.equal((await Task.findById(front._id))!.status, 'pendente');
  await assert.rejects(claim(consultation), /read-only/);
  await taskCall(consultation, 'send_collaboration_message', { operationId: op(), type: 'resposta', relatedTaskId: back._id, replyTo: consultation.triggerMessageId, message: 'Use the documented contract' });
  assert.equal(await AutomationJob.countDocuments({ taskId: back._id, mode: 'consultation' }), 0);
});

test('session reuse requires the same bearer identity on POST, GET and DELETE', async () => {
  const app = createApp(service, []); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(transport);
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await fetch(url, { method, headers: { authorization: `Bearer ${rivalToken}`, 'mcp-session-id': transport.sessionId!, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, ...(method === 'POST' ? { body: JSON.stringify({ jsonrpc: '2.0', id: 50, method: 'tools/list' }) } : {}) });
      assert.equal(response.status, 403); await response.text();
    }
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('capacity, turn budget, human permissions and uncertain turns are enforced by the server', async () => {
  const f = await fixture(); const task = await f.create('budget'); await f.policy(); await f.release(task); const runner = await f.register(agent, 1); const job = await f.reserve(runner);
  const second = await f.create('second'); await f.release(second); assert.equal(await f.reserve(runner), null);
  await claim(job);
  const target = { projectId: f.p._id, runnerId: runner._id, jobId: job._id };
  await service.automation.runner(agent, { action: 'turn', operationId: op(), ...target });
  await assert.rejects(service.automation.runner(agent, { action: 'turn', operationId: op(), ...target }), /uncertain/);
  await service.automation.runner(agent, { action: 'checkpoint', operationId: op(), ...target, turnCompleted: true });
  const permission = await service.automation.runner(agent, { action: 'permission', operationId: op(), ...target, request: { id: 'request-1', title: 'Command', detail: 'A concrete command' } });
  await assert.rejects(service.admin(agent, { action: 'automation_resolve', operationId: op(), projectId: f.p._id, jobId: job._id, version: permission.version, decision: 'allow', reason: 'No' }), /Human/);
  await assert.rejects(service.automation.runner(agent, { action: 'turn', operationId: op(), ...target }), /permission pending/);
  await service.admin(human, { action: 'automation_resolve', operationId: op(), projectId: f.p._id, jobId: job._id, version: permission.version, decision: 'deny', reason: 'Denied' });
  await AutomationJob.updateOne({ _id: job._id }, { turns: 10 });
  await assert.rejects(service.automation.runner(agent, { action: 'turn', operationId: op(), ...target }), /budget/);
  await service.admin(human, { action: 'automation_policy', operationId: op(), projectId: f.p._id, version: 1, enabled: false, routes: [] });
  assert.equal((await service.automation.runner(agent, { action: 'inspect', ...target })).suspended, true);
});

test('usage checkpoint is idempotent and revocation cuts off an established runner', async () => {
  const localToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'owner', scope: 'agent', token: localToken });
  const who = await authenticate(localToken, 'agent');
  const f = await fixture(); await f.policy(); await f.release(await f.create('usage')); const runner = await f.register(who); const job = await f.reserve(runner, who);
  const target = { projectId: f.p._id, runnerId: runner._id, jobId: job._id };
  await assert.rejects(service.automation.runner(who, { action: 'turn', operationId: op(), ...target }), /Claim task/);
  await taskCall(job, 'claim_task', { operationId: op(), version: 0, agent: 'codex' }, who);
  await service.automation.runner(who, { action: 'turn', operationId: op(), ...target });
  const checkpoint = { action: 'checkpoint', operationId: op(), ...target, turnCompleted: true, usage: { inputTokens: 100, outputTokens: 20, costUsd: null } };
  await service.automation.runner(who, checkpoint); await service.automation.runner(who, checkpoint);
  assert.equal((await AutomationJob.findById(job._id))!.usage.inputTokens, 100);
  await assert.rejects(service.automation.runner(who, { ...checkpoint, operationId: op() }), /outstanding turn/);
  await service.admin(human, { action: 'revoke', operationId: op(), credentialId: who.id });
  await assert.rejects(service.automation.runner(who, { action: 'inspect', ...target }), /revoked/);
  await assert.rejects(service.call(who, 'get_task_context', { projectId: f.p._id, taskId: job.taskId }), /revoked/);
});

test('project capacity allows ten reservations across machines and rejects the eleventh', async () => {
  const f = await fixture(); await f.policy();
  for (let i = 0; i < 11; i++) await f.release(await f.create(`task-${i}`));
  const runners = []; for (let i = 0; i < 6; i++) runners.push(await f.register());
  const first = await Promise.all(runners.slice(0, 5).map(r => f.reserve(r)));
  const second = await Promise.all(runners.slice(0, 5).map(r => f.reserve(r)));
  assert.equal(new Set([...first, ...second].map(j => j._id)).size, 10);
  assert.equal(await f.reserve(runners[5]), null);
});

test('50 HTTP clients receive committed events within the initial p95 target', { skip: !process.env.PTM_LOAD_TEST, timeout: 60000 }, async () => {
  const f = await fixture(); const app = createApp(service, []); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const url = new URL(`http://127.0.0.1:${(server.address() as any).port}/mcp`);
  const clients: Client[] = [];
  const parse = (r: any) => { assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
  try {
    const subscriptions = await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      const client = new Client({ name: `load-${i}`, version: '1' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
      const subscribed = parse(await client.callTool({ name: 'subscribe_project_events', arguments: { projectId: f.p._id, actions: ['load_event'] } }));
      return { client, cursor: subscribed.cursor };
    }));
    let committed = performance.now();
    const deliveries = subscriptions.map(async ({ client, cursor }) => {
      const events = parse(await client.callTool({ name: 'wait_project_events', arguments: { projectId: f.p._id, actions: ['load_event'], cursor, timeoutMs: 10000 } }));
      assert.equal(events.items.length, 1); return performance.now() - committed;
    });
    await new Promise(r => setTimeout(r, 250)); committed = performance.now();
    await service.mutate(agent, 'load', { operationId: op(), projectId: f.p._id }, async s => { await service.event(s, agent, 'load_event', f.p._id, f.p._id, {}); return { committed: true }; });
    const latencies = (await Promise.all(deliveries)).sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * .95) - 1];
    console.log(JSON.stringify({ clients: clients.length, p95Ms: Math.round(p95), maxMs: Math.round(latencies.at(-1)!), node: process.version, platform: process.platform }));
    assert.ok(p95 <= 2000, `p95 ${p95}ms exceeds target`);
  } finally { await Promise.allSettled(clients.map(c => c.close())); await app.locals.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
