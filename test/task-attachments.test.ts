import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Project } from '../src/db.js';
import { authenticate, bootstrap, Service, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet;
let service: Service;
let app: ReturnType<typeof createApp>;
let server: Server;
let baseUrl: string;
let humanToken: string;
let agentToken: string;
let readerToken: string;
let outsiderToken: string;
let human: Actor;
let agent: Actor;
let readerAgent: Actor;
let projectId: string;
let taskId: string;
let otherTaskId: string;
const op = () => randomUUID();

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('task-attachments'));
  service = new Service();
  humanToken = await bootstrap('attachment-owner');
  human = await authenticate(humanToken, 'human');

  agentToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: human.userId, scope: 'agent', token: agentToken });
  agent = await authenticate(agentToken, 'agent');
  const project = await service.call(agent, 'create_project', { operationId: op(), data: {
    name: 'Task attachments', description: 'Attachment API tests', instructions: 'Focused test project',
    repositories: [{ id: op(), name: 'repo', url: 'https://example.com/repo.git', instructions: 'Test repository' }]
  } });
  projectId = project._id;
  const feature = await service.call(agent, 'create_feature', { operationId: op(), projectId, data: {
    name: 'Attachments', objective: 'Attach files', context: 'Test attachment lifecycle', acceptance: ['Files remain task-scoped']
  } });
  const makeTask = (name: string) => service.call(agent, 'create_task', { operationId: op(), projectId, data: {
    name, instructions: 'Test task', acceptance: ['Works'], priority: 1, area: 'backend',
    repositoryId: project.repositories[0].id, featureId: feature._id, dependencies: []
  } });
  taskId = (await makeTask('Attachment owner task'))._id;
  otherTaskId = (await makeTask('Different task'))._id;

  readerToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'attachment-reader', scope: 'human', token: readerToken });
  const currentProject = await Project.findById(projectId).lean();
  await service.admin(human, { action: 'member', operationId: op(), projectId, version: currentProject!.version, userId: 'attachment-reader', role: 'leitor' });
  const readerAgentToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'attachment-agent-reader', scope: 'agent', token: readerAgentToken });
  readerAgent = await authenticate(readerAgentToken, 'agent');
  const projectAfterHumanReader = await Project.findById(projectId).lean();
  await service.admin(human, { action: 'member', operationId: op(), projectId, version: projectAfterHumanReader!.version, userId: readerAgent.userId, role: 'leitor' });
  outsiderToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'attachment-outsider', scope: 'human', token: outsiderToken });

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

function attachmentUrl(task = taskId) {
  return `${baseUrl}/admin/projects/${projectId}/tasks/${task}/attachments`;
}

function upload(token: string, body: Buffer, name = 'foto de teste.jpg', contentType = 'image/jpeg', task = taskId) {
  const query = new URLSearchParams({ filename: name });
  return fetch(`${attachmentUrl(task)}?${query}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, body: new Uint8Array(body)
  });
}

test('task attachments are stored, downloaded and limited to authorized task scope', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
  const uploaded = await upload(humanToken, bytes, '../../foto de teste.jpg');
  assert.equal(uploaded.status, 201);
  const { attachment } = await uploaded.json() as { attachment: { id: string; name: string; contentType: string; size: number; createdAt: string } };
  assert.match(attachment.id, /^[a-f0-9]{24}$/i);
  assert.equal(attachment.name, 'foto de teste.jpg');
  assert.equal(attachment.contentType, 'image/jpeg');
  assert.equal(attachment.size, bytes.length);
  assert.ok(attachment.createdAt);

  const listed = await fetch(attachmentUrl(), { headers: { authorization: `Bearer ${humanToken}` } });
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json() as { items: unknown[] }).items, [attachment]);

  const downloaded = await fetch(`${attachmentUrl()}/${attachment.id}`, { headers: { authorization: `Bearer ${humanToken}` } });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'application/octet-stream');
  assert.match(downloaded.headers.get('content-disposition') ?? '', /attachment;.*filename\*=UTF-8''foto%20de%20teste\.jpg/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);

  const readerList = await fetch(attachmentUrl(), { headers: { authorization: `Bearer ${readerToken}` } });
  assert.equal(readerList.status, 200);
  const readerUpload = await upload(readerToken, bytes);
  assert.equal(readerUpload.status, 403);
  const outsiderList = await fetch(attachmentUrl(), { headers: { authorization: `Bearer ${outsiderToken}` } });
  assert.equal(outsiderList.status, 403);
  const otherTaskDownload = await fetch(`${attachmentUrl(otherTaskId)}/${attachment.id}`, { headers: { authorization: `Bearer ${humanToken}` } });
  assert.equal(otherTaskDownload.status, 404);
  const noAuth = await fetch(attachmentUrl());
  assert.equal(noAuth.status, 401);

  const invalidType = await upload(humanToken, Buffer.from('x'), 'bad.bin', 'not-a-content-type');
  assert.equal(invalidType.status, 400);
  const oversized = await upload(humanToken, Buffer.alloc(25 * 1024 * 1024 + 1));
  assert.equal(oversized.status, 413);
});

test('HTTP task attachment endpoints rename and delete only with write access', async () => {
  const uploaded = await upload(humanToken, Buffer.from('contents'), 'original.txt', 'text/plain');
  assert.equal(uploaded.status, 201);
  const { attachment } = await uploaded.json() as { attachment: { id: string; name: string } };
  const path = `${attachmentUrl()}/${attachment.id}`;

  const readerRename = await fetch(path, { method: 'PATCH', headers: { authorization: `Bearer ${readerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'reader.txt' }) });
  assert.equal(readerRename.status, 403);
  const renamed = await fetch(path, { method: 'PATCH', headers: { authorization: `Bearer ${humanToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ fileName: '../renamed.txt' }) });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json() as { attachment: { name: string } }).attachment.name, 'renamed.txt');

  const readerDelete = await fetch(path, { method: 'DELETE', headers: { authorization: `Bearer ${readerToken}` } });
  assert.equal(readerDelete.status, 403);
  const removed = await fetch(path, { method: 'DELETE', headers: { authorization: `Bearer ${humanToken}` } });
  assert.equal(removed.status, 204);
  const listed = await fetch(attachmentUrl(), { headers: { authorization: `Bearer ${humanToken}` } });
  assert.ok(!((await listed.json() as { items: Array<{ id: string }> }).items).some(item => item.id === attachment.id));
});

test('MCP tools upload, list, download, rename and delete task-scoped attachments', async () => {
  const original = Buffer.from([0, 1, 2, 253, 254, 255]);
  const operationId = op();
  const uploadArgs = {
    operationId, projectId, taskId, fileName: 'via-mcp.bin', contentType: 'application/octet-stream', contentBase64: original.toString('base64')
  };
  const created = await service.call(agent, 'upload_task_attachment', uploadArgs);
  assert.equal(created.attachment.name, 'via-mcp.bin');
  const replay = await service.call(agent, 'upload_task_attachment', uploadArgs);
  assert.equal(replay.attachment.id, created.attachment.id);

  const readerList = await service.call(readerAgent, 'list_task_attachments', { projectId, taskId });
  assert.ok(readerList.items.some((item: { id: string }) => item.id === created.attachment.id));
  await assert.rejects(service.call(readerAgent, 'delete_task_attachment', { operationId: op(), projectId, taskId, attachmentId: created.attachment.id }), /Project access denied/);
  await assert.rejects(service.call(agent, 'upload_task_attachment', { ...uploadArgs, operationId: op(), contentBase64: 'not-base64' }), /Invalid Base64/);
  await assert.rejects(service.call(agent, 'upload_task_attachment', { ...uploadArgs, operationId: op(), contentBase64: Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64') }), /File exceeds maximum size/);

  const listed = await service.call(agent, 'list_task_attachments', { projectId, taskId });
  assert.ok(listed.items.some((item: { id: string }) => item.id === created.attachment.id));
  const downloaded = await service.call(agent, 'download_task_attachment', { projectId, taskId, attachmentId: created.attachment.id });
  assert.deepEqual(Buffer.from(downloaded.contentBase64, 'base64'), original);
  await assert.rejects(service.call(agent, 'download_task_attachment', { projectId, taskId: otherTaskId, attachmentId: created.attachment.id }), /Attachment not found/);

  const renamed = await service.call(agent, 'rename_task_attachment', { operationId: op(), projectId, taskId, attachmentId: created.attachment.id, fileName: '../updated.bin' });
  assert.equal(renamed.attachment.name, 'updated.bin');
  const removed = await service.call(agent, 'delete_task_attachment', { operationId: op(), projectId, taskId, attachmentId: created.attachment.id });
  assert.equal(removed.deleted, true);
  const afterDelete = await service.call(agent, 'list_task_attachments', { projectId, taskId });
  assert.ok(!afterDelete.items.some((item: { id: string }) => item.id === created.attachment.id));
});

test('MCP server advertises the task attachment tools', async () => {
  const headers = { authorization: `Bearer ${agentToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'attachment-test', version: '1.0' } } })
  });
  assert.equal(initialized.status, 200);
  const sessionId = initialized.headers.get('mcp-session-id');
  assert.ok(sessionId);
  try {
    const listed = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { ...headers, 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    });
    assert.equal(listed.status, 200);
    const response = await listed.json() as { result: { tools: Array<{ name: string }> } };
    const names = response.result.tools.map(tool => tool.name);
    for (const name of ['upload_task_attachment', 'list_task_attachments', 'download_task_attachment', 'rename_task_attachment', 'delete_task_attachment']) assert.ok(names.includes(name), `${name} was not advertised`);

    const content = Buffer.alloc(1024 * 1024, 0x5a);
    const uploaded = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { ...headers, 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'upload_task_attachment', arguments: {
        operationId: op(), projectId, taskId, fileName: 'mcp-tool-large.txt', contentType: 'text/plain', contentBase64: content.toString('base64')
      } } })
    });
    assert.equal(uploaded.status, 200);
    const uploadedResult = await uploaded.json() as { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.equal(uploadedResult.result.isError, undefined);
    assert.equal((JSON.parse(uploadedResult.result.content[0].text) as { attachment: { size: number } }).attachment.size, content.length);
  } finally {
    await fetch(`${baseUrl}/mcp`, { method: 'DELETE', headers: { ...headers, 'mcp-session-id': sessionId! } });
  }
});
