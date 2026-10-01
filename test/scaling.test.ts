import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Event, Project, Task, TaskDependency, TaskMessage, Execution } from '../src/db.js';
import { pageByCreatedAt, pageByDate, pageLatestByCreatedAt } from '../src/pagination.js';
import { backfillTaskDependencyEdges } from '../src/services/task-dependency-service.js';
import { getTaskContext, TASK_CONTEXT_MAX_BYTES } from '../src/services/task-context-service.js';
import { Service, trustedLocal } from '../src/service.js';

let repl: MongoMemoryReplSet;
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connect(repl.getUri('scaling'));
});
after(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

test('task context is explicitly projected, bounded, and reports its UTF-8 size', async () => {
  const projectId = randomUUID();
  const featureId = randomUUID();
  const repositoryId = randomUUID();
  const taskId = randomUUID();
  await Project.create({
    _id: projectId, version: 2, name: 'P'.repeat(1000), description: 'D'.repeat(20000), instructions: 'I'.repeat(20000),
    visibility: 'private', accessTokenHash: 'secret-hash', members: { operator: 'administrador' }, fence: 12, eventSequence: 9,
    repositories: [{ id: repositoryId, name: 'R'.repeat(500), url: 'https://example.com/repo', instructions: 'r'.repeat(20000) }]
  });
  await mongoose.model('Feature').create({ _id: featureId, projectId, name: 'Feature', objective: 'O'.repeat(4000), context: 'C'.repeat(4000), acceptance: Array.from({ length: 25 }, () => 'F'.repeat(500)) });
  const dependencyId = randomUUID();
  await Task.create({ _id: dependencyId, projectId, name: 'Dependency', status: 'pendente', area: 'backend', type: 'feature', executionId: randomUUID() });
  await Task.create({
    _id: taskId, projectId, featureId, repositoryId, name: 'T'.repeat(1000), instructions: 'N'.repeat(20000),
    acceptance: Array.from({ length: 100 }, () => 'A'.repeat(1000)), acceptanceProgress: Array.from({ length: 100 }, () => true),
    dependencies: [dependencyId], status: 'em_execucao', executionId: randomUUID(), responsible: 'runner@example.com',
    checkedBy: 'reviewer@example.com', checkedAt: new Date(), leaseUntil: new Date(Date.now() + 60000)
  });
  await TaskMessage.insertMany(Array.from({ length: 11 }, () => ({
    _id: randomUUID(), projectId, taskId, author: 'agent@example.com', credentialId: 'private-credential-id', type: 'progresso',
    message: 'M'.repeat(20000), references: [], createdAt: new Date()
  })));
  await Execution.create({ _id: randomUUID(), projectId, taskId, credentialId: 'private-credential-id', userId: 'operator@example.com', status: 'concluida', startedAt: new Date(), result: { summary: 'S'.repeat(20000), evidence: ['E'.repeat(5000)], privatePayload: 'should not be returned' } });

  const context = await getTaskContext(projectId, taskId);
  assert.ok(context);
  const payload = JSON.stringify(context);
  assert.ok(Buffer.byteLength(payload, 'utf8') <= TASK_CONTEXT_MAX_BYTES);
  assert.equal(context.contextMeta.payloadBytes, Buffer.byteLength(payload, 'utf8'));
  assert.ok(context.contextMeta.truncatedFields.length > 0);
  assert.equal(context.messages.length, 10);
  assert.equal(context.executions.length, 1);
  assert.equal(context.task.acceptance.length, 100);
  assert.equal(context.task.acceptanceProgress.length, 100);
  assert.equal('accessTokenHash' in context.project, false);
  assert.equal('members' in context.project, false);
  assert.equal('fence' in context.project, false);
  assert.equal('eventSequence' in context.project, false);
  assert.equal('leaseUntil' in context.task, false);
  assert.equal(context.task.checkedBy, 'reviewer@example.com');
  assert.equal('credentialId' in context.messages[0], false);
  assert.equal('credentialId' in context.executions[0], false);
  assert.equal('privatePayload' in (context.executions[0].result ?? {}), false);

  await Project.updateOne({ _id: projectId }, { $set: { visibility: 'public' } });
  const service = new Service();
  const actor = trustedLocal('reader@example.com');
  const projectRecord = await service.query(actor, 'get_record', { projectId, kind: 'project', id: projectId });
  const projectList = await service.query(actor, 'list_records', { kind: 'project', limit: 10 });
  const listedProject = projectList.items.find((item: any) => item._id === projectId);
  assert.equal('accessTokenHash' in projectRecord, false);
  assert.equal('members' in projectRecord, false);
  assert.equal('fence' in projectRecord, false);
  assert.equal('accessTokenHash' in listedProject, false);
  const messagePage = await service.query(actor, 'list_task_messages', { projectId, taskId, limit: 10 });
  assert.equal('credentialId' in messagePage.items[0], false);
});

test('timestamp pages are stable and legacy history IDs transition to scoped cursors', async () => {
  const projectId = randomUUID();
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003'
  ];
  const base = new Date('2026-01-01T00:00:00.000Z');
  await Task.collection.insertMany(ids.map((id, index) => ({ _id: id, projectId, name: id, dependencies: [], createdAt: new Date(base.getTime() + (3 - index) * 1000), updatedAt: base })) as any[]);
  const first = await pageByCreatedAt<any>(Task, { projectId }, undefined, 1);
  const second = await pageByCreatedAt<any>(Task, { projectId }, first.next ?? undefined, 1);
  assert.equal(first.items[0]._id, ids[2]);
  assert.equal(second.items[0]._id, ids[1]);
  assert.notEqual(first.next, ids[2]);
  const latest = await pageLatestByCreatedAt<any>(Task, { projectId }, undefined, 1);
  const older = await pageLatestByCreatedAt<any>(Task, { projectId }, latest.next ?? undefined, 1);
  assert.equal(latest.items[0]._id, ids[0]);
  assert.equal(older.items[0]._id, ids[1]);
  await Event.create(ids.map((id, index) => ({ _id: id, projectId, entityId: projectId, action: 'test', at: new Date(base.getTime() + index * 1000) })));
  const history = await pageByDate<any>(Event, { projectId }, ids[0], 1, 'at', false);
  assert.equal(history.items[0]._id, ids[1]);
  assert.ok(history.next);
  await assert.rejects(pageByDate<any>(Event, { projectId: randomUUID() }, history.next ?? undefined, 1, 'at', false), /cursor/i);
});

test('dependency writes are edge-indexed, cycle checks stay local, and legacy backfill is idempotent', async () => {
  const service = new Service();
  const actor = trustedLocal('scaling@example.com');
  const repositoryId = randomUUID();
  const project = await service.call(actor, 'create_project', { operationId: randomUUID(), data: {
    name: 'Dependency graph', description: 'test', instructions: 'test',
    repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/repo', instructions: '' }]
  } });
  const createTask = (name: string, dependencies: string[] = []) => service.call(actor, 'create_task', { operationId: randomUUID(), projectId: project._id, data: {
    name, instructions: 'test', acceptance: ['exists'], area: 'backend', priority: 1, repositoryId, dependencies
  } });
  const first = await createTask('first');
  const second = await createTask('second', [first._id]);
  const third = await createTask('third', [second._id]);
  assert.equal(await TaskDependency.countDocuments({ projectId: project._id }), 2);
  await assert.rejects(service.call(actor, 'edit_record', {
    operationId: randomUUID(), projectId: project._id, kind: 'task', id: first._id, version: first.version,
    data: { dependencies: [third._id] }
  }), /cycle/i);
  await TaskDependency.deleteMany({ projectId: project._id });
  const migrated = await backfillTaskDependencyEdges(10);
  assert.equal(migrated.tasksProcessed >= 3, true);
  assert.equal(migrated.edgeCountMatches, true);
  assert.equal(await TaskDependency.countDocuments({ projectId: project._id }), 2);
  await backfillTaskDependencyEdges(10);
  assert.equal(await TaskDependency.countDocuments({ projectId: project._id }), 2);
});

test('dependency validation remains scoped with thousands of unrelated tasks in one project', async () => {
  const service = new Service();
  const actor = trustedLocal('large-project@example.com');
  const repositoryId = randomUUID();
  const project = await service.call(actor, 'create_project', { operationId: randomUUID(), data: {
    name: 'Large project', description: 'scale scenario', instructions: 'test',
    repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/repo', instructions: '' }]
  } });
  const dependencyId = randomUUID();
  const taskIds = Array.from({ length: 2000 }, () => randomUUID());
  await Task.collection.insertMany(taskIds.map((id, index) => ({
    _id: id, projectId: project._id, name: `Unrelated ${index}`, status: 'pendente', archived: false, dependencies: []
  })) as any[]);
  await Task.collection.insertOne({ _id: dependencyId, projectId: project._id, name: 'Reachable dependency', status: 'pendente', archived: false, dependencies: [] } as any);
  const dependent = await service.call(actor, 'create_task', { operationId: randomUUID(), projectId: project._id, data: {
    name: 'New dependent', instructions: 'test', acceptance: ['exists'], area: 'backend', priority: 1,
    repositoryId, dependencies: [dependencyId]
  } });

  assert.equal(await Task.countDocuments({ projectId: project._id }), 2002);
  assert.equal(await TaskDependency.countDocuments({ projectId: project._id }), 1);
  assert.equal((await TaskDependency.findOne({ projectId: project._id, taskId: dependent._id }).lean())?.dependencyId, dependencyId);
});
