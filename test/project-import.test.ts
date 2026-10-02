import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Project, Task, Execution, AutomationJob, ActionProposal, Credential } from '../src/db.js';
import { authenticate, bootstrap, Service, type Actor } from '../src/service.js';
import { projectExportCollections } from '../src/services/project-export-service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet, admin: Actor, adminToken: string;
const service = new Service();
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('project-import'));
  adminToken = await bootstrap('import-admin@example.com');
  admin = await authenticate(adminToken, 'human');
});
after(async () => { await mongoose.disconnect(); await repl?.stop(); });

function fixture() {
  const projectId = randomUUID(), repositoryId = randomUUID(), taskId = randomUUID(), otherTaskId = randomUUID();
  const featureId = randomUUID(), executionId = randomUUID(), conversationId = randomUUID(), documentId = randomUUID(), jobId = randomUUID();
  const at = '2026-10-02T00:00:00.000Z';
  const data: Record<string, any> = { project: { _id: projectId, name: 'Projeto importado', description: 'Teste', instructions: 'Manter dados',
    version: 1, archived: false, visibility: 'private', areas: ['backend'], eventSequence: 7,
    repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/repo.git', instructions: '' }] } };
  for (const [name] of projectExportCollections) data[name] = [];
  const record = (fields: object) => ({ _id: randomUUID(), projectId, ...fields });
  data.features = [record({ _id: featureId, name: 'Feature', objective: 'Objetivo', context: 'Contexto', acceptance: ['Critério'], archived: true })];
  data.tasks = [taskId, otherTaskId].map((id, index) => record({ _id: id, name: `Task ${index}`, area: 'backend', repositoryId, featureId,
    status: index ? 'concluida' : 'em_execucao', acceptance: ['Critério'], acceptanceProgress: [true], dependencies: index ? [] : [otherTaskId],
    ...(index ? {} : { executionId, leaseUntil: '2099-01-01T00:00:00.000Z' }), createdAt: at, updatedAt: at }));
  data.taskDependencies = [record({ _id: `${projectId}:${taskId}:${otherTaskId}`, taskId, dependencyId: otherTaskId })];
  data.executions = [record({ _id: executionId, taskId, status: 'em_execucao', managedJobId: jobId, startedAt: at, result: { summary: 'Histórico' } })];
  data.conversations = [record({ _id: conversationId, taskId, title: 'Conversa' })];
  data.conversationMessages = [record({ conversationId, content: 'Conteúdo integral', author: 'autor@example.com', operationId: randomUUID() })];
  data.taskMessages = [record({ taskId, executionId, conversationId, message: 'Mensagem preservada' })];
  data.markdownDocuments = [record({ _id: documentId, targetKind: 'task', targetId: taskId, name: 'Plano', revision: 1 })];
  data.markdownRevisions = [record({ documentId, revision: 1, content: '# Plano\nConteúdo completo', sha256: 'old-hash', size: 0 })];
  data.taskDiffs = [record({ taskId, repositoryId, patch: 'diff completo', patchSha256: 'old-hash' })];
  data.events = [record({ entityId: taskId, action: 'set_acceptance_criterion', data: { criterionIndex: 0, complete: true, evidence: 'Evidência' }, at })];
  data.deliveryEvents = [record({ taskIds: [taskId], sequence: 7, at })];
  data.automationJobs = [record({ _id: jobId, taskId, repositoryId, executionId, status: 'running', authorizationValid: true, turnInFlight: true, runnerId: 'old-runner' })];
  data.actionProposals = [record({ taskId, conversationId, jobId, status: 'pending' })];
  const counts = { project: 1, repositories: 1, ...Object.fromEntries(projectExportCollections.map(([name]) => [name, data[name].length])) };
  return { format: 'project-tasks-export', schemaVersion: 1, exportedAt: at, source: { projectId }, counts, data, migrationInstructions: 'Migrar', exclusions: [] };
}

test('real export imports atomically preserving IDs, history and content, disabling active state and recognizing retries', async () => {
  const seed = fixture(), projectId = seed.source.projectId;
  await Project.insertMany([seed.data.project], { timestamps: false });
  for (const [name, model] of projectExportCollections) await model.insertMany(seed.data[name], { timestamps: false });
  const exported = await service.exportProject(admin, projectId);
  for (const [, model] of projectExportCollections) await model.deleteMany({ projectId });
  await Project.deleteOne({ _id: projectId });
  const credentialsBefore = await Credential.countDocuments();
  const result = await service.importProject(admin, exported);
  assert.equal(result.reused, false);
  assert.equal(result.projectId, projectId);
  for (const [name, model] of projectExportCollections) assert.equal(await model.countDocuments({ projectId }), seed.counts[name as keyof typeof seed.counts] + (name === 'events' ? 1 : 0));
  const task = await Task.findById(seed.data.tasks[0]._id).lean();
  assert.deepEqual(task!.dependencies, seed.data.tasks[0].dependencies);
  assert.deepEqual(task!.acceptanceProgress, [true]);
  assert.equal(task!.status, 'bloqueada');
  assert.equal(task!.createdAt.toISOString(), seed.exportedAt);
  assert.equal(task!.leaseUntil, undefined);
  assert.equal((await Execution.findById(seed.data.executions[0]._id))?.status, 'bloqueada');
  const job = await AutomationJob.findById(seed.data.automationJobs[0]._id).lean();
  assert.equal(job!.status, 'cancelled'); assert.equal(job!.authorizationValid, false); assert.equal(job!.turnInFlight, false);
  assert.equal(job!.runnerId, undefined);
  assert.equal((await ActionProposal.findById(seed.data.actionProposals[0]._id))?.status, 'rejected');
  const importedProject = await Project.findById(projectId);
  assert.equal(importedProject!.visibility, 'private');
  assert.equal(importedProject!.accessTokenHash, undefined);
  assert.deepEqual([...importedProject!.members!.values()], ['administrador']);
  assert.equal(await Credential.countDocuments(), credentialsBefore);
  const again = await service.importProject(admin, exported);
  assert.equal(again.reused, true);
  assert.equal(await Task.countDocuments({ projectId }), 2);
  const roundTrip = await service.exportProject(admin, projectId);
  assert.deepEqual((roundTrip.data as any).markdownRevisions.map((r: any) => r.content), seed.data.markdownRevisions.map((r: any) => r.content));
  assert.doesNotMatch(JSON.stringify(roundTrip), /importReceipt/);
});

test('invalid counts, references, cycles, schema version and late uniqueness errors leave no partial data', async () => {
  const mutations = [
    (p: any) => { p.counts.tasks++; }, (p: any) => { p.data.tasks[0].repositoryId = randomUUID(); },
    (p: any) => { p.data.tasks[1].dependencies = [p.data.tasks[0]._id]; }, (p: any) => { p.schemaVersion = 2; },
    (p: any) => { p.data.markdownRevisions.push({ ...p.data.markdownRevisions[0], _id: randomUUID() }); p.counts.markdownRevisions++; }
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    await assert.rejects(() => service.importProject(admin, input));
    assert.equal(await Project.exists({ _id: input.source.projectId }), null);
    assert.equal(await Task.countDocuments({ projectId: input.source.projectId }), 0);
  }
});

test('existing project or entity ID is never overwritten', async () => {
  const input = fixture();
  await Project.create({ ...input.data.project, name: 'Original' });
  await assert.rejects(() => service.importProject(admin, input), /não sobrescreve/);
  assert.equal((await Project.findById(input.source.projectId))?.name, 'Original');
  const other = fixture();
  await Task.create({ _id: other.data.tasks[0]._id, projectId: randomUUID(), name: 'Existing task' });
  await assert.rejects(() => service.importProject(admin, other), /Conflito de IDs/);
  assert.equal(await Project.exists({ _id: other.source.projectId }), null);
});

test('import endpoint accepts only human system admin and supports 201 followed by idempotent 200', async () => {
  const humanToken = randomBytes(32).toString('hex');
  await service.admin(admin, { action: 'issue', operationId: randomUUID(), userId: 'reader@example.com', scope: 'human', systemAdmin: false, token: humanToken });
  const app = createApp(service, []), server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port, input = fixture();
  const post = (token: string) => fetch(`http://127.0.0.1:${port}/admin/projects/import`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  try {
    assert.equal((await post('')).status, 401);
    assert.equal((await post(humanToken)).status, 403);
    assert.equal((await post(adminToken)).status, 201);
    const response = await post(adminToken);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reused, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await app.locals.close?.();
  }
});
