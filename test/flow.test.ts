import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminPage } from '../src/admin-page.js';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connect, Project, Task, Event, Execution, Credential, TaskMessage, MarkdownDocument, MarkdownRevision, Conversation, ConversationMessage, ConversationRead, ConversationType, ActionProposal } from '../src/db.js';
import { DomainError, Service, authenticate, bootstrap, recoverHumanToken, trustedLocal, type Actor } from '../src/service.js';
import { createApp, mcpError } from '../src/http.js';

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
  assert.equal(back.responsible, 'owner');
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
test('execution diagnosis returns the persisted ID when the reported client ID is truncated', async () => {
  const { p, create } = await fixture(); const task = await claim(p, await create('Recover client ID'));
  const reportedExecutionId = task.executionId.slice(0, -1);
  const diagnosis = await service.call(agent, 'diagnose_task_execution', { projectId: p._id, taskId: task._id, reportedExecutionId });
  assert.equal(diagnosis.classification, 'client_id_mismatch');
  assert.equal(diagnosis.executionId, task.executionId);
  assert.equal(diagnosis.reportedIdMatches, false);
  const operationId = op();
  const args = { operationId, projectId: p._id, taskId: task._id, version: task.version, reason: 'Recover from a truncated client argument' };
  await assert.rejects(service.call(agent, 'recover_task_execution', { ...args, operationId: op(), version: task.version - 1 }), /version conflict/);
  const [recovered, retried] = await Promise.all([
    service.call(agent, 'recover_task_execution', args),
    service.call(agent, 'recover_task_execution', args)
  ]);
  assert.equal(recovered.action, 'resumed');
  assert.equal(recovered.executionId, task.executionId);
  assert.deepEqual(retried, recovered);
  assert.equal(recovered.task.version, task.version);
  assert.equal(await Execution.countDocuments({ taskId: task._id, status: 'em_execucao' }), 1);
  assert.equal(await Event.countDocuments({ entityId: task._id, action: 'recover_task_execution' }), 1);
});
test('execution recovery rekeys a malformed persisted ID without losing the active run', async () => {
  const { p, create } = await fixture(); let task = await claim(p, await create('Recover persisted ID'));
  const previous = await Execution.findById(task.executionId).lean(); assert.ok(previous);
  const malformedId = `broken-${task.executionId.slice(0, 18)}`;
  await Execution.updateOne({ _id: task.executionId }, { $set: { status: 'failed', endedAt: new Date() } });
  await Execution.create([{ ...previous, _id: malformedId, status: 'em_execucao', endedAt: undefined, progress: ['preserve this work'] }]);
  await Task.updateOne({ _id: task._id }, { $set: { executionId: malformedId } });
  task = (await Task.findById(task._id).lean())!;
  const diagnosis = await service.call(agent, 'diagnose_task_execution', { projectId: p._id, taskId: task._id, reportedExecutionId: malformedId });
  assert.equal(diagnosis.classification, 'invalid_persisted_id');
  const recovered = await service.call(agent, 'recover_task_execution', { operationId: op(), projectId: p._id, taskId: task._id, version: task.version, reason: 'Repair malformed stored execution reference' });
  assert.equal(recovered.action, 'rekeyed');
  assert.match(recovered.executionId, /^[0-9a-f-]{36}$/i);
  assert.equal(recovered.task.executionId, recovered.executionId);
  assert.equal((await Execution.findById(recovered.executionId))?.progress[0], 'preserve this work');
  assert.equal((await Execution.findById(malformedId))?.status, 'recovered');
  assert.equal(await Execution.countDocuments({ taskId: task._id, status: 'em_execucao' }), 1);
});
test('execution recovery releases expired runs for a fresh claim and rejects other credentials', async () => {
  const { p, create } = await fixture(); let task = await claim(p, await create('Recover expired run'));
  await assert.rejects(service.call(rival, 'recover_task_execution', { operationId: op(), projectId: p._id, taskId: task._id, version: task.version, reason: 'Wrong credential' }), /another credential/);
  await Task.updateOne({ _id: task._id }, { $set: { leaseUntil: new Date(0) } });
  const recovered = await service.call(agent, 'recover_task_execution', { operationId: op(), projectId: p._id, taskId: task._id, version: task.version, reason: 'The original lease expired' });
  assert.equal(recovered.action, 'released');
  assert.equal(recovered.task.status, 'pendente');
  assert.equal(recovered.executionId, null);
  assert.equal((await Execution.findById(task.executionId))?.status, 'expired');
  const claimed = await claim(p, recovered.task);
  assert.notEqual(claimed.executionId, task.executionId);
  assert.equal(claimed.status, 'em_execucao');
});
test('execution recovery refuses ambiguous active records without partial changes', async () => {
  const { p, create } = await fixture(); const task = await claim(p, await create('Ambiguous recovery'));
  await Execution.create([{ _id: op(), projectId: p._id, taskId: task._id, credentialId: agent.id, userId: agent.userId, agent: 'Codex', startedAt: new Date(), lastActivity: new Date(), status: 'em_execucao', progress: [], impediments: [] }]);
  await assert.rejects(service.call(agent, 'recover_task_execution', { operationId: op(), projectId: p._id, taskId: task._id, version: task.version, reason: 'Should refuse duplicates' }), /Multiple active executions/);
  assert.equal((await Task.findById(task._id))?.version, task.version);
  assert.equal(await Execution.countDocuments({ taskId: task._id, status: 'em_execucao' }), 2);
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
test('planned responsible is configurable before claim and executor identity replaces it', async () => {
  const { p, create } = await fixture(); const task = await create('Assigned task');
  const assigned = await service.call(agent, 'edit_record', { operationId: op(), projectId: p._id, kind: 'task', id: task._id, version: task.version, data: { responsible: 'Equipe PCP' } });
  assert.equal(assigned.responsible, 'Equipe PCP');
  const claimed = await claim(p, assigned);
  assert.equal(claimed.responsible, 'owner');
  assert.equal((await Task.findById(assigned._id))!.responsible, 'owner');
});
test('task context exposes blocked execution impediments and preserves its public fields', async () => {
  const { p, f, create } = await fixture();
  const running = await claim(p, await create('Blocked context'));
  const blocked = await service.call(agent, 'block_task', { ...active(p, running), reason: 'Waiting for API contract' });

  const context = await service.call(agent, 'get_task_context', { projectId: p._id, taskId: blocked._id });

  assert.equal(context.contextMeta.version, 1);
  assert.equal(context.task._id, blocked._id);
  assert.equal(context.task.projectId, p._id);
  assert.equal(context.task.status, 'bloqueada');
  assert.deepEqual(context.task.acceptance, ['Works']);
  assert.equal(context.project._id, p._id);
  assert.equal(context.feature._id, f._id);
  assert.equal(context.executions[0]._id, blocked.executionId);
  assert.equal(context.executions[0].status, 'bloqueada');
  assert.deepEqual(context.executions[0].impediments, ['Waiting for API contract']);
  assert.equal('credentialId' in context.executions[0], false);
});
test('human status override moves blocked tasks to review or completion', async () => {
  const { p, create } = await fixture(); let task = await claim(p, await create('Blocked override'));
  task = await service.call(agent, 'block_task', { ...active(p, task), reason: 'Needs human decision' });
  const reviewed = await service.changeTaskStatus(human, { projectId: p._id, taskId: task._id, status: 'em_revisao', reason: 'Evidence checked manually' });
  assert.equal(reviewed.task.status, 'em_revisao');
  const completed = await service.changeTaskStatus(human, { projectId: p._id, taskId: task._id, status: 'concluida', reason: 'Approved manually' });
  assert.equal(completed.task.status, 'concluida');
  const reopened = await service.changeTaskStatus(human, { projectId: p._id, taskId: task._id, status: 'pendente', reason: 'Work must be redone' });
  assert.equal(reopened.task.status, 'pendente');
  await assert.rejects(service.changeTaskStatus(human, { projectId: p._id, taskId: task._id, status: 'em_execucao', reason: 'Invalid' }), /Invalid option/);
});
test('agent status tool reuses administrative transitions, versions and execution effects', async () => {
  const { p, create } = await fixture(); let task = await claim(p, await create('Agent status transition'));
  task = await service.call(agent, 'block_task', { ...active(p, task), reason: 'Needs human decision' });
  const args = { operationId: op(), projectId: p._id, taskId: task._id, version: task.version, status: 'concluida', reason: 'Evidence reviewed by agent' };
  const completed = await service.call(agent, 'set_task_status', args);
  assert.equal(completed.task.status, 'concluida');
  assert.equal((await Execution.findById(task.executionId)).status, 'approve');
  assert.deepEqual(await service.call(agent, 'set_task_status', args), completed, 'identical retries return the original result');
  assert.equal(await Event.countDocuments({ entityId: task._id, action: 'set_task_status' }), 1);
  await assert.rejects(service.call(agent, 'set_task_status', { ...args, operationId: op(), version: completed.task.version - 1, status: 'pendente' }), /version conflict/);
  await assert.rejects(service.call(agent, 'set_task_status', { ...args, operationId: op(), version: completed.task.version, status: 'cancelada' }), /Invalid administrative status transition/);
  await assert.rejects(service.call(agent, 'set_task_status', { ...args, operationId: op(), version: completed.task.version, status: 'em_execucao' }), /Invalid option/);
});
test('human project readers can mark and unmark task checked without changing status', async () => {
  const { p, create } = await fixture(); const task = await create('Checkable task');
  const initialContext = await service.call(agent, 'get_task_context', { projectId: p._id, taskId: task._id });
  assert.equal(initialContext.task.checked, false); assert.equal(initialContext.task.checkedBy, null); assert.equal(initialContext.task.checkedAt, null);
  const token = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'reviewer', scope: 'human', systemAdmin: false, token });
  let project = await Project.findById(p._id).lean();
  await service.admin(human, { action: 'member', operationId: op(), projectId: p._id, version: project.version, userId: 'reviewer', role: 'leitor' });
  const reviewer = await authenticate(token, 'human');
  const marked = await service.setTaskChecked(reviewer, { operationId: op(), projectId: p._id, taskId: task._id, version: task.version, checked: true });
  assert.equal(marked.task.checked, true); assert.equal(marked.task.checkedBy, 'reviewer'); assert.ok(marked.task.checkedAt);
  assert.equal(marked.task.status, 'pendente');
  const context = await service.query(agent, 'get_task_context', { projectId: p._id, taskId: task._id });
  assert.equal(context.task.checked, true); assert.equal(context.task.checkedBy, 'reviewer');
  const unmarked = await service.setTaskChecked(reviewer, { operationId: op(), projectId: p._id, taskId: task._id, version: marked.task.version, checked: false });
  assert.equal(unmarked.task.checked, false); assert.equal(unmarked.task.checkedBy, 'reviewer'); assert.equal(unmarked.task.status, 'pendente');
  await assert.rejects(service.setTaskChecked(reviewer, { operationId: op(), projectId: p._id, taskId: task._id, version: marked.task.version, checked: true }), /Task version conflict/);
  assert.equal(await Event.countDocuments({ entityId: task._id, action: 'set_task_checked' }), 2);
  const outsiderToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'outsider', scope: 'human', systemAdmin: false, token: outsiderToken });
  const outsider = await authenticate(outsiderToken, 'human');
  await assert.rejects(service.setTaskChecked(outsider, { operationId: op(), projectId: p._id, taskId: task._id, version: unmarked.task.version, checked: true }), /access denied/);
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
test('human bulk approval is atomic and generates its operation ID', async () => {
  const { p, create } = await fixture();
  let first = await create('First'); let second = await create('Second'); const pending = await create('Pending');
  first = await service.call(agent, 'submit_task', { ...active(p, await claim(p, first)), result });
  second = await service.call(agent, 'submit_task', { ...active(p, await claim(p, second)), result });
  const approved = await service.approveTasks(human, { projectId: p._id, taskIds: [first._id, second._id], reason: 'Batch review' });
  assert.match(approved.operationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(approved.tasks.map((task: any) => task.status), ['concluida', 'concluida']);
  await assert.rejects(service.approveTasks(human, { projectId: p._id, taskIds: [pending._id], reason: 'Invalid batch' }), /Only tasks in review/);
  assert.equal((await Task.findById(pending._id))!.status, 'pendente');
});
test('system administrators can administer projects outside their membership', async () => {
  const repositoryId = op();
  const project = await service.call(other, 'create_project', { operationId: op(), data: { name: 'Other', description: 'Other', instructions: 'Other', repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/other.git', instructions: 'Other' }] } });
  await service.admin(human, { action: 'member', operationId: op(), projectId: project._id, version: project.version, userId: 'owner', role: 'administrador' });
  assert.equal((await Project.findById(project._id))!.members!.get('owner'), 'administrador');
});
test('trusted local identities discover and work on shared projects', async () => {
  const { p, create } = await fixture();
  const collaborator = trustedLocal('frontend@ferroeste.com.br');
  const projects = await service.call(collaborator, 'list_records', { kind: 'project', limit: 100 });
  assert.ok(projects.items.some((project: any) => project._id === p._id));
  const task = await create('Shared frontend task');
  const claimed = await claim(p, task, collaborator);
  assert.equal(claimed.responsible, 'frontend@ferroeste.com.br');
});
test('orphaned running tasks can be claimed once by a collaborator', async () => {
  const { p, create } = await fixture();
  const collaborator = trustedLocal('collaborator@ferroeste.com.br');
  const task = await create('Imported orphan');
  await Task.updateOne({ _id: task._id }, { status: 'em_execucao' });
  await assert.rejects(claim(p, { ...task, version: task.version + 1 }, collaborator), /version conflict/);
  const attempts = await Promise.allSettled([claim(p, task, collaborator), claim(p, task, collaborator)]);
  assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
  const claimed = await Task.findById(task._id);
  assert.equal(claimed!.responsible, collaborator.userId);
  assert.equal(claimed!.status, 'em_execucao');
  assert.ok(claimed!.leaseUntil! > new Date());
  assert.equal(await Execution.countDocuments({ taskId: task._id }), 1);
  const execution = await Execution.findById(claimed!.executionId);
  assert.equal(execution!.userId, collaborator.userId);
  assert.equal(execution!.status, 'em_execucao');
  await assert.rejects(claim(p, claimed, collaborator), /Task unavailable/);
});

test('orphan recovery preserves ownership, execution history and dependencies', async () => {
  const { p, create } = await fixture();
  for (const fields of [{ responsible: 'Existing owner' }, { executionId: op() }, { leaseUntil: new Date(Date.now() - 1000) }]) {
    const task = await create('Protected running task');
    await Task.updateOne({ _id: task._id }, { status: 'em_execucao', ...fields });
    await assert.rejects(claim(p, task), /Task unavailable/);
    assert.equal(await Execution.countDocuments({ taskId: task._id }), 0);
  }
  const prior = await claim(p, await create('Execution history'));
  await Task.updateOne({ _id: prior._id }, { $unset: { responsible: 1, executionId: 1, leaseUntil: 1 } });
  await assert.rejects(claim(p, prior), /Task unavailable/);
  assert.equal(await Execution.countDocuments({ taskId: prior._id }), 1);
  const dependency = await create('Pending dependency');
  const dependent = await create('Orphan with dependency', [dependency._id]);
  await Task.updateOne({ _id: dependent._id }, { status: 'em_execucao' });
  await assert.rejects(claim(p, dependent), /Dependencies not approved/);
  assert.equal(await Execution.countDocuments({ taskId: dependent._id }), 0);
});

test('private projects require a trusted-local project token', async () => {
  const repositoryId = op(); const accessToken = 'shared-private-token';
  const project = await service.call(agent, 'create_project', { operationId: op(), data: { name: 'Private', description: 'Private', instructions: 'Private', visibility: 'private', accessToken, repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/private.git', instructions: 'Private' }] } });
  const collaborator = trustedLocal('frontend@ferroeste.com.br');
  assert.ok(!(await service.call(collaborator, 'list_records', { kind: 'project', limit: 100 })).items.some((item: any) => item._id === project._id));
  await assert.rejects(service.call(collaborator, 'get_summary', { projectId: project._id }), /access token/);
  const authorized = trustedLocal('frontend@ferroeste.com.br', accessToken);
  assert.ok((await service.call(authorized, 'list_records', { kind: 'project', limit: 100 })).items.some((item: any) => item._id === project._id));
});
test('MCP real HTTP handshake, tool listing, tool call and endpoint boundaries', async () => {
  const server = createApp(service, ['https://trusted.internal']).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'flow-test', version: '1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const listed = await client.listTools(); assert.ok(listed.tools.some(t => t.name === 'claim_task')); assert.ok(listed.tools.some(t => t.name === 'set_task_status')); assert.ok(listed.tools.some(t => t.name === 'update_conversation_title')); assert.ok(listed.tools.some(t => t.name === 'diagnose_task_execution')); assert.ok(listed.tools.some(t => t.name === 'recover_task_execution'));
    assert.match(listed.tools.find(t => t.name === 'claim_task')!.description!, /responsible.*usuário autenticado atual/);
    assert.match(listed.tools.find(t => t.name === 'set_task_status')!.description!, /transições administrativas válidas/);
    assert.match(listed.tools.find(t => t.name === 'open_task_conversation')!.description!, /Use send_task_message.*does not wake another agent session automatically/i);
    assert.match(listed.tools.find(t => t.name === 'get_conversation')!.description!, /authorType exatamente human.*autorização de execução/i);
    assert.ok(!listed.tools.some(t => /^(?:approve|review)_/.test(t.name)));
    const response = await client.callTool({ name: 'list_records', arguments: { kind: 'project', limit: 1 } });
    assert.ok(!response.isError);
    const { p, create } = await fixture(); let task = await create('HTTP approval');
    const conversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id, title: 'Original MCP title' });
    const titleResponse = await client.callTool({ name: 'update_conversation_title', arguments: { operationId: op(), projectId: p._id, conversationId: conversation._id, title: 'Renamed through MCP', version: conversation.version } });
    assert.ok(!titleResponse.isError);
    assert.equal(JSON.parse((titleResponse.content as any)[0].text).title, 'Renamed through MCP');
    const recoveryTask = await create('HTTP execution recovery');
    const recoveryClaim = await client.callTool({ name: 'claim_task', arguments: { operationId: op(), projectId: p._id, taskId: recoveryTask._id, version: recoveryTask.version, agent: 'HTTP test' } });
    assert.ok(!recoveryClaim.isError, JSON.stringify(recoveryClaim));
    const claimedExecution = JSON.parse((recoveryClaim.content as any)[0].text);
    const diagnosis = await client.callTool({ name: 'diagnose_task_execution', arguments: { projectId: p._id, taskId: recoveryTask._id, reportedExecutionId: 'eb733abf-65f5-4890-8ecd-4decd24cc85' } });
    assert.ok(!diagnosis.isError, JSON.stringify(diagnosis));
    const diagnosisResult = JSON.parse((diagnosis.content as any)[0].text);
    assert.equal(diagnosisResult.classification, 'client_id_mismatch');
    assert.equal(diagnosisResult.executionId, claimedExecution.executionId);
    const recovered = await client.callTool({ name: 'recover_task_execution', arguments: { operationId: op(), projectId: p._id, taskId: recoveryTask._id, version: claimedExecution.version, reason: 'Verify HTTP recovery preserves a valid execution.' } });
    assert.ok(!recovered.isError, JSON.stringify(recovered));
    assert.equal(JSON.parse((recovered.content as any)[0].text).executionId, claimedExecution.executionId);
    const statusTask = await create('MCP status transition');
    const statusResult = await client.callTool({ name: 'set_task_status', arguments: { operationId: op(), projectId: p._id, taskId: statusTask._id, version: statusTask.version, status: 'cancelada', reason: 'Not needed' } });
    assert.ok(!statusResult.isError);
    const claimError = await client.callTool({ name: 'claim_task', arguments: { operationId: op(), projectId: p._id, taskId: task._id, version: task.version + 1, agent: 'Codex' } });
    assert.ok(claimError.isError);
    assert.deepEqual(JSON.parse((claimError.content as any)[0].text), { code: 'VERSION_CONFLICT', reason: 'O registro foi alterado desde a versão enviada.', recoverable: true, nextAction: 'Leia o contexto ou registro novamente, use a version atual e gere outro operationId.', error: 'Task missing or version conflict' });
    const checked = await fetch(`${url}/admin/tasks/check`, { method: 'POST', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ operationId: op(), projectId: p._id, taskId: task._id, version: task.version, checked: true }) });
    assert.equal(checked.status, 200); task = (await checked.json()).task; assert.equal(task.checked, true); assert.equal(task.status, 'pendente');
    task = await service.call(agent, 'submit_task', { ...active(p, await claim(p, task)), result });
    const approved = await fetch(`${url}/admin/tasks/approve`, { method: 'POST', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: p._id, taskIds: [task._id] }) });
    assert.equal(approved.status, 200); assert.match((await approved.json()).operationId, /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(`${url}/admin`)).status, 200);
    assert.equal((await fetch(`${url}/admin`, { method: 'POST', headers: { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${url}/mcp`)).status, 405);
  } finally { await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Codex and Claude exchange ordered messages in a task-linked conversation', async () => {
  const { p, create } = await fixture();
  const task = await create('Conversation between Codex and Claude', [], 'frontend');
  const server = createApp(service, []).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}`;
  const connectClient = async (name: string) => {
    const client = new Client({ name, version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    return client;
  };
  let codex: Client | undefined; let claude: Client | undefined;
  const read = (response: any) => {
    assert.ok(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  try {
    codex = await connectClient('Codex'); claude = await connectClient('Claude');
    const conversation = read(await codex.callTool({ name: 'create_conversation', arguments: { operationId: op(), projectId: p._id, title: 'Troca Codex e Claude' } }));
    const linked = read(await codex.callTool({ name: 'link_conversation_task', arguments: { operationId: op(), projectId: p._id, conversationId: conversation._id, taskId: task._id, version: conversation.version } }));
    assert.equal(linked.taskId, task._id);

    const codexMessage = read(await codex.callTool({ name: 'send_conversation_message', arguments: { operationId: op(), projectId: p._id, conversationId: conversation._id, content: 'Resposta do Codex' } }));
    await new Promise(resolve => setTimeout(resolve, 5));
    const claudeMessage = read(await claude.callTool({ name: 'send_conversation_message', arguments: { operationId: op(), projectId: p._id, conversationId: conversation._id, content: 'Resposta do Claude' } }));
    assert.deepEqual([codexMessage.author, codexMessage.authorType, codexMessage.clientName], ['owner', 'agent', 'Codex']);
    assert.deepEqual([claudeMessage.author, claudeMessage.authorType, claudeMessage.clientName], ['owner', 'agent', 'Claude']);

    const transcript = read(await claude.callTool({ name: 'get_conversation', arguments: { projectId: p._id, conversationId: conversation._id, limit: 50 } }));
    assert.equal(transcript.conversation.taskId, task._id);
    assert.deepEqual(transcript.messages.map((message: any) => [message.content, message.author, message.authorType, message.clientName]), [
      ['Resposta do Claude', 'owner', 'agent', 'Claude'],
      ['Resposta do Codex', 'owner', 'agent', 'Codex']
    ]);
    assert.deepEqual(transcript.messages.slice().reverse().map((message: any) => message.content), ['Resposta do Codex', 'Resposta do Claude']);
  } finally {
    await codex?.close(); await claude?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
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
test('MCP error catalog explains recovery paths without exposing internals', () => {
  const conflict = JSON.parse(mcpError(new DomainError('Task missing or version conflict')));
  assert.equal(conflict.code, 'VERSION_CONFLICT');
  assert.match(conflict.nextAction, /version atual/);
  const access = JSON.parse(mcpError(new DomainError('Invalid credential: access denied')));
  assert.equal(access.code, 'AUTHORIZATION');
  assert.equal(access.recoverable, false);
  assert.match(access.nextAction, /Não repita a mutação/);
  assert.deepEqual(JSON.parse(mcpError(new DomainError('Dependencies not approved'))), { code: 'DEPENDENCY_PENDING', reason: 'Há dependências ou tarefas ativas que impedem a operação.', recoverable: true, nextAction: 'Use get_task_context ou get_summary para localizar as pendências e aguarde a aprovação ou conclusão necessária.', error: 'Dependencies not approved' });
  const execution = JSON.parse(mcpError(new DomainError('Execution inactive or expired')));
  assert.equal(execution.code, 'EXECUTION_INACTIVE');
  assert.equal(execution.recoverable, false);
  assert.match(execution.nextAction, /get_task_context/);
  assert.equal(JSON.parse(mcpError(new DomainError('Task has an active runner'))).code, 'AUTOMATION_CONFIGURATION');
  assert.equal(JSON.parse(mcpError(new DomainError('Only task participants may collaborate'))).code, 'COLLABORATION_SCOPE');
  assert.equal(JSON.parse(mcpError(new DomainError('Consultation is read-only'))).code, 'RUNNER_SCOPE');
  assert.deepEqual(JSON.parse(mcpError(new Error('database password leaked'))), { code: 'INTERNAL_ERROR', reason: 'O servidor encontrou uma falha inesperada; detalhes internos foram ocultados.', recoverable: false, nextAction: 'Não repita automaticamente. Registre o horário e a ferramenta usada e solicite suporte humano.', error: 'Internal service error' });
});
test('recovery rotates a human credential without persisting its token', async () => {
  const recoveredToken = await recoverHumanToken('owner');
  const recovered = await authenticate(recoveredToken, 'human');
  assert.equal(recovered.userId, 'owner');
  assert.equal(recovered.systemAdmin, true);
  await assert.rejects(authenticate(humanToken, 'human'), /credential/);
  assert.equal(await Credential.exists({ hash: recoveredToken }), null);
  humanToken = recoveredToken;
  human = recovered;
});
test('typed independent tasks and versioned markdown stay compact', async () => {
  const { p, f, create } = await fixture();
  const standalone = await service.call(agent, 'create_task', { operationId: op(), projectId: p._id, data: { name: 'Fix without feature', instructions: 'Fix it', acceptance: ['Fixed'], priority: 1, area: 'backend', repositoryId: p.repositories[0].id, featureId: null, type: 'fix', dependencies: [] } });
  const listed = await service.call(agent, 'list_records', { kind: 'task', projectId: p._id, type: 'fix', withoutFeature: true, limit: 10 });
  assert.equal(listed.items[0].type, 'fix'); assert.equal(listed.items[0].markdownCount, 0);
  const source = '# Plano\n\nOlá 😀\n'.repeat(100);
  const saved = await service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, name: 'plan.md', summary: 'Initial', content: source });
  assert.equal(saved.revision, 1); assert.equal((await service.call(agent, 'list_markdowns', { projectId: p._id, targetKind: 'task', targetId: standalone._id, limit: 10 })).items[0].sha256, saved.sha256);
  const same = await service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, id: saved._id, version: saved.version, name: 'plan.md', summary: 'Initial', content: source });
  assert.equal(same.revision, 1);
  const updated = await service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, id: saved._id, version: saved.version, name: 'plan.md', summary: 'Updated', content: source + 'next' });
  assert.equal(updated.revision, 2);
  const page = await service.call(agent, 'get_markdown', { projectId: p._id, id: saved._id, limit: 2 });
  assert.equal(page.content, '# Plano\n'); assert.equal(page.nextLine, 3);
  assert.equal((await service.call(agent, 'list_markdown_revisions', { projectId: p._id, id: saved._id, limit: 10 })).items.length, 2);
  const context = await service.call(agent, 'get_task_context', { projectId: p._id, taskId: standalone._id });
  assert.equal(context.markdowns.task.items[0].name, 'plan.md'); assert.equal(JSON.stringify(context).includes(source), false);
  await assert.rejects(service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, id: saved._id, version: 0, name: 'plan.md', summary: 'Bad', content: 'bad' }), /version conflict/);
  const running = await claim(p, standalone);
  await assert.rejects(service.call(rival, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, id: saved._id, version: updated.version, name: 'plan.md', summary: 'Blocked', content: 'blocked' }), /another credential/);
  const duringExecution = await service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, id: saved._id, version: updated.version, name: 'plan.md', summary: 'Executor', content: 'executor' });
  const reviewing = await service.call(agent, 'submit_task', { ...active(p, { ...standalone, ...running }), result });
  await assert.rejects(service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: standalone._id, id: saved._id, version: duringExecution.version, name: 'plan.md', summary: 'Frozen', content: 'frozen' }), /cannot be changed/);
  assert.equal(reviewing.status, 'em_revisao');
  await create('Feature task');
  const featureDoc = await service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'feature', targetId: f._id, name: 'overview.md', summary: 'Overview', content: 'Feature plan' });
  assert.equal(featureDoc.revision, 1);
});
test('project area summary returns current markdown without persistence', async () => {
  const { p, create } = await fixture();
  const back = await create('Completed backend');
  const front = await create('Pending frontend', [], 'frontend');
  const other = await create('Other item', [], 'outro');
  let activeBack = await claim(p, back); activeBack = await service.call(agent, 'submit_task', { ...active(p, activeBack), result }); await review(p, activeBack, 'approve');
  const summary = await service.call(agent, 'get_project_area_summary', { projectId: p._id });
  assert.match(summary.markdown, /## Backend[\s\S]*Completed backend/);
  assert.match(summary.markdown, /## Frontend[\s\S]*Pendentes \(1\)[\s\S]*Pending frontend/);
  assert.match(summary.markdown, /## Outro[\s\S]*Other item/);
  assert.equal(summary.taskCount, 3); assert.equal(front.status, 'pendente'); assert.equal(other.status, 'pendente');
});
test('admin page delivers a parseable script with markdown views, chained filters and pagination', () => {
  const scripts = [...adminPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, code]) => code);
  assert.ok(scripts.length);
  scripts.forEach(code => assert.doesNotThrow(() => new Function(code)));
  const script = scripts.join('\n');
  const adminToolsDetails = adminPage.match(/<details id="admin-tools"[^>]*>/)?.[0] ?? '';
  assert.ok(adminToolsDetails);
  assert.doesNotMatch(adminToolsDetails, /\sopen(?:\s|>)/);
  assert.doesNotMatch(script, /\$\('admin-tools'\)\.open\s*=\s*true/);
  assert.match(script, /activeMarkdown/);
  assert.match(script, /function showRendered/);
  for (const id of ['search', 'area', 'status', 'type', 'priority', 'responsible', 'featureId', 'created-from', 'created-to', 'updated-from', 'updated-to', 'clear-filters', 'page-size', 'page-info', 'previous-page', 'next-page', 'novelties', 'git-binding', 'git-modal', 'git-form', 'issue-agent-form', 'issue-agent-user', 'issue-agent-confirm', 'issue-agent-result', 'issue-agent-token', 'copy-agent-token', 'clear-agent-token']) assert.match(adminPage, new RegExp('id="' + id + '"'));
  assert.match(script, /function refreshFilterOptions/);
  assert.match(script, /function matches/);
  assert.match(script, /featuresById/);
  assert.match(script, /pageSize/);
  assert.match(adminPage, />Responsável</);
  assert.match(script, /t\.responsible\|\|'Não atribuído'/);
  assert.match(script, /get_project_novelties/);
  assert.match(script, /list_task_diffs/);
  assert.match(script, /bind_repository_git/);
  for (const id of ['project-id-panel', 'project-id', 'copy-project-id']) assert.match(script, new RegExp('id="' + id + '"'));
  assert.match(script, /function copyProjectId/);
  assert.match(script, /action:'issue'/);
  assert.match(script, /crypto\.getRandomValues/);
  const operationIdSource = script.match(/const operationId=(\(\)=>\{[\s\S]*?\});\$\('summary'\)/)?.[1];
  assert.ok(operationIdSource);
  const createOperationId = new Function('globalThis', `return ${operationIdSource}`)({ crypto: { getRandomValues(bytes) { bytes.fill(0); return bytes; } } });
  assert.match(createOperationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(script, /issue-agent-token/);
});
test('task markdown summary turns task context into readable sections', async () => {
  const { p, create } = await fixture(); const task = await create('Readable task');
  const summary = await service.call(agent, 'get_task_markdown_summary', { projectId: p._id, taskId: task._id });
  assert.match(summary.markdown, /# Readable task/);
  assert.match(summary.markdown, /## Instruções/);
  assert.match(summary.markdown, /## Critérios de aceite/);
  assert.match(summary.markdown, /## Dependências \(0\)/);
  assert.match(summary.markdown, /## Execuções \(0\)/);
});
test('task conversation open reuses, is idempotent, project-scoped, and appears as a bounded summary', async () => {
  const source = await fixture(); const destination = await fixture();
  const task = await source.create('Conversation summary task');
  const foreignTask = await destination.create('Foreign conversation task');
  const openInput = { operationId: op(), projectId: source.p._id, taskId: task._id };
  const opened = await service.call(human, 'open_task_conversation', openInput);
  assert.equal(opened.created, true);
  assert.equal(opened.conversation.taskId, task._id);
  assert.deepEqual(await service.call(human, 'open_task_conversation', openInput), opened, 'same operation retries return the same receipt');
  const reused = await service.call(agent, 'open_task_conversation', { ...openInput, operationId: op() });
  assert.equal(reused.created, false);
  assert.equal(reused.conversation._id, opened.conversation._id);
  assert.equal(await Conversation.countDocuments({ projectId: source.p._id, taskId: task._id, status: 'open' }), 1);
  await assert.rejects(service.call(other, 'open_task_conversation', { ...openInput, operationId: op() }), /access denied/i);
  await assert.rejects(service.call(human, 'open_task_conversation', { ...openInput, operationId: op(), taskId: foreignTask._id }), /Task not found/i);
  const archived = await source.create('Archived conversation task');
  await Task.updateOne({ _id: archived._id }, { $set: { archived: true } });
  await assert.rejects(service.call(human, 'open_task_conversation', { ...openInput, operationId: op(), taskId: archived._id }), /Task not found/i);

  const longMessage = 'recent-4 ' + 'detail '.repeat(100);
  for (let index = 1; index <= 4; index++) await service.call(human, 'send_conversation_message', {
    operationId: op(), projectId: source.p._id, conversationId: opened.conversation._id,
    content: index === 4 ? longMessage : `recent-${index} ` + 'detail '.repeat(100)
  });
  const summary = await service.call(agent, 'get_task_markdown_summary', { projectId: source.p._id, taskId: task._id });
  assert.match(summary.markdown, /## Conversas vinculadas \(1\)/);
  assert.match(summary.markdown, /Task: Conversation summary task/);
  assert.deepEqual(summary.linkedConversations.map((conversation: any) => conversation.conversationId), [opened.conversation._id]);
  assert.equal(summary.linkedConversations[0].messageCount, 3);
  assert.doesNotMatch(summary.markdown, /recent-1/);
  assert.match(summary.markdown, /recent\\-2/);
  assert.match(summary.markdown, /recent\\-4/);
  assert.equal(summary.markdown.includes(longMessage), false, 'summary snippets are clipped');
  const transcript = await service.query(human, 'get_conversation', { projectId: source.p._id, conversationId: opened.conversation._id, limit: 20 });
  assert.equal(transcript.messages.length, 4, 'full conversation history remains available');
});
test('conversation unread cursors are isolated by identity and conversation and advance monotonically', async () => {
  const { p } = await fixture();
  const conversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id });
  const otherConversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id });
  const anotherIdentity = trustedLocal('chat-reader@ferroeste.com.br');
  const base = Date.now();
  const saveMessage = (conversationId: string, author: string, offset: number) => ConversationMessage.create({
    _id: op(), projectId: p._id, conversationId, author, authorType: author === human.userId ? 'human' : 'agent',
    senderId: 'test', operationId: op(), content: 'message', createdAt: new Date(base + offset * 1000)
  });
  const read = (who: Actor, conversationId: string, cursor: string, operationId = op()) => service.call(who, 'mark_conversation_read', {
    operationId, projectId: p._id, conversationId, cursor
  });
  const detail = (who: Actor, conversationId: string) => service.query(who, 'get_conversation', {
    projectId: p._id, conversationId, limit: 50
  });

  const ownMessage = await saveMessage(conversation._id, human.userId, 1);
  assert.equal((await detail(human, conversation._id)).conversation.unread.count, 0, 'own messages are not unread');
  assert.equal((await detail(anotherIdentity, conversation._id)).conversation.unread.count, 1, 'another identity has an independent unread state');
  await read(anotherIdentity, conversation._id, ownMessage._id);
  assert.equal((await detail(anotherIdentity, conversation._id)).conversation.unread.count, 0);

  const incoming = await saveMessage(conversation._id, anotherIdentity.userId, 2);
  assert.deepEqual((await detail(human, conversation._id)).conversation.unread, { count: 1, cursor: incoming._id });
  const staleOperationId = op();
  const staleReceipt = await read(human, conversation._id, ownMessage._id, staleOperationId);
  assert.equal((await detail(human, conversation._id)).conversation.unread.count, 1, 'a stale cursor leaves newer messages unread');
  const laterIncoming = await saveMessage(conversation._id, anotherIdentity.userId, 3);
  assert.deepEqual(await read(human, conversation._id, ownMessage._id, staleOperationId), staleReceipt, 'retries return the original receipt');
  assert.equal((await detail(human, conversation._id)).conversation.unread.count, 2, 'idempotent retry does not advance the cursor');
  await read(human, conversation._id, laterIncoming._id);
  assert.equal((await detail(human, conversation._id)).conversation.unread.count, 0);

  const ownReply = await saveMessage(conversation._id, human.userId, 4);
  assert.equal((await detail(anotherIdentity, conversation._id)).conversation.unread.cursor, ownReply._id);
  const separateMessage = await saveMessage(otherConversation._id, anotherIdentity.userId, 5);
  const listing = await service.query(human, 'list_conversations', { projectId: p._id, limit: 20 });
  assert.equal(listing.items.find((item: any) => item._id === otherConversation._id).unread.cursor, separateMessage._id);
  await read(human, conversation._id, ownReply._id);
  assert.equal((await detail(human, otherConversation._id)).conversation.unread.count, 1, 'reading one conversation does not mark another read');
  await assert.rejects(read(human, conversation._id, separateMessage._id), /Conversation message cursor not found/i);
});
test('human feature creation and task conversation HTTP routes retain project access', async () => {
  const { p, create } = await fixture(); const task = await create('HTTP conversation task');
  const server = createApp(service, []).listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const root = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' };
    const featureResponse = await fetch(`${root}/admin/features`, { method: 'POST', headers, body: JSON.stringify({
      operationId: op(), projectId: p._id, data: { name: 'Created in UI', objective: 'Make creation accessible', context: 'Project workspace', acceptance: ['A user can create this feature'] }
    }) });
    assert.equal(featureResponse.status, 201);
    const feature = await featureResponse.json() as any;
    assert.equal(feature.name, 'Created in UI');
    assert.ok((await service.query(human, 'list_records', { kind: 'feature', projectId: p._id })).items.some((item: any) => item._id === feature._id));
    assert.equal(await Event.countDocuments({ entityId: feature._id, kind: 'feature.created' }), 1);
    const conversationInput = { operationId: op(), projectId: p._id };
    const openedResponse = await fetch(`${root}/admin/tasks/${task._id}/conversation`, { method: 'POST', headers, body: JSON.stringify(conversationInput) });
    assert.equal(openedResponse.status, 200);
    const opened = await openedResponse.json() as any;
    assert.equal(opened.created, true);
    assert.equal(opened.conversation.taskId, task._id);
    const renamedResponse = await fetch(`${root}/admin/conversations/${opened.conversation._id}/title`, { method: 'PATCH', headers, body: JSON.stringify({
      operationId: op(), projectId: p._id, title: 'Renamed through HTTP', version: opened.conversation.version
    }) });
    assert.equal(renamedResponse.status, 200);
    assert.equal((await renamedResponse.json() as any).title, 'Renamed through HTTP');
    assert.equal((await service.query(human, 'list_conversations', { projectId: p._id, limit: 20 })).items[0].title, 'Renamed through HTTP');
    const httpMessageId = op();
    await ConversationMessage.create({ _id: httpMessageId, projectId: p._id, conversationId: opened.conversation._id, author: 'other-user', authorType: 'agent', senderId: 'http-test', operationId: op(), content: 'Unread through HTTP', createdAt: new Date() });
    const readResponse = await fetch(`${root}/admin/conversations/${opened.conversation._id}/read`, { method: 'POST', headers, body: JSON.stringify({ operationId: op(), projectId: p._id, cursor: httpMessageId }) });
    assert.equal(readResponse.status, 200);
    assert.equal((await readResponse.json() as any).cursor, httpMessageId);
    assert.equal((await service.query(human, 'get_conversation', { projectId: p._id, conversationId: opened.conversation._id, limit: 20 })).conversation.unread.count, 0);
    const reusedResponse = await fetch(`${root}/admin/tasks/${task._id}/conversation`, { method: 'POST', headers, body: JSON.stringify({ ...conversationInput, operationId: op() }) });
    assert.equal(reusedResponse.status, 200);
    assert.equal((await reusedResponse.json() as any).created, false);
    const unauthorizedToken = randomBytes(32).toString('hex');
    await service.admin(human, { action: 'issue', operationId: op(), userId: 'non-member', scope: 'human', token: unauthorizedToken });
    const unauthorizedResponse = await fetch(`${root}/admin/features`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${unauthorizedToken}` }, body: JSON.stringify({
      operationId: op(), projectId: p._id, data: { name: 'No access', objective: 'No access', context: 'No access', acceptance: ['No access'] }
    }) });
    assert.equal(unauthorizedResponse.status, 403);
    assert.equal(await Event.countDocuments({ 'data.name': 'No access' }), 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
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

test('Git bindings, task diffs, novelties and concurrent Markdown updates are compatible additions', async () => {
  const { p, create } = await fixture();
  const bound = await service.admin(human, { action: 'bind_repository_git', operationId: op(), projectId: p._id, version: p.version, repositoryId: p.repositories[0].id, canonicalRemoteUrl: 'https://example.com/repo', rootCommit: 'a'.repeat(40) });
  assert.equal(bound.repositories[0].git.canonicalRemoteUrl, 'https://example.com/repo');
  const task = await create('Diff task');
  const diff = await service.call(agent, 'record_task_diff', { operationId: op(), projectId: p._id, taskId: task._id, repositoryId: p.repositories[0].id, baseCommit: 'a'.repeat(40), commit: 'b'.repeat(40), branch: 'codex/task-diff', files: ['src/example.ts'], patch: '+export const value = 1;\n', truncated: false, agent: 'Codex' });
  const listedDiffs = await service.call(agent, 'list_task_diffs', { projectId: p._id, taskId: task._id, limit: 10 });
  assert.equal(listedDiffs.items[0]._id, diff._id);
  assert.equal('patch' in listedDiffs.items[0], false, 'a listagem não carrega o patch');
  assert.equal(listedDiffs.items[0].hasPatch, true);
  assert.match((await service.call(agent, 'get_task_diff', { projectId: p._id, taskId: task._id, id: diff._id })).patch, /value/);
  const saved = await service.call(agent, 'save_markdown', { operationId: op(), projectId: p._id, targetKind: 'task', targetId: task._id, name: 'git.md', summary: 'Initial', content: 'one' });
  const updated = await service.call(agent, 'update_markdown', { operationId: op(), projectId: p._id, documentId: saved._id, baseRevision: saved.revision, summary: 'Updated', content: 'two' });
  assert.equal(updated.revision, 2);
  await assert.rejects(service.call(agent, 'update_markdown', { operationId: op(), projectId: p._id, documentId: saved._id, baseRevision: 1, summary: 'Stale', content: 'three' }), /Markdown revision conflict/);
  const novelty = await service.call(rival, 'get_project_novelties', { projectId: p._id, limit: 100 });
  assert.ok(novelty.items.some((item: any) => item.kind === 'task.diff.published'));
  await service.call(rival, 'mark_project_read', { operationId: op(), projectId: p._id, cursor: novelty.cursor });
  assert.equal((await service.call(rival, 'get_project_novelties', { projectId: p._id, limit: 100 })).count, 0);
});

test('admin project summary returns persisted Git metadata without internal binding fields', async () => {
  const { p } = await fixture();
  const canonicalRemoteUrl = 'https://example.com/admin-summary.git';
  const rootCommit = 'c'.repeat(40);
  const bound = await service.admin(human, {
    action: 'bind_repository_git', operationId: op(), projectId: p._id, version: p.version,
    repositoryId: p.repositories[0].id, canonicalRemoteUrl, rootCommit
  });
  const server = createApp(service, []).listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/projects/summary?limit=100`, {
      headers: { authorization: `Bearer ${humanToken}` }
    });
    assert.equal(response.status, 200);
    const page = await response.json() as { items: Array<{ project: any }> };
    const summary = page.items.find(item => item.project._id === p._id)?.project;

    assert.ok(summary);
    assert.equal(summary.version, bound.version);
    assert.deepEqual(summary.repositories[0].git, { canonicalRemoteUrl, rootCommit });
    assert.equal('boundBy' in summary.repositories[0].git, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('shared conversation proposal requires human approval and an enabled automation route', async () => {
  const { p, create } = await fixture();
  const task = await create('Conversation proposal');
  const conversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id, title: 'Plan task' });
  const messageInput = { operationId: op(), projectId: p._id, conversationId: conversation._id, content: 'Please clarify and prepare this task.' };
  const message = await service.call(human, 'send_conversation_message', messageInput);
  assert.equal((await service.call(human, 'send_conversation_message', messageInput))._id, message._id, 'identical message retries are idempotent');
  await assert.rejects(service.call(other, 'get_conversation', { projectId: p._id, conversationId: conversation._id, limit: 50 }), /access denied/i);
  const proposal = await service.call(agent, 'create_action_proposal', {
    operationId: op(), projectId: p._id, conversationId: conversation._id, taskId: task._id,
    expectedTaskVersion: task.version, title: 'Implement task', summary: 'Clarified scope and acceptance.',
    instructions: 'Implement the clarified scope.', acceptance: ['Implementation is verified']
  });
  assert.equal((await Task.findById(task._id))!.instructions, 'Implement', 'planning does not edit the task before approval');
  await assert.rejects(service.call(agent, 'create_action_proposal', {
    operationId: op(), projectId: p._id, conversationId: conversation._id, taskId: task._id,
    expectedTaskVersion: task.version + 1, title: 'Stale proposal', summary: 'Must be rejected', instructions: 'Stale change'
  }), /version conflict/i);
  const approval = { operationId: op(), projectId: p._id, proposalId: proposal._id, version: proposal.version };
  await assert.rejects(service.approveActionProposal(agent, approval), /Human credential required/);
  await assert.rejects(service.approveActionProposal(human, approval), /automation/i);
  await service.admin(human, {
    action: 'automation_policy', operationId: op(), projectId: p._id, version: 0, enabled: true,
    maxConcurrent: 5, routes: [{ repositoryId: p.repositories[0].id, area: 'backend', provider: 'codex' }]
  });

  const approved = await service.approveActionProposal(human, approval);
  assert.equal(approved.proposal.status, 'approved');
  assert.equal(approved.task._id, task._id);
  assert.equal(approved.job.status, 'queued');
  assert.equal((await Task.findById(task._id))!.instructions, 'Implement the clarified scope.');
  assert.deepEqual((await Task.findById(task._id))!.acceptance, ['Implementation is verified']);
  const linked = await service.query(human, 'get_conversation', { projectId: p._id, conversationId: conversation._id, limit: 50 });
  assert.equal(linked.conversation.taskId, task._id, 'the conversation links to the task only after approval');
  assert.equal(linked.jobs[0].status, 'queued', 'the shared conversation exposes its execution state');
  const retry = await service.approveActionProposal(human, approval);
  assert.equal(retry.job._id, approved.job._id);
});

test('conversation can be created for an active task in its project', async () => {
  const source = await fixture();
  const destination = await fixture();
  const task = await source.create('Conversation task');
  const taskFromOtherProject = await destination.create('Task from another project');

  const linked = await service.call(human, 'create_conversation', { operationId: op(), projectId: source.p._id, taskId: task._id });
  assert.equal(linked.taskId, task._id);
  const detail = await service.query(human, 'get_conversation', { projectId: source.p._id, conversationId: linked._id, limit: 50 });
  assert.equal(detail.conversation.taskId, task._id);
  assert.equal(detail.task._id, task._id);

  await assert.rejects(service.call(human, 'create_conversation', { operationId: op(), projectId: source.p._id, taskId: taskFromOtherProject._id }), /Task not found/);
  const archived = await source.create('Archived conversation task');
  await Task.updateOne({ _id: archived._id }, { $set: { archived: true } });
  await assert.rejects(service.call(human, 'create_conversation', { operationId: op(), projectId: source.p._id, taskId: archived._id }), /Task not found/);
});

test('conversation types validate, version and snapshot flows without changing existing conversations', async () => {
  const { p } = await fixture();
  const firstFieldId = op();
  const typeInput = {
    operationId: op(), projectId: p._id,
    data: {
      name: 'Correção', description: 'Fluxo de correção de defeitos',
      stages: [
        { id: op(), title: 'Contexto', description: 'Reúna os dados do problema.', kind: 'form', required: true,
          fields: [{ id: firstFieldId, label: 'Sintoma', helpText: '', type: 'textarea', required: true, options: [] }] },
        { id: op(), title: 'Triagem', description: 'Classifique o problema.', kind: 'condition', required: false,
          condition: { fieldId: firstFieldId, operator: 'contains', value: 'erro' } },
        { id: op(), title: 'Autorização', description: 'Aguarde autorização humana.', kind: 'approval', required: true, approvalLabel: 'Autorizar correção' }
      ]
    }
  };
  const created = await service.call(human, 'create_conversation_type', typeInput);
  assert.equal(created.name, 'Correção');
  assert.equal(created.version, 0);
  assert.deepEqual(created.stages.map((stage: any) => stage.title), ['Contexto', 'Triagem', 'Autorização']);
  assert.equal((await service.call(human, 'create_conversation_type', typeInput))._id, created._id, 'type creation retries are idempotent');
  assert.equal((await service.query(human, 'list_conversation_types', { projectId: p._id })).items.length, 2, 'project includes the built-in default');
  const otherProject = await fixture();
  assert.equal((await service.query(human, 'list_conversation_types', { projectId: otherProject.p._id })).items.length, 1, 'types are scoped to their project');
  await assert.rejects(service.query(human, 'get_conversation_type', { projectId: otherProject.p._id, typeId: created._id }), /not found/i);
  await assert.rejects(service.call(human, 'create_conversation', { operationId: op(), projectId: otherProject.p._id, typeId: created._id }), /not found/i);
  assert.equal((await service.query(human, 'get_conversation_type', { projectId: p._id, typeId: created._id }))._id, created._id);

  const oldId = op();
  await Conversation.collection.insertOne({ _id: oldId, projectId: p._id, title: 'Conversa antiga', status: 'open', version: 0, createdAt: new Date(), updatedAt: new Date() });
  await ConversationMessage.create({ _id: op(), projectId: p._id, conversationId: oldId, author: 'owner', authorType: 'human', senderId: 'owner', content: 'Histórico existente' });
  const oldDetail = await service.query(human, 'get_conversation', { projectId: p._id, conversationId: oldId, limit: 20 });
  assert.equal(oldDetail.conversation.conversationType.name, 'Geral', 'pre-existing records without type metadata use the default flow');
  assert.equal(oldDetail.messages[0].content, 'Histórico existente', 'pre-existing messages remain readable');

  const legacy = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id });
  assert.equal(legacy.conversationType.name, 'Geral');
  assert.equal(legacy.conversationType.stages.length, 4);
  const typed = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id, typeId: created._id });
  assert.equal(typed.conversationType.name, 'Correção');
  assert.equal(typed.conversationType.stages[0].fields[0].label, 'Sintoma');

  const updated = await service.call(human, 'update_conversation_type', {
    operationId: op(), projectId: p._id, typeId: created._id, version: created.version,
    data: { ...typeInput.data, name: 'Correção urgente', description: typeInput.data.description }
  });
  assert.equal(updated.version, 1);
  let detail = await service.query(human, 'get_conversation', { projectId: p._id, conversationId: typed._id, limit: 20 });
  assert.equal(detail.conversation.conversationType.name, 'Correção', 'open conversation retains its saved type snapshot');
  assert.equal(detail.conversation.conversationType.stages[0].fields[0].label, 'Sintoma');
  await assert.rejects(service.call(human, 'update_conversation_type', {
    operationId: op(), projectId: p._id, typeId: created._id, version: created.version, data: typeInput.data
  }), /version conflict/i);
  const duplicated = await service.call(human, 'duplicate_conversation_type', {
    operationId: op(), projectId: p._id, sourceTypeId: created._id, sourceVersion: updated.version, name: 'Correção urgente v2'
  });
  assert.equal(duplicated.version, 0);
  assert.equal(duplicated.stages[0].fields[0].label, 'Sintoma', 'duplication keeps the configured stages');
  await assert.rejects(service.call(human, 'duplicate_conversation_type', {
    operationId: op(), projectId: p._id, sourceTypeId: created._id, sourceVersion: created.version, name: 'Stale copy'
  }), /version conflict/i);
  const reassigned = await service.call(human, 'set_conversation_type', {
    operationId: op(), projectId: p._id, conversationId: typed._id, typeId: created._id, version: detail.conversation.version
  });
  assert.equal(reassigned.conversationType.name, 'Correção urgente');

  await assert.rejects(service.call(agent, 'create_conversation_type', { ...typeInput, operationId: op() }), /Human access required/i);
  const invalid = { ...typeInput, operationId: op(), data: {
    ...typeInput.data,
    name: 'Condição inválida',
    stages: [{ id: op(), title: 'Condição', description: '', kind: 'condition', required: false,
      condition: { fieldId: op(), operator: 'is_set' } }]
  } };
  await assert.rejects(service.call(human, 'create_conversation_type', invalid), /earlier stage/i);

  const archived = await service.call(human, 'archive_conversation_type', {
    operationId: op(), projectId: p._id, typeId: created._id, version: updated.version
  });
  assert.equal(archived.archived, true);
  detail = await service.query(human, 'get_conversation', { projectId: p._id, conversationId: typed._id, limit: 20 });
  assert.equal(detail.conversation.conversationType.name, 'Correção urgente', 'archival does not remove an existing conversation snapshot');
  assert.equal(await ConversationType.countDocuments({ projectId: p._id, archived: true }), 1);
});

test('conversation title updates are validated, versioned, idempotent, and preserve related data', async () => {
  const { p, create } = await fixture();
  const task = await create('Conversation title task');
  const conversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: p._id, title: 'Original title' });
  const linked = await service.call(human, 'link_conversation_task', {
    operationId: op(), projectId: p._id, conversationId: conversation._id, taskId: task._id, version: conversation.version
  });
  const message = await service.call(human, 'send_conversation_message', {
    operationId: op(), projectId: p._id, conversationId: conversation._id, content: 'Keep this message'
  });
  const proposal = await service.call(agent, 'create_action_proposal', {
    operationId: op(), projectId: p._id, conversationId: conversation._id, taskId: task._id,
    expectedTaskVersion: task.version, title: 'Keep this proposal', summary: 'No task patch', instructions: 'No task patch'
  });
  const before = await service.query(human, 'get_conversation', { projectId: p._id, conversationId: conversation._id, limit: 20 });
  const input = { operationId: op(), projectId: p._id, conversationId: conversation._id, title: '  Updated title  ', version: before.conversation.version };
  const updated = await service.call(human, 'update_conversation_title', input);
  assert.equal(updated.title, 'Updated title');
  assert.equal(updated.version, before.conversation.version + 1);
  assert.deepEqual(await service.call(human, 'update_conversation_title', input), updated, 'same operation retries are idempotent');
  assert.equal(await Event.countDocuments({ projectId: p._id, action: 'update_conversation_title' }), 1);
  await assert.rejects(service.call(human, 'update_conversation_title', { ...input, operationId: op(), title: 'Stale title' }), /version conflict/i);
  await assert.rejects(service.call(human, 'update_conversation_title', { ...input, operationId: op(), title: '   ' }));
  await assert.rejects(service.call(human, 'update_conversation_title', { ...input, operationId: op(), title: 'x'.repeat(256) }));

  const list = await service.query(human, 'list_conversations', { projectId: p._id, limit: 20 });
  assert.equal(list.items[0].title, 'Updated title');
  const detail = await service.query(human, 'get_conversation', { projectId: p._id, conversationId: conversation._id, limit: 20 });
  assert.equal(detail.conversation.title, 'Updated title');
  assert.equal(detail.conversation.taskId, linked.taskId);
  assert.equal(detail.messages[0]._id, message._id);
  assert.equal(detail.proposals[0]._id, proposal._id);

  await service.call(human, 'delete_conversation', { operationId: op(), projectId: p._id, conversationId: conversation._id, version: updated.version });
  await assert.rejects(service.call(human, 'update_conversation_title', { ...input, operationId: op(), version: updated.version + 1 }), /not found or closed/i);
});

test('conversation task search, linking, authorization, and soft deletion stay project-scoped', async () => {
  const source = await fixture();
  const destination = await fixture();
  const linkable = await source.create('Link[Alpha] target', [], 'frontend');
  await source.create('Other Link[Alpha] target');
  const foreignTask = await destination.create('Link[Alpha] foreign');

  const matches = await service.query(human, 'list_records', {
    kind: 'task', projectId: source.p._id, archived: false, search: 'link[', limit: 20
  });
  assert.deepEqual(matches.items.map((item: any) => item._id), [linkable._id], 'search is case-insensitive, escaped, and prefix-scoped');

  const conversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: source.p._id });
  const linkInput = { operationId: op(), projectId: source.p._id, conversationId: conversation._id, taskId: linkable._id, version: conversation.version };
  const linked = await service.call(human, 'link_conversation_task', linkInput);
  assert.equal(linked.taskId, linkable._id);
  assert.equal(linked.version, conversation.version + 1);
  const linkedDetail = await service.query(human, 'get_conversation', { projectId: source.p._id, conversationId: conversation._id, limit: 20 });
  assert.equal(linkedDetail.task.area, 'frontend');
  assert.equal(linkedDetail.task.featureId, source.f._id);
  await assert.rejects(service.call(human, 'link_conversation_task', { ...linkInput, operationId: op() }), /version conflict/i);
  await assert.rejects(service.call(human, 'link_conversation_task', { ...linkInput, operationId: op(), version: linked.version, taskId: foreignTask._id }), /Task not found/i);
  await assert.rejects(service.call(other, 'link_conversation_task', { ...linkInput, operationId: op(), version: linked.version }), /access denied/i);

  const proposalTask = await source.create('Pending proposal task');
  const conflictingTask = await source.create('Conflicting link task');
  const proposalConversation = await service.call(human, 'create_conversation', { operationId: op(), projectId: source.p._id });
  await service.call(agent, 'create_action_proposal', {
    operationId: op(), projectId: source.p._id, conversationId: proposalConversation._id, taskId: proposalTask._id,
    expectedTaskVersion: proposalTask.version, title: 'Prepare task', summary: 'Clarified task', instructions: 'Implement the clarified task'
  });
  const pendingDetail = await service.query(human, 'get_conversation', { projectId: source.p._id, conversationId: proposalConversation._id, limit: 20 });
  await assert.rejects(service.call(human, 'link_conversation_task', {
    operationId: op(), projectId: source.p._id, conversationId: proposalConversation._id,
    taskId: conflictingTask._id, version: pendingDetail.conversation.version
  }), /pending proposal for another task/i);
  const proposalLink = await service.call(human, 'link_conversation_task', {
    operationId: op(), projectId: source.p._id, conversationId: proposalConversation._id,
    taskId: proposalTask._id, version: pendingDetail.conversation.version
  });
  assert.equal(proposalLink.taskId, proposalTask._id, 'linking to the pending proposal task is allowed');

  const message = await service.call(human, 'send_conversation_message', {
    operationId: op(), projectId: source.p._id, conversationId: conversation._id, content: 'Keep this history'
  });
  const beforeDelete = await service.query(human, 'get_conversation', { projectId: source.p._id, conversationId: conversation._id, limit: 20 });
  const deleteInput = { operationId: op(), projectId: source.p._id, conversationId: conversation._id, version: beforeDelete.conversation.version };
  const deleted = await service.call(human, 'delete_conversation', deleteInput);
  assert.deepEqual(await service.call(human, 'delete_conversation', deleteInput), deleted, 'same-operation retries are idempotent');
  assert.equal((await service.query(human, 'list_conversations', { projectId: source.p._id, limit: 20 })).items.some((item: any) => item._id === conversation._id), false);
  await assert.rejects(service.query(human, 'get_conversation', { projectId: source.p._id, conversationId: conversation._id, limit: 20 }), /Conversation not found/i);
  assert.ok(await Task.exists({ _id: linkable._id, projectId: source.p._id }), 'deleting a conversation leaves its task intact');
  assert.ok(await ConversationMessage.exists({ _id: message._id, conversationId: conversation._id }), 'deleting a conversation preserves its messages');
});

test('task transfer previews without writes and moves task history atomically on confirmation', async () => {
  const source = await fixture(); const destination = await fixture();
  let task = await source.create('Transfer with history');
  const conversation = await service.call(agent, 'create_conversation', { operationId: op(), projectId: source.p._id, title: 'Transfer chat history' });
  const conversationMessage = await service.call(agent, 'send_conversation_message', { operationId: op(), projectId: source.p._id, conversationId: conversation._id, content: 'Shared conversation history' });
  await service.call(human, 'mark_conversation_read', { operationId: op(), projectId: source.p._id, conversationId: conversation._id, cursor: conversationMessage._id });
  const proposal = await service.call(agent, 'create_action_proposal', { operationId: op(), projectId: source.p._id, conversationId: conversation._id, taskId: task._id, expectedTaskVersion: task.version, title: 'Prepare task', summary: 'Drafted task instructions', instructions: 'Updated instructions' });
  const markdown = await service.call(agent, 'save_markdown', { operationId: op(), projectId: source.p._id, targetKind: 'task', targetId: task._id, name: 'plan.md', summary: 'Plan', content: '# Transfer plan' });
  task = await claim(source.p, task);
  task = await service.call(agent, 'set_acceptance_criterion', { ...active(source.p, task), criterionIndex: 0, complete: true, evidence: 'Focused implementation verified' });
  const message = await service.call(agent, 'send_task_message', { ...active(source.p, task), type: 'progresso', message: 'History to preserve', references: ['src/service.ts'] });
  task = await service.call(agent, 'record_progress', { ...active(source.p, task), message: 'Implementation completed' });
  task = await service.call(agent, 'submit_task', { ...active(source.p, task), result });

  const target = { projectId: source.p._id, targetProjectId: destination.p._id, taskId: task._id, version: task.version, targetRepositoryId: destination.p.repositories[0].id, targetFeatureId: destination.f._id };
  const preview = await service.call(agent, 'preview_task_transfer', target);
  assert.equal(preview.eligible, true);
  assert.equal(preview.moveCounts.messages, 1);
  assert.equal(preview.moveCounts.documents, 1);
  assert.equal(preview.moveCounts.executions, 1);
  assert.equal(preview.moveCounts.conversations, 1);
  assert.equal(preview.moveCounts.conversationMessages, 1);
  assert.equal(preview.moveCounts.conversationReads, 1);
  assert.equal(preview.moveCounts.actionProposals, 1);
  assert.ok(preview.moveCounts.historyEvents > 0);
  assert.equal((await Task.findById(task._id))!.projectId, source.p._id, 'preview must not mutate the task');
  assert.equal((await MarkdownDocument.findById(markdown._id))!.projectId, source.p._id, 'preview must not move Markdown');

  const transfer = { ...target, operationId: op(), planHash: preview.planHash, confirm: true as const };
  const moved = await service.call(agent, 'transfer_task', transfer);
  assert.equal(moved.task._id, task._id);
  assert.equal(moved.task.projectId, destination.p._id);
  assert.equal(moved.task.repositoryId, destination.p.repositories[0].id);
  assert.equal(moved.task.featureId, destination.f._id);
  assert.equal(moved.task.status, 'em_revisao');
  assert.deepEqual(moved.task.acceptanceProgress, [true]);
  assert.equal(await Task.countDocuments({ _id: task._id }), 1, 'transfer must preserve identity without copying');
  assert.equal(await Task.exists({ _id: task._id, projectId: source.p._id }), null);
  assert.equal((await Execution.findById(task.executionId))!.projectId, destination.p._id);
  assert.equal((await TaskMessage.findById(message._id))!.projectId, destination.p._id);
  assert.equal((await Conversation.findById(conversation._id))!.projectId, destination.p._id);
  assert.equal((await ConversationMessage.findById(conversationMessage._id))!.projectId, destination.p._id);
  assert.ok(await ConversationRead.exists({ projectId: destination.p._id, conversationId: conversation._id, userId: human.userId }));
  assert.equal(await ConversationRead.exists({ projectId: source.p._id, conversationId: conversation._id }), null);
  assert.equal((await ActionProposal.findById(proposal._id))!.projectId, destination.p._id);
  const resumed = await service.call(agent, 'get_conversation', { projectId: destination.p._id, conversationId: conversation._id, limit: 50 });
  assert.equal(resumed.conversation.taskId, null, 'an unapproved proposal does not persist the task link');
  assert.equal(resumed.proposals[0].taskId, task._id, 'the pending proposal and its task survive transfer');
  assert.equal(resumed.messages[0].content, 'Shared conversation history');
  assert.equal((await MarkdownDocument.findById(markdown._id))!.projectId, destination.p._id);
  assert.equal((await MarkdownRevision.findOne({ documentId: markdown._id }))!.projectId, destination.p._id);
  assert.equal(await Event.countDocuments({ projectId: source.p._id, entityId: task._id, action: 'transfer_task' }), 1);
  assert.equal(await Event.countDocuments({ projectId: destination.p._id, entityId: task._id, action: 'transfer_task' }), 1);
  const retried = await service.call(agent, 'transfer_task', transfer);
  assert.equal(retried.task._id, task._id, 'identical operation retries return the committed transfer');
});

test('task transfer rejects inaccessible projects, stale versions, invalid bindings and dependencies', async () => {
  const source = await fixture(); const destination = await fixture();
  const task = await source.create('Access check');
  const args = { projectId: source.p._id, targetProjectId: destination.p._id, taskId: task._id, version: task.version, targetRepositoryId: destination.p.repositories[0].id, targetFeatureId: destination.f._id };
  const privateTarget = await service.call(other, 'create_project', { operationId: op(), data: { name: 'Other owner project', description: 'Other', instructions: 'Private to other actor', repositories: [{ id: op(), name: 'backend', url: 'https://example.com/other.git', instructions: '' }] } });
  await assert.rejects(service.call(agent, 'preview_task_transfer', { ...args, targetProjectId: privateTarget._id, targetRepositoryId: privateTarget.repositories[0].id, targetFeatureId: null }), /Project access denied/);

  await service.call(agent, 'edit_record', { operationId: op(), projectId: source.p._id, kind: 'task', id: task._id, version: task.version, data: { name: 'Access check updated' } });
  await assert.rejects(service.call(agent, 'preview_task_transfer', args), /Task version conflict/);

  const invalid = await source.create('Invalid target binding');
  const invalidPreview = await service.call(agent, 'preview_task_transfer', { ...args, taskId: invalid._id, version: invalid.version, targetRepositoryId: op(), targetFeatureId: source.f._id });
  assert.equal(invalidPreview.eligible, false);
  assert.match(invalidPreview.blockers.join(' '), /Destination repository is not registered/);
  assert.match(invalidPreview.blockers.join(' '), /Destination feature is missing/);

  const dependency = await source.create('Dependency');
  const dependent = await source.create('Has dependency', [dependency._id]);
  const dependencyPreview = await service.call(agent, 'preview_task_transfer', { ...args, taskId: dependent._id, version: dependent.version });
  assert.equal(dependencyPreview.eligible, false);
  assert.match(dependencyPreview.blockers.join(' '), /Task has dependencies/);
});

test('task transfer rolls back moved records when an audit write fails', async () => {
  const source = await fixture(); const destination = await fixture();
  const task = await source.create('Atomic transfer');
  const markdown = await service.call(agent, 'save_markdown', { operationId: op(), projectId: source.p._id, targetKind: 'task', targetId: task._id, name: 'atomic.md', summary: 'Atomic', content: 'Must remain at source after rollback' });
  const target = { projectId: source.p._id, targetProjectId: destination.p._id, taskId: task._id, version: task.version, targetRepositoryId: destination.p.repositories[0].id, targetFeatureId: destination.f._id };
  const preview = await service.call(agent, 'preview_task_transfer', target);
  const transfer = { ...target, operationId: op(), planHash: preview.planHash, confirm: true as const };
  const originalEvent = service.event;
  (service as any).event = async function (session: unknown, actor: Actor, action: string, projectId: string, entityId: string, data: unknown) {
    if (action === 'transfer_task' && projectId === destination.p._id) throw new Error('injected audit failure');
    return originalEvent.call(this, session as any, actor, action, projectId, entityId, data);
  };
  try {
    await assert.rejects(service.call(agent, 'transfer_task', transfer), /injected audit failure/);
  } finally {
    (service as any).event = originalEvent;
  }
  assert.equal((await Task.findById(task._id))!.projectId, source.p._id);
  assert.equal((await MarkdownDocument.findById(markdown._id))!.projectId, source.p._id);
  assert.equal((await MarkdownRevision.findOne({ documentId: markdown._id }))!.projectId, source.p._id);
  assert.equal(await Event.countDocuments({ projectId: source.p._id, entityId: task._id, action: 'transfer_task' }), 0);
  assert.equal(await Event.countDocuments({ projectId: destination.p._id, entityId: task._id, action: 'transfer_task' }), 0);
});
