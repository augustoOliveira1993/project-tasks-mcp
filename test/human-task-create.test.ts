import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Event, Project, Task, TaskRead } from '../src/db.js';
import { authenticate, bootstrap, Service, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet;
let service: Service;
let app: ReturnType<typeof createApp>;
let server: Server;
let baseUrl: string;
let humanToken: string;
let human: Actor;
let agent: Actor;
let readerToken: string;
let outsiderToken: string;
let projectId: string;
let repositoryId: string;
let featureId: string;
const op = () => randomUUID();

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('human-task-create'));
  service = new Service();
  humanToken = await bootstrap('task-ui-owner');
  human = await authenticate(humanToken, 'human');
  const agentToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: human.userId, scope: 'agent', token: agentToken });
  agent = await authenticate(agentToken, 'agent');
  repositoryId = op();
  const project = await service.call(agent, 'create_project', { operationId: op(), data: {
    name: 'Task creation UI', description: 'Human task creation tests', instructions: 'Focused test project',
    repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/repo.git', instructions: 'Test repository' }]
  } });
  projectId = project._id;
  const feature = await service.call(agent, 'create_feature', { operationId: op(), projectId, data: {
    name: 'Feature', objective: 'Create tasks', context: 'Frontend selection', acceptance: ['Works']
  } });
  featureId = feature._id;

  readerToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'task-ui-reader', scope: 'human', token: readerToken });
  const currentProject = await Project.findById(projectId).lean();
  await service.admin(human, { action: 'member', operationId: op(), projectId, version: currentProject!.version, userId: 'task-ui-reader', role: 'leitor' });
  outsiderToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'task-ui-outsider', scope: 'human', token: outsiderToken });

  app = createApp(service, []);
  server = createServer(app).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.locals.close?.();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
  await repl?.stop();
});

function taskBody(operationId = op(), name = 'Create from panel') {
  return {
    operationId,
    projectId,
    data: {
      name,
      instructions: 'Implement through the authenticated panel',
      acceptance: ['The task is visible in the project'],
      priority: 2,
      area: 'frontend',
      repositoryId,
      featureId,
      dependencies: []
    }
  };
}

function postTask(token: string, body: unknown) {
  return fetch(`${baseUrl}/admin/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function postTaskRead(token: string, body: unknown) {
  return fetch(`${baseUrl}/admin/tasks/read`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function getSyncReport(token: string) {
  return fetch(`${baseUrl}/admin/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'get_project_sync_report', arguments: { projectId } })
  });
}

test('authorized human creates tasks with idempotency while query remains read-only', async () => {
  const body = taskBody();
  const first = await postTask(humanToken, body);
  assert.equal(first.status, 201);
  const created = await first.json() as { _id: string; area: string; repositoryId: string; featureId: string };
  assert.equal(created.area, 'frontend');
  assert.equal(created.repositoryId, repositoryId);
  assert.equal(created.featureId, featureId);
  assert.ok(await Task.exists({ _id: created._id, projectId }));

  const retry = await postTask(humanToken, body);
  assert.equal(retry.status, 201);
  assert.equal((await retry.json() as { _id: string })._id, created._id);
  assert.equal(await Event.countDocuments({ entityId: created._id, action: 'create_task' }), 1);

  const conflictingRetry = await postTask(humanToken, taskBody(body.operationId, 'Changed payload'));
  assert.equal(conflictingRetry.status, 409);
  assert.match((await conflictingRetry.json() as { error: string }).error, /reused with different arguments/i);

  const queryWrite = await fetch(`${baseUrl}/admin/query`, {
    method: 'POST', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'create_task', arguments: taskBody() })
  });
  assert.equal(queryWrite.status, 400);
  assert.match((await queryWrite.json() as { error: string }).error, /Read-only query required/);
  await assert.rejects(service.call(human, 'create_feature', { operationId: op(), projectId, data: { name: 'Forbidden', objective: 'No', context: 'No', acceptance: ['No'] } }), /Agent scope required/);
});

test('task creation rejects outsiders, readers, invalid project links and invalid schemas', async () => {
  const taskCountBefore = await Task.countDocuments({ projectId });
  assert.equal((await postTask(outsiderToken, taskBody())).status, 403);
  assert.equal((await postTask(readerToken, taskBody())).status, 403);

  const invalidRepository = taskBody();
  invalidRepository.data.repositoryId = op();
  assert.equal((await postTask(humanToken, invalidRepository)).status, 409);

  const invalidFeature = taskBody();
  invalidFeature.data.featureId = op();
  assert.equal((await postTask(humanToken, invalidFeature)).status, 409);

  const invalidDependency = taskBody();
  invalidDependency.data.dependencies = [op()];
  assert.equal((await postTask(humanToken, invalidDependency)).status, 409);

  const invalidSchema = taskBody();
  invalidSchema.data.area = 'design';
  assert.equal((await postTask(humanToken, invalidSchema)).status, 400);

  const archivedRepositoryId = op();
  const archivedProject = await service.call(agent, 'create_project', { operationId: op(), data: {
    name: 'Archived project', description: 'Archived project validation', instructions: 'Test project',
    repositories: [{ id: archivedRepositoryId, name: 'repo', url: 'https://example.com/archived.git', instructions: 'Test repository' }]
  } });
  await service.call(agent, 'archive_record', { operationId: op(), projectId: archivedProject._id, kind: 'project', id: archivedProject._id, version: archivedProject.version });
  const archivedTask = taskBody();
  archivedTask.projectId = archivedProject._id;
  archivedTask.data.repositoryId = archivedRepositoryId;
  archivedTask.data.featureId = null;
  assert.equal((await postTask(humanToken, archivedTask)).status, 409);
  assert.equal(await Task.countDocuments({ projectId }), taskCountBefore);
});

test('human task read route is scoped to the token user and validates cursor, task, and idempotency', async () => {
  const unauthorized = await fetch(`${baseUrl}/admin/tasks/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauthorized.status, 401);
  assert.equal((await postTaskRead(outsiderToken, { operationId: op(), projectId, taskId: op(), cursor: 0 })).status, 403);

  // Establish each user's baseline before a different member creates activity.
  assert.equal((await postTask(humanToken, taskBody(op(), 'Read baseline task'))).status, 201);
  assert.equal((await getSyncReport(humanToken)).status, 200);
  assert.equal((await getSyncReport(readerToken)).status, 200);
  const authorToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'task-ui-author', scope: 'agent', token: authorToken });
  const project = await Project.findById(projectId).lean();
  await service.admin(human, { action: 'member', operationId: op(), projectId, version: project!.version, userId: 'task-ui-author', role: 'colaborador' });
  const author = await authenticate(authorToken, 'agent');
  const createdTask = await service.call(author, 'create_task', taskBody(op(), 'Unread activity task'));
  assert.equal((await postTaskRead(authorToken, { operationId: op(), projectId, taskId: createdTask._id, cursor: 0 })).status, 401);

  const ownerReport = await (await getSyncReport(humanToken)).json() as { tasks: Array<{ taskId: string; unread: { count: number; cursor: number | null } }> };
  const unread = ownerReport.tasks.find(item => item.taskId === createdTask._id)?.unread;
  assert.ok(unread && unread.count > 0 && unread.cursor !== null);
  const cursor = unread.cursor;
  const body = { operationId: op(), projectId, taskId: createdTask._id, cursor };
  const marked = await postTaskRead(humanToken, body);
  assert.equal(marked.status, 200);
  assert.equal((await marked.json() as { cursor: number }).cursor, cursor);
  assert.equal((await postTaskRead(humanToken, body)).status, 200);
  const lowerCursor = await postTaskRead(humanToken, { ...body, operationId: op(), cursor: 0 });
  assert.equal(lowerCursor.status, 200);
  assert.equal((await lowerCursor.json() as { cursor: number }).cursor, cursor);
  assert.equal(await TaskRead.countDocuments({ projectId, userId: human.userId, taskId: createdTask._id }), 1);

  const readerReport = await (await getSyncReport(readerToken)).json() as { tasks: Array<{ taskId: string; unread: { count: number } }> };
  assert.ok((readerReport.tasks.find(item => item.taskId === createdTask._id)?.unread.count ?? 0) > 0);

  const future = await postTaskRead(readerToken, { ...body, operationId: op(), cursor: cursor + 1_000_000 });
  assert.equal(future.status, 400);
  const userIdInjection = await postTaskRead(humanToken, { ...body, operationId: op(), userId: 'task-ui-reader' });
  assert.equal(userIdInjection.status, 400);
  const queryMutation = await fetch(`${baseUrl}/admin/query`, {
    method: 'POST', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'mark_task_read', arguments: body })
  });
  assert.equal(queryMutation.status, 400);

  const outsideRepositoryId = op();
  const outsideProject = await service.call(author, 'create_project', { operationId: op(), data: {
    name: 'Other project', description: 'Task read scope test', instructions: 'Test project',
    repositories: [{ id: outsideRepositoryId, name: 'repo', url: 'https://example.com/other.git', instructions: 'Test repository' }]
  } });
  const outsideTask = await service.call(author, 'create_task', { operationId: op(), projectId: outsideProject._id, data: {
    name: 'Other project task', instructions: 'Scope test', acceptance: ['Exists'], priority: 2, area: 'backend',
    repositoryId: outsideRepositoryId, featureId: null, dependencies: []
  } });
  const mismatch = await postTaskRead(humanToken, { ...body, operationId: op(), taskId: outsideTask._id });
  assert.equal(mismatch.status, 404);
});
