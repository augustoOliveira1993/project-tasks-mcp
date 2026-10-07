import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { authenticate, bootstrap, Service, type Actor } from '../src/service.js';
import { connect, DeliveryRead, Event, TaskMessage } from '../src/db.js';
import { createApp } from '../src/http.js';
import { listAccessibleProjects, matchGitProjects } from '../src/bridge/project-resolution.js';

let repl: MongoMemoryReplSet;
let service: Service;
let human: Actor;
let owner: Actor;
let member: Actor;
let outsider: Actor;
let ownerToken: string;
const operationId = () => randomUUID();

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('collaboration-sync'));
  service = new Service();
  human = await authenticate(await bootstrap('sync-owner'), 'human');
  async function issue(userId: string) {
    const token = randomBytes(32).toString('hex');
    await service.admin(human, { action: 'issue', operationId: operationId(), userId, scope: 'agent', token });
    return { token, actor: await authenticate(token, 'agent') };
  }
  const issuedOwner = await issue('sync-owner'); ownerToken = issuedOwner.token; owner = issuedOwner.actor;
  member = (await issue('sync-member')).actor;
  outsider = (await issue('sync-outsider')).actor;
});

after(async () => { await mongoose.disconnect(); await repl?.stop(); });

async function fixture() {
  const repositoryId = operationId();
  const project = await service.call(owner, 'create_project', { operationId: operationId(), data: {
    name: 'Sync project', description: 'Collaboration sync tests', instructions: 'Test project', repositories: [{ id: repositoryId, name: 'repo', url: `https://example.com/${repositoryId}.git`, instructions: 'Local' }]
  } });
  const updatedProject = await service.admin(human, { action: 'member', operationId: operationId(), projectId: project._id, version: project.version, userId: 'sync-member', role: 'colaborador' });
  const feature = await service.call(owner, 'create_feature', { operationId: operationId(), projectId: project._id, data: { name: 'Feature', objective: 'Sync', context: 'Task collaboration', acceptance: ['Works'] } });
  const createTask = (name: string) => service.call(owner, 'create_task', { operationId: operationId(), projectId: project._id, data: {
    name, instructions: 'Implement', acceptance: ['Works'], priority: 1, area: 'backend', repositoryId, featureId: feature._id, dependencies: []
  } });
  const first = await createTask('Task A');
  const second = await createTask('Task B');
  return { project: updatedProject, feature, repositoryId, first, second };
}

function messageArgs(projectId: string, taskId: string, type: string, message: string, extra: Record<string, unknown> = {}) {
  return { operationId: operationId(), projectId, taskId, type, message, ...extra };
}

test('project members collaborate, replies close questions, reports summarize tasks and Git diffs', async () => {
  const { project, feature, repositoryId, first, second } = await fixture();
  await assert.rejects(service.call(outsider, 'send_collaboration_message', messageArgs(project._id, first._id, 'mudanca', 'Outsider')), /access denied/i);

  const question = await service.call(owner, 'send_collaboration_message', messageArgs(project._id, first._id, 'pergunta', 'Which API should this use?'));
  const answerArgs = messageArgs(project._id, first._id, 'resposta', 'Use the stable endpoint');
  const answer = await service.call(member, 'send_collaboration_message', answerArgs);
  assert.equal(answer.replyTo, question._id);
  assert.equal(answer.conversationId, question.conversationId);

  const openQuestion = await service.call(owner, 'send_collaboration_message', messageArgs(project._id, second._id, 'pergunta', 'Is this ready?'));
  const changeArgs = messageArgs(project._id, first._id, 'mudanca', 'Updated API contract');
  const change = await service.call({ ...member, clientName: 'sync-test-client' }, 'send_collaboration_message', changeArgs);
  assert.deepEqual(await service.call(member, 'send_collaboration_message', changeArgs), change);
  const event = await Event.findOne({ entityId: change._id, action: 'task_message' }).lean();
  assert.equal(event?.author, member.userId);
  assert.equal(event?.actor.agent, 'sync-test-client');
  await service.call(member, 'send_collaboration_message', messageArgs(project._id, second._id, 'decisao', 'Keep the legacy response shape'));
  await assert.rejects(service.call(member, 'send_collaboration_message', messageArgs(project._id, first._id, 'resposta', 'Wrong thread', { replyTo: openQuestion._id })), /Reply does not belong/i);
  const report = await service.call(owner, 'get_project_sync_report', { projectId: project._id, featureId: feature._id });
  assert.equal(report.summary.taskCount, 2);
  assert.equal(report.summary.openQuestionCount, 1);
  assert.equal(report.tasks.find((task: any) => task.taskId === second._id).openQuestions[0].id, openQuestion._id);

  await service.call(member, 'record_task_diff', { operationId: operationId(), projectId: project._id, taskId: first._id, repositoryId,
    baseCommit: 'a'.repeat(40), commit: 'b'.repeat(40), branch: 'feature/sync', files: ['src/api.ts'], truncated: false });
  const filtered = await service.call(owner, 'get_project_sync_report', { projectId: project._id, featureId: feature._id });
  assert.equal(filtered.tasks.find((task: any) => task.taskId === first._id).gitDiff.branch, 'feature/sync');
  assert.equal((await TaskMessage.find({ projectId: project._id, type: { $in: ['mudanca', 'decisao'] } })).length, 2);
});

test('task unread cursors survive project acknowledgement and are isolated per task', async () => {
  const { project, first, second } = await fixture();
  await service.call(owner, 'get_project_novelties', { projectId: project._id, limit: 100 });
  await service.call(member, 'send_collaboration_message', messageArgs(project._id, first._id, 'mudanca', 'Task A update'));
  await service.call(member, 'send_collaboration_message', messageArgs(project._id, second._id, 'decisao', 'Task B decision'));

  const novelties = await service.call(owner, 'get_project_novelties', { projectId: project._id, limit: 100 });
  assert.deepEqual(new Set(novelties.unreadTasks.map((row: any) => row.taskId)), new Set([first._id, second._id]));
  await service.call(owner, 'mark_project_read', { operationId: operationId(), projectId: project._id, cursor: novelties.cursor });
  assert.equal((await service.call(owner, 'get_project_novelties', { projectId: project._id })).unreadTasks.length, 2);
  const firstUnread = novelties.unreadTasks.find((row: any) => row.taskId === first._id);
  await service.call(owner, 'mark_task_read', { operationId: operationId(), projectId: project._id, taskId: first._id, cursor: firstUnread.lastSequence });
  const remaining = await service.call(owner, 'get_project_novelties', { projectId: project._id });
  assert.deepEqual(remaining.unreadTasks.map((row: any) => row.taskId), [second._id]);
  assert.ok(await DeliveryRead.exists({ projectId: project._id, userId: owner.userId }));
});

test('Git bridge loads later pages and reports every ambiguous repository binding', async () => {
  const requests: any[] = [];
  const target = { _id: 'later', name: 'Later project', repositories: [{ id: 'repo-2', git: { canonicalRemoteUrl: 'https://example.com/repo', rootCommit: 'a'.repeat(40) } }] };
  const projects = await listAccessibleProjects(async (_name, args) => {
    requests.push(args);
    return args.after ? { items: [target], next: null } : { items: [{ _id: 'first', repositories: [] }], next: 'page-2' };
  });
  assert.equal(requests.length, 2);
  assert.equal(projects.length, 2);
  const repo = { remoteUrl: 'https://example.com/repo', rootCommit: 'a'.repeat(40) };
  const matches = matchGitProjects([...projects, { ...target, _id: 'duplicate' }], repo);
  assert.deepEqual(matches.map(match => match.project._id), ['later', 'duplicate']);
});

test('server Git context resolution distinguishes a unique binding from ambiguous projects', async () => {
  const repositoryId = operationId();
  const remoteUrl = `https://example.com/${repositoryId}.git`;
  const createProject = (name: string) => service.call(owner, 'create_project', { operationId: operationId(), data: {
    name, description: 'Resolver test', instructions: 'Test', repositories: [{ id: operationId(), name: 'repo', url: remoteUrl, instructions: 'Local' }]
  } });
  const first = await createProject('Unique binding');
  const context = { workspaceRoot: 'C:/workspace/unique', remoteUrl, rootCommit: 'a'.repeat(40) };
  assert.equal((await service.call(owner, 'resolve_project_context', context)).status, 'matched');
  await createProject('Ambiguous binding');
  const ambiguous = await service.call(owner, 'resolve_project_context', context);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.projectId, null);
  assert.equal(ambiguous.matches.length, 2);
  assert.ok(ambiguous.matches.every((match: any) => match.projectId !== first._id || match.repositories.length === 1));
});

test('MCP initialize client identity is attached to collaboration events', async () => {
  const { project, first } = await fixture();
  const server = createApp(service, []).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  for (const path of ['/', '/projects', '/tasks', '/tasks/task-1', '/conversations', '/activity', '/settings', '/help']) {
    const page = await fetch(`http://127.0.0.1:${address.port}${path}?projectId=${project._id}`);
    assert.equal(page.status, 200, `${path} should serve the SPA entry point`);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  }
  const client = new Client({ name: 'sync-http-client', version: '1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${ownerToken}` } } }));
    const response = await client.callTool({ name: 'send_collaboration_message', arguments: { ...messageArgs(project._id, first._id, 'mudanca', 'HTTP client event'), operationId: operationId() } });
    assert.ok(!response.isError);
    const result = JSON.parse(String((response.content as any[])[0].text));
    const event = await Event.findOne({ entityId: result._id, action: 'task_message' }).lean();
    assert.equal(event?.author, owner.userId);
    assert.equal(event?.actor.agent, 'sync-http-client');
  } finally {
    await client.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
