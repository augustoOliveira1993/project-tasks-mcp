import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  AutomationJob,
  connect,
  DeliveryEvent,
  Event,
  Execution,
  Feature,
  MarkdownDocument,
  MarkdownRevision,
  Operation,
  Project,
  Task,
  TaskDiff,
  TaskMessage
} from '../src/db.js';
import { deleteTaskCascade, TaskDeletionConflict } from '../src/task-deletion.js';
import { authenticate, bootstrap, Service, trustedLocal, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet;
let service: Service;
let adminToken: string;
let admin: Actor;
let regularHumanToken: string;
let agentToken: string;
const id = () => randomUUID();
const token = () => randomBytes(32).toString('hex');
const actor = { id: id(), userId: 'root@example.com' };

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('task-deletion'));
  service = new Service();
  adminToken = await bootstrap('root@example.com');
  admin = await authenticate(adminToken, 'human');
  regularHumanToken = token();
  await service.admin(admin, { action: 'issue', operationId: id(), userId: 'member@example.com', scope: 'human', systemAdmin: false, token: regularHumanToken });
  agentToken = token();
  await service.admin(admin, { action: 'issue', operationId: id(), userId: 'agent@example.com', scope: 'agent', systemAdmin: false, token: agentToken });
});

after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

test('task cascade removes owned data and references while preserving the project graph', async () => {
  const projectId = id();
  const featureId = id();
  const taskId = id();
  const siblingId = id();
  const repositoryId = id();
  const credentialId = id();
  const taskOperationId = id();
  const messageOperationId = id();
  const docId = id();
  const messageId = id();
  const diffId = id();
  const jobId = id();
  const executionId = id();
  const taskEventId = id();
  const siblingEventId = id();

  await Project.create({ _id: projectId, name: 'Keep project', repositories: [{ id: repositoryId, name: 'repo' }], eventSequence: 2 });
  await Feature.create({ _id: featureId, projectId, name: 'Keep feature' });
  await Task.create([
    { _id: taskId, projectId, featureId, name: 'Delete me', dependencies: [] },
    { _id: siblingId, projectId, featureId, name: 'Keep sibling', dependencies: [taskId] }
  ]);
  await TaskMessage.create({ _id: messageId, projectId, taskId, operationId: messageOperationId, credentialId, author: actor.userId, type: 'pergunta', message: 'linked' });
  await MarkdownDocument.create({ _id: docId, projectId, targetKind: 'task', targetId: taskId, name: 'plan', revision: 1 });
  await MarkdownRevision.create({ _id: id(), projectId, documentId: docId, revision: 1, content: 'private task text' });
  await TaskDiff.create({ _id: diffId, projectId, taskId, repositoryId, patch: 'diff' });
  await Execution.create({ _id: executionId, projectId, taskId, status: 'submit_task' });
  await AutomationJob.create({ _id: jobId, projectId, taskId, status: 'completed', authorizationValid: true });
  await Event.create([
    { _id: taskEventId, projectId, entityId: taskId, action: 'create_task', credentialId, data: { operationId: taskOperationId, task: { _id: taskId } } },
    { _id: siblingEventId, projectId, entityId: siblingId, action: 'create_task', credentialId, data: { operationId: id(), task: { _id: siblingId } } },
    { _id: messageId, projectId, entityId: messageId, action: 'task_message', credentialId, data: { taskId, operationId: messageOperationId } }
  ]);
  await DeliveryEvent.create([
    { _id: taskEventId, projectId, sequence: 1, taskIds: [taskId], action: 'create_task' },
    { _id: siblingEventId, projectId, sequence: 2, taskIds: [siblingId, taskId], action: 'task_message' }
  ]);
  await Operation.create([
    { _id: `${credentialId}:${taskOperationId}`, projectId, fingerprint: 'task-op', result: { _id: taskId, name: 'Delete me' } },
    { _id: `${credentialId}:${messageOperationId}`, projectId, fingerprint: 'message-op', result: { _id: messageId, taskId } },
    { _id: `${credentialId}:${id()}`, projectId, fingerprint: 'sibling-op', result: { _id: siblingId } }
  ]);

  const result = await mongoose.connection.transaction(session => deleteTaskCascade(projectId, taskId, actor, session));

  assert.equal(result?.deleted, true);
  assert.equal((await Task.findById(taskId)), null);
  const sibling = await Task.findById(siblingId).lean();
  assert.deepEqual(sibling?.dependencies, []);
  assert.equal(sibling?.version, 1);
  assert.ok(await Project.findById(projectId));
  assert.ok(await Feature.findById(featureId));
  assert.deepEqual((await Project.findById(projectId).lean())?.repositories?.[0]?.id, repositoryId);
  assert.equal(await TaskMessage.countDocuments({ projectId, $or: [{ taskId }, { relatedTaskId: taskId }] }), 0);
  assert.equal(await MarkdownDocument.countDocuments({ projectId, targetKind: 'task', targetId: taskId }), 0);
  assert.equal(await MarkdownRevision.countDocuments({ projectId, documentId: docId }), 0);
  assert.equal(await TaskDiff.countDocuments({ projectId, taskId }), 0);
  assert.equal(await Execution.countDocuments({ projectId, taskId }), 0);
  assert.equal(await AutomationJob.countDocuments({ projectId, taskId }), 0);
  assert.deepEqual((await Event.find({ projectId }).select('entityId action').lean()).map(event => event.action).sort(), ['create_task', 'hard_delete_task']);
  const deliveries = await DeliveryEvent.find({ projectId }).sort({ sequence: 1 }).lean();
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.find(event => event._id === siblingEventId)?.taskIds, [siblingId]);
  assert.deepEqual(deliveries.find(event => event.action === 'hard_delete_task')?.taskIds, []);
  assert.equal(await Operation.countDocuments({ _id: `${credentialId}:${taskOperationId}` }), 0);
  assert.equal(await Operation.countDocuments({ _id: `${credentialId}:${messageOperationId}` }), 0);
  assert.equal(await Operation.countDocuments({ 'result._id': siblingId }), 1);
});

test('task cascade rejects active task executions and reserved or in-flight automation atomically', async () => {
  const projectId = id();
  await Project.create({ _id: projectId, name: 'Active project' });

  const executingTaskId = id();
  const executionId = id();
  await Task.create({ _id: executingTaskId, projectId, name: 'Executing task', status: 'em_execucao', executionId });
  await Execution.create({ _id: executionId, projectId, taskId: executingTaskId, status: 'em_execucao' });
  const initialFence = (await Project.findById(projectId).lean())!.fence;
  await assert.rejects(
    mongoose.connection.transaction(session => deleteTaskCascade(projectId, executingTaskId, actor, session)),
    TaskDeletionConflict
  );
  assert.ok(await Task.findById(executingTaskId));
  assert.ok(await Execution.findById(executionId));
  assert.equal((await Project.findById(projectId).lean())?.fence, initialFence);

  for (const status of ['reserved', 'running', 'waiting_human']) {
    const taskId = id();
    await Task.create({ _id: taskId, projectId, name: `Task with ${status} job` });
    await AutomationJob.create({ _id: id(), projectId, taskId, status });
    const fence = (await Project.findById(projectId).lean())!.fence;
    await assert.rejects(
      mongoose.connection.transaction(session => deleteTaskCascade(projectId, taskId, actor, session)),
      TaskDeletionConflict
    );
    assert.ok(await Task.findById(taskId));
    assert.ok(await AutomationJob.exists({ projectId, taskId, status }));
    assert.equal((await Project.findById(projectId).lean())?.fence, fence);
  }

  const uncertainTaskId = id();
  await Task.create({ _id: uncertainTaskId, projectId, name: 'Uncertain job' });
  await AutomationJob.create({ _id: id(), projectId, taskId: uncertainTaskId, status: 'completed', turnInFlight: true });
  await assert.rejects(
    mongoose.connection.transaction(session => deleteTaskCascade(projectId, uncertainTaskId, actor, session)),
    TaskDeletionConflict
  );
  assert.ok(await Task.findById(uncertainTaskId));

  const predecessorId = id();
  const dependentId = id();
  await Task.create([
    { _id: predecessorId, projectId, name: 'Predecessor' },
    { _id: dependentId, projectId, name: 'Active dependent', status: 'em_execucao', dependencies: [predecessorId] }
  ]);
  await Execution.create({ _id: id(), projectId, taskId: dependentId, status: 'em_execucao' });
  await assert.rejects(
    mongoose.connection.transaction(session => deleteTaskCascade(projectId, predecessorId, actor, session)),
    TaskDeletionConflict
  );
  assert.ok(await Task.exists({ _id: predecessorId }));
  assert.deepEqual((await Task.findById(dependentId).lean())?.dependencies, [predecessorId]);
});

test('missing task leaves sibling data untouched', async () => {
  const projectId = id();
  const taskId = id();
  const siblingId = id();
  await Project.create({ _id: projectId, name: 'Missing task project' });
  await Task.create({ _id: siblingId, projectId, name: 'Sibling' });
  const result = await mongoose.connection.transaction(session => deleteTaskCascade(projectId, taskId, actor, session));
  assert.equal(result, null);
  assert.ok(await Task.findById(siblingId));
});

test('HTTP task deletion requires an active system administrator and keeps idempotency receipts', async () => {
  const projectId = id();
  const featureId = id();
  const taskId = id();
  const otherTaskId = id();
  const activeTaskId = id();
  const activeExecutionId = id();
  await Project.create({ _id: projectId, name: 'HTTP delete project' });
  await Feature.create({ _id: featureId, projectId, name: 'HTTP feature' });
  await Task.create([
    { _id: taskId, projectId, featureId, name: 'Delete task', instructions: 'private task detail' },
    { _id: otherTaskId, projectId, featureId, name: 'Keep task' },
    { _id: activeTaskId, projectId, featureId, name: 'Active task', status: 'em_execucao', executionId: activeExecutionId }
  ]);
  await Execution.create({ _id: activeExecutionId, projectId, taskId: activeTaskId, status: 'em_execucao' });

  const app = createApp(service, []);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/admin/projects/${projectId}/tasks/${taskId}`;
  const operationId = id();
  const request = (authorization?: string, extraHeaders: Record<string, string> = {}, taskPath = taskId, opId = operationId) => fetch(`${url.replace(taskId, taskPath)}`, {
    method: 'DELETE',
    headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ operationId: opId })
  });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request(agentToken)).status, 401);
    assert.equal((await request(undefined, { 'x-project-tasks-email': 'member@example.com' })).status, 401);
    assert.equal((await request(regularHumanToken)).status, 403);
    await assert.rejects(service.deleteTask(trustedLocal('member@example.com'), projectId, taskId, id()), /Human credential required/);
    assert.ok(await Task.exists({ _id: taskId }));

    const response = await request(adminToken);
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.deleted, true);
    assert.equal(result.taskId, taskId);
    assert.equal(result.removed.tasks, 1);
    assert.equal(JSON.stringify(result).includes('private task detail'), false);
    assert.equal(await Task.exists({ _id: taskId }), null);
    assert.ok(await Task.exists({ _id: otherTaskId }));
    assert.ok(await Project.exists({ _id: projectId }));
    assert.ok(await Feature.exists({ _id: featureId }));
    const audit = await Event.findOne({ projectId, entityId: taskId, action: 'hard_delete_task' }).lean();
    assert.ok(audit);
    assert.equal(JSON.stringify(audit).includes('private task detail'), false);
    assert.ok(await Operation.exists({ _id: `${admin.id}:${operationId}`, projectId: { $exists: false } }));

    const replay = await request(adminToken);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), result);
    assert.equal((await request(adminToken, {}, otherTaskId, operationId)).status, 409);
    assert.ok(await Task.exists({ _id: otherTaskId }));
    assert.equal((await request(adminToken, {}, activeTaskId, id())).status, 409);
    assert.ok(await Task.exists({ _id: activeTaskId }));
    assert.ok(await Execution.exists({ _id: activeExecutionId }));
    assert.equal((await request(adminToken, {}, id(), id())).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await (app.locals as any).close?.();
  }
});

test('archive_record remains a separate reversible task operation', async () => {
  const projectId = id();
  const taskId = id();
  await Project.create({ _id: projectId, name: 'Archive remains' });
  await Task.create({ _id: taskId, projectId, name: 'Archive task', status: 'concluida' });
  const archived = await service.call(trustedLocal('operator@example.com'), 'archive_record', {
    operationId: id(), projectId, kind: 'task', id: taskId, version: 0
  });
  assert.equal(archived.archived, true);
  assert.ok(await Task.exists({ _id: taskId, archived: true }));
});
