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
let readerToken: string;
let outsiderToken: string;
let human: Actor;
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

  const agentToken = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: human.userId, scope: 'agent', token: agentToken });
  const agent = await authenticate(agentToken, 'agent');
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
