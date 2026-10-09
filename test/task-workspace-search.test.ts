import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, DeliveryEvent, Feature, Project, Task, TaskDiff, TaskMessage, TaskRead } from '../src/db.js';
import { authenticate, bootstrap, Service, type Actor } from '../src/service.js';
import { taskWorkspaceSearch } from '../src/schema.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet;
let service: Service;
let owner: Actor;
let ownerToken: string;

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('task-workspace-search'));
  service = new Service();
  ownerToken = await bootstrap('filter-owner');
  owner = await authenticate(ownerToken, 'human');
});

after(async () => { await mongoose.disconnect(); await repl?.stop(); });

test('workspace search validates typed nested rules, isolates active project rows, pages stably, and evaluates collaboration flags', async () => {
  const repositoryId = randomUUID();
  const project = await service.call(owner, 'create_project', { operationId: randomUUID(), data: {
    name: 'Filter workspace', description: 'Search tests', instructions: 'Test project',
    repositories: [{ id: repositoryId, name: 'repo', url: `https://example.com/${repositoryId}.git`, instructions: 'Local' }], areas: ['backend', 'frontend']
  } });
  const feature = await service.call(owner, 'create_feature', { operationId: randomUUID(), projectId: project._id, data: {
    name: 'Queue feature', objective: 'Build queue', context: 'Filters', acceptance: ['Works']
  } });
  const otherProject = await service.call(owner, 'create_project', { operationId: randomUUID(), data: {
    name: 'Other project', description: 'Isolation', instructions: 'No leakage',
    repositories: [{ id: randomUUID(), name: 'repo', url: `https://example.com/${randomUUID()}.git`, instructions: 'Local' }]
  } });
  const ids: string[] = [];
  const records = Array.from({ length: 12 }, (_item, index) => {
    const _id = randomUUID(); ids.push(_id);
    return {
      _id, projectId: project._id, version: 0, archived: false, name: index === 0 ? 'Cutover alpha' : `Task ${String(index).padStart(2, '0')}`,
      status: index < 2 ? 'pendente' : index === 2 ? 'em_revisao' : 'concluida', priority: index === 0 ? 5 : index === 1 ? 3 : 2,
      area: index === 1 ? 'frontend' : 'backend', type: index % 2 ? 'fix' : 'feature', responsible: index === 0 ? 'ana@example.com' : 'codex',
      featureId: feature._id, repositoryId, checked: index > 3, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)), updatedAt: new Date(Date.UTC(2026, 0, 2, 0, index))
    };
  });
  await Task.insertMany(records);
  await Task.create({ _id: randomUUID(), projectId: project._id, archived: true, name: 'Archived task', status: 'pendente', priority: 1, area: 'backend' });
  await Task.create({ _id: randomUUID(), projectId: otherProject._id, archived: false, name: 'Foreign task', status: 'pendente', priority: 1, area: 'backend' });
  await TaskRead.create({ projectId: project._id, userId: owner.userId, taskId: '__project_baseline__', lastSequence: 0 });

  const first = await service.searchTaskWorkspace(owner, { projectId: project._id, sort: 'created', limit: 10 });
  assert.equal(first.total, 12, 'archived and foreign project tasks stay outside the queue');
  assert.equal(first.items.length, 10);
  assert.ok(first.next);
  const second = await service.searchTaskWorkspace(owner, { projectId: project._id, sort: 'created', limit: 10, after: first.next });
  assert.equal(second.total, 12);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((task: any) => task._id)).size, 12);
  await assert.rejects(service.searchTaskWorkspace(owner, { projectId: project._id, sort: 'created', limit: 10, quick: { status: 'pendente' }, after: first.next }), /cursor/i);

  const expression = { kind: 'group', operator: 'AND', children: [
    { kind: 'condition', field: 'status', operator: 'is', value: 'pendente' },
    { kind: 'group', operator: 'OR', children: [
      { kind: 'condition', field: 'priority', operator: 'gte', value: 5 },
      { kind: 'condition', field: 'area', operator: 'is', value: 'frontend' }
    ] }
  ] };
  const combined = await service.searchTaskWorkspace(owner, { projectId: project._id, expression, limit: 10 });
  assert.deepEqual(new Set(combined.items.map((task: any) => task._id)), new Set(ids.slice(0, 2)));
  assert.equal(combined.total, 2);

  const textMatch = await service.searchTaskWorkspace(owner, { projectId: project._id, quick: { search: 'Cutover' }, limit: 10 });
  assert.deepEqual(textMatch.items.map((task: any) => task._id), [ids[0]]);
  const containsMatch = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'name', operator: 'contains', value: 'Cutover' }, limit: 10 });
  assert.deepEqual(containsMatch.items.map((task: any) => task._id), [ids[0]]);
  const notMatch = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'name', operator: 'not', value: 'Cutover' }, limit: 20 });
  assert.equal(notMatch.total, 11, 'not excludes names that contain the supplied text');
  assert.ok(notMatch.items.every((task: any) => !task.name.includes('Cutover')));
  const exactMatch = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'name', operator: 'exact', value: 'Cutover alpha' }, limit: 10 });
  assert.deepEqual(exactMatch.items.map((task: any) => task._id), [ids[0]]);
  const suffixMatch = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'name', operator: 'endsWith', value: '03' }, limit: 10 });
  assert.deepEqual(suffixMatch.items.map((task: any) => task._id), [ids[3]]);
  const priorityRange = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'priority', operator: 'between', value: [3, 5] }, limit: 10 });
  assert.deepEqual(new Set(priorityRange.items.map((task: any) => task._id)), new Set(ids.slice(0, 2)));
  assert.throws(() => taskWorkspaceSearch.parse({ projectId: project._id, expression: { kind: 'condition', field: 'priority', operator: 'between', value: [5, 3] } }));

  await TaskMessage.create({ _id: randomUUID(), projectId: project._id, taskId: ids[0], type: 'pergunta', author: 'agent', message: 'Question', conversationId: 'legacy-thread', createdAt: new Date('2026-02-01T00:00:00Z') });
  let collaboration = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'openQuestions', operator: 'is', value: true }, limit: 10 });
  assert.deepEqual(collaboration.items.map((task: any) => task._id), [ids[0]]);
  assert.equal(collaboration.items[0].workspace.openQuestionCount, 1);
  await TaskMessage.create({ _id: randomUUID(), projectId: project._id, taskId: ids[0], type: 'resposta', author: 'human', message: 'Legacy reply', conversationId: 'legacy-thread', createdAt: new Date('2026-02-02T00:00:00Z') });
  collaboration = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'openQuestions', operator: 'is', value: false }, limit: 10 });
  assert.ok(!collaboration.items.some((task: any) => task._id === ids[0]), 'legacy conversation replies close the question');

  const eventHead = await Project.findById(project._id).select('eventSequence').lean();
  await DeliveryEvent.create({ _id: randomUUID(), projectId: project._id, sequence: (eventHead?.eventSequence ?? 0) + 1, taskIds: [ids[1]], author: 'other-agent', action: 'task.updated', kind: 'task', at: new Date() });
  await TaskDiff.create({ _id: randomUUID(), projectId: project._id, taskId: ids[1], repositoryId, commit: 'a'.repeat(40), baseCommit: 'b'.repeat(40), branch: 'feature/search', files: ['src/task.ts'], truncated: false, createdAt: new Date() });
  const unread = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'unread', operator: 'is', value: true }, limit: 10 });
  assert.deepEqual(unread.items.map((task: any) => task._id), [ids[1]]);
  assert.equal(unread.items[0].workspace.unreadCount, 1);
  const withDiff = await service.searchTaskWorkspace(owner, { projectId: project._id, expression: { kind: 'condition', field: 'hasGitDiff', operator: 'is', value: true }, limit: 10 });
  assert.deepEqual(withDiff.items.map((task: any) => task._id), [ids[1]]);
  assert.equal(withDiff.items[0].workspace.hasGitDiff, true);

  assert.throws(() => taskWorkspaceSearch.parse({ projectId: project._id, expression: { kind: 'condition', field: 'status', operator: 'contains', value: 'pendente' } }));
  assert.throws(() => taskWorkspaceSearch.parse({ projectId: project._id, expression: { kind: 'condition', field: 'id', operator: 'contains', value: ids[0] } }), 'IDs remain exact or prefix matches to preserve indexed lookup');
  assert.throws(() => taskWorkspaceSearch.parse({ projectId: project._id, expression: { kind: 'condition', field: 'status', operator: 'is', value: { $ne: 'cancelada' } } }));
  let tooDeep: any = { kind: 'condition', field: 'checked', operator: 'is', value: true };
  for (let index = 0; index < 4; index++) tooDeep = { kind: 'group', operator: 'AND', children: [tooDeep] };
  assert.throws(() => taskWorkspaceSearch.parse({ projectId: project._id, expression: tooDeep }));
  const tooMany = { kind: 'group', operator: 'AND', children: Array.from({ length: 21 }, () => ({ kind: 'condition', field: 'checked', operator: 'is', value: true })) };
  assert.throws(() => taskWorkspaceSearch.parse({ projectId: project._id, expression: tooMany }));

  await assert.rejects(service.searchTaskWorkspace(owner, { projectId: randomUUID(), limit: 10 }), /access denied/i);

  const app = createApp(service, []);
  const server = createServer(app).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const url = `http://127.0.0.1:${address.port}/admin/tasks/search`;
    const denied = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project._id }) });
    assert.equal(denied.status, 401);
    const authorized = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project._id, limit: 10 }) });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json() as any).total, 12);
  } finally {
    await app.locals.close?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
