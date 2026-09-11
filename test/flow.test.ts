import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connect, Project, Task, Event, Execution, Credential } from '../src/db.js';
import { Service, authenticate, bootstrap, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet;
let service: Service;
let human: Actor, agent: Actor, rival: Actor, other: Actor, reader: Actor;
let agentToken: string, humanToken: string;
const op = () => randomUUID();
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('flow'));
  service = new Service();
  humanToken = await bootstrap('owner'); human = await authenticate(humanToken, 'human');
  async function issue(userId: string) {
    const token = randomBytes(32).toString('hex');
    await service.admin(human, { action: 'issue', operationId: op(), userId, scope: 'agent', token });
    return { token, actor: await authenticate(token, 'agent') };
  }
  const owner = await issue('owner'); agent = owner.actor; agentToken = owner.token;
  rival = (await issue('owner')).actor;
  other = (await issue('other')).actor; reader = (await issue('reader')).actor;
});
after(async () => { await mongoose.disconnect(); await repl?.stop(); });
async function fixture() {
  const repo = op();
  const p = await service.call(agent, 'create_project', { operationId: op(), data: { name: 'Project', description: 'Description', instructions: 'Use focused tests', repositories: [{ id: repo, name: 'backend', url: 'https://example.com/repo.git', instructions: 'Local checkout only' }] } });
  const f = await service.call(agent, 'create_feature', { operationId: op(), projectId: p._id, data: { name: 'Feature', objective: 'Deliver', context: 'Context', acceptance: ['Works'] } });
  const create = (name: string, dependencies: string[] = [], area = 'backend') => service.call(agent, 'create_task', { operationId: op(), projectId: p._id, data: { name, instructions: 'Implement', acceptance: ['Works'], priority: 1, area, repositoryId: repo, featureId: f._id, dependencies } });
  return { p, f, create };
}
const claim = (p: any, t: any, who = agent, operationId = op()) => service.call(who, 'claim_task', { operationId, projectId: p._id, taskId: t._id, version: t.version, agent: 'Codex' });
const active = (p: any, t: any) => ({ operationId: op(), projectId: p._id, taskId: t._id, executionId: t.executionId, version: t.version });
const result = { summary: 'Implemented', changedFiles: ['src/example.ts'], checksRun: ['focused test'], checksOmitted: ['global build not requested'], evidence: ['assertions passed'], branch: 'feature/example' };
const review = (p: any, t: any, decision: string) => service.admin(human, { action: 'review', operationId: op(), projectId: p._id, taskId: t._id, version: t.version, decision, reason: 'Human verification' });
test('complete backend -> human approval -> frontend, history and persistence', async () => {
  const { p, f, create } = await fixture();
  let back = await create('Back'); let front = await create('Front', [back._id], 'frontend');
  await assert.rejects(claim(p, front), /Dependencies/);
  back = await claim(p, back);
  back = await service.call(agent, 'submit_task', { ...active(p, back), result });
  await assert.rejects(claim(p, front), /Dependencies/);
  back = await review(p, back, 'approve');
  front = await claim(p, front);
  front = await service.call(agent, 'submit_task', { ...active(p, front), result });
  await review(p, front, 'approve');
  assert.equal((await service.call(agent, 'get_summary', { projectId: p._id, featureId: f._id })).completed, true);
  await mongoose.disconnect(); await connect(repl.getUri('flow')); service = new Service();
  const context = await service.call(agent, 'get_task_context', { projectId: p._id, taskId: front._id });
  assert.equal(context.dependencies[0].execution.result.summary, 'Implemented');
  assert.equal(context.task.status, 'concluida');
  assert.equal(await Event.countDocuments({ entityId: front._id, action: 'approve' }), 1);
});
test('atomic claim, idempotent concurrent retries and stale versions', async () => {
  const { p, create } = await fixture(); const t = await create('Race');
  const outcomes = await Promise.allSettled([claim(p, t, agent), claim(p, t, rival)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await Execution.countDocuments({ taskId: t._id }), 1);
  const t2 = await create('Retry'); const operationId = op();
  const [a, b] = await Promise.all([claim(p, t2, agent, operationId), claim(p, t2, agent, operationId)]);
  assert.equal(a.executionId, b.executionId);
  assert.equal(await Event.countDocuments({ entityId: t2._id, action: 'claim_task' }), 1);
  await assert.rejects(service.call(agent, 'claim_task', { operationId, projectId: p._id, taskId: t2._id, version: t2.version, agent: 'Changed' }), /reused/);
  await assert.rejects(service.call(rival, 'heartbeat_task', active(p, a)), /another credential/);
  const progressed = await service.call(agent, 'record_progress', { ...active(p, a), message: 'Progress' });
  await assert.rejects(service.call(agent, 'heartbeat_task', active(p, a)), /version conflict/);
  assert.equal(progressed.version, a.version + 1);
});
test('cycles, cross-project dependencies and concurrent graph write skew rejected', async () => {
  const { p, create } = await fixture(); const a = await create('A'); const b = await create('B', [a._id]);
  await assert.rejects(service.call(agent, 'edit_record', { operationId: op(), projectId: p._id, kind: 'task', id: a._id, version: a.version, data: { dependencies: [b._id] } }), /cycle/);
  const foreign = await fixture(); const remote = await foreign.create('Remote');
  await assert.rejects(create('Invalid', [remote._id]), /different project/);
  const c = await create('C'); const d = await create('D');
  const edits = await Promise.allSettled([[c, d], [d, c]].map(([x, y]) => service.call(agent, 'edit_record', { operationId: op(), projectId: p._id, kind: 'task', id: x._id, version: x.version, data: { dependencies: [y._id] } })));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1);
});
test('expiry blocks, rejects old updates and requires explicit recovery', async () => {
  const { p, create } = await fixture(); let t = await claim(p, await create('Expires'));
  const old = t;
  await Task.updateOne({ _id: t._id }, { leaseUntil: new Date(0) });
  await assert.rejects(service.call(agent, 'submit_task', { ...active(p, t), result }), /expired/);
  await Promise.all([service.expire(), service.expire()]);
  t = (await Task.findById(t._id).lean())!;
  assert.equal(t.status, 'bloqueada');
  assert.equal(await Event.countDocuments({ entityId: t._id, action: 'expired' }), 1);
  await assert.rejects(claim(p, t), /unavailable/);
  t = await review(p, t, 'unblock'); t = await claim(p, t);
  assert.notEqual(t.executionId, old.executionId);
  await assert.rejects(service.call(agent, 'heartbeat_task', { ...active(p, t), executionId: old.executionId }), /inactive/);
  assert.equal(await Execution.countDocuments({ taskId: t._id }), 2);
});
test('changes preserve evidence, block/unblock and cancellation', async () => {
  const { p, create } = await fixture(); let t = await claim(p, await create('Changes'));
  t = await service.call(agent, 'submit_task', { ...active(p, t), result }); const oldExecution = t.executionId;
  t = await review(p, t, 'changes'); t = await claim(p, t);
  assert.equal((await Execution.findById(oldExecution))!.result.evidence[0], 'assertions passed');
  t = await service.call(agent, 'block_task', { ...active(p, t), reason: 'Need API' });
  await assert.rejects(service.call(agent, 'heartbeat_task', active(p, t)), /inactive/);
  t = await review(p, t, 'unblock'); t = await review(p, t, 'cancel');
  await service.call(agent, 'archive_record', { operationId: op(), projectId: p._id, kind: 'task', id: t._id, version: t.version });
  assert.equal((await Task.findById(t._id))!.archived, true);
});
test('project permissions, reader restrictions, human scope and revocation', async () => {
  const { p, create } = await fixture(); let t = await create('Secret');
  await assert.rejects(service.call(other, 'get_task_context', { projectId: p._id, taskId: t._id }), /access denied/);
  const projects = await service.call(other, 'list_records', { kind: 'project' }); assert.equal(projects.items.length, 0);
  await service.admin(human, { action: 'member', operationId: op(), projectId: p._id, version: (await Project.findById(p._id))!.version, userId: reader.userId, role: 'leitor' });
  assert.equal((await service.call(reader, 'get_task_context', { projectId: p._id, taskId: t._id })).task._id, t._id);
  await assert.rejects(claim(p, t, reader), /access denied/);
  await assert.rejects(service.admin(agent, { action: 'review', operationId: op(), projectId: p._id, taskId: t._id, version: t.version, decision: 'approve', reason: 'No' }), /Human/);
  await assert.rejects(authenticate(agentToken, 'human'), /scope/);
  const token = randomBytes(32).toString('hex');
  const issued = await service.admin(human, { action: 'issue', operationId: op(), userId: 'revoked', scope: 'agent', token });
  await service.admin(human, { action: 'revoke', operationId: op(), credentialId: issued.credentialId });
  await assert.rejects(authenticate(token, 'agent'), /credential/);
  assert.equal(await Credential.countDocuments({ hash: token }), 0);
});
test('MCP real HTTP handshake, tool listing, tool call and endpoint boundaries', async () => {
  const server = createApp(service, ['https://trusted.internal']).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'flow-test', version: '1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const listed = await client.listTools(); assert.ok(listed.tools.some(t => t.name === 'claim_task'));
    assert.ok(!listed.tools.some(t => /approve|review/.test(t.name)));
    const response = await client.callTool({ name: 'list_records', arguments: { kind: 'project', limit: 1 } });
    assert.ok(!response.isError);
    assert.equal((await fetch(`${url}/admin`, { method: 'POST', headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${url}/mcp`)).status, 405);
  } finally { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('cooperative task messages are durable, scoped and idempotent', async () => {
  const { p, f, create } = await fixture();
  let back = await create('Back'); const front = await create('Front', [], 'frontend');
  back = await claim(p, back);
  const messageArgs = { ...active(p, back), relatedTaskId: front._id, type: 'contrato', message: 'API contract: POST /items returns 201', references: ['src/items.ts'] };
  const sent = await service.call(agent, 'send_task_message', messageArgs);
  const retried = await service.call(agent, 'send_task_message', messageArgs);
  assert.equal(sent._id, retried._id);
  assert.equal(await Event.countDocuments({ projectId: p._id, action: 'task_message' }), 1);
  const listed = await service.call(agent, 'list_task_messages', { projectId: p._id, taskId: front._id, limit: 10 });
  assert.equal(listed.items.length, 1);
  assert.match((await service.call(agent, 'get_task_context', { projectId: p._id, taskId: front._id })).messages[0].message, /API contract/);
  await assert.rejects(service.call(other, 'list_task_messages', { projectId: p._id, taskId: front._id }), /access denied/);
});
test('pagination, direct records, immutable archival retries and human queries', async () => {
  const { p, f, create } = await fixture();
  const tasks = await Promise.all([create('One'), create('Two'), create('Three')]);
  const first = await service.call(agent, 'list_records', { kind: 'task', projectId: p._id, limit: 2 });
  const second = await service.call(agent, 'list_records', { kind: 'task', projectId: p._id, limit: 2, after: first.next });
  assert.equal(new Set([...first.items, ...second.items].map(t => t._id)).size, 3);
  assert.equal(second.next, null);
  const project = await service.call(agent, 'get_record', { projectId: p._id, kind: 'project', id: p._id });
  assert.equal(project.version, 0, 'Child operations must not change the public project version');
  assert.equal((await service.query(human, 'get_task_context', { projectId: p._id, taskId: tasks[0]._id })).task._id, tasks[0]._id);
  await assert.rejects(service.query(human, 'claim_task', { operationId: op(), projectId: p._id, taskId: tasks[0]._id, version: 0, agent: 'Human' }), /Read-only/);
  const history1 = await service.call(agent, 'get_history', { projectId: p._id, limit: 2 });
  const history2 = await service.call(agent, 'get_history', { projectId: p._id, limit: 2, after: history1.next });
  assert.ok(new Date(history1.items.at(-1).at) <= new Date(history2.items[0].at));
  await assert.rejects(service.call(other, 'get_record', { projectId: p._id, kind: 'feature', id: f._id }), /access denied/);
  for (const t of tasks) await review(p, t, 'cancel');
  assert.equal((await service.call(agent, 'get_summary', { projectId: p._id, featureId: f._id })).completed, false);
  const args = { operationId: op(), projectId: p._id, kind: 'project', id: p._id, version: 0 };
  const archived = await service.call(agent, 'archive_record', args);
  assert.deepEqual(await service.call(agent, 'archive_record', args), archived);
  assert.equal(await Event.countDocuments({ entityId: p._id, action: 'archive_record' }), 1);
});
