import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Project, Feature, Task, TaskDependency, Execution, Event, TaskMessage,
  Conversation, ConversationMessage, ActionProposal, DeliveryEvent, TaskDiff, AutomationJob,
  MarkdownDocument, MarkdownRevision } from '../src/db.js';
import { authenticate, bootstrap, Service } from '../src/service.js';
import { createApp } from '../src/http.js';
import { redactExport } from '../src/services/project-export-service.js';

let repl: MongoMemoryReplSet;
const service = new Service();
let adminToken: string;
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('project-export'));
  adminToken = await bootstrap('export-admin@example.com');
});
after(async () => { await mongoose.disconnect(); await repl?.stop(); });

test('snapshot includes archived records, full histories and links beyond one page, excluding other projects and secrets', async () => {
  const projectId = randomUUID(), repositoryId = randomUUID(), taskId = randomUUID(), featureId = randomUUID();
  const documentId = randomUUID(), conversationId = randomUUID(), executionId = randomUUID();
  await Project.create({ _id: projectId, name: 'Exportável', accessTokenHash: 'hidden-hash', members: { admin: 'administrador' }, repositories: [{ id: repositoryId, name: 'repo', url: 'https://user:secret@example.com/repo.git' }] });
  await Feature.create({ _id: featureId, projectId, archived: true });
  await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({ _id: i === 0 ? taskId : randomUUID(), projectId, featureId, repositoryId,
    archived: i > 0, acceptance: ['Critério'], acceptanceProgress: [true], dependencies: [], name: `Tarefa ${i}` })));
  await Task.create({ _id: randomUUID(), projectId: randomUUID(), name: 'Outro projeto' });
  const records: Array<[mongoose.Model<any>, Record<string, unknown>]> = [
    [TaskDependency, { taskId, dependencyId: taskId }], [Execution, { _id: executionId, taskId, result: { summary: 'Preservar', accessToken: 'hidden-token' } }],
    [Event, { entityId: taskId, data: { evidence: 'Evidência completa', nested: { password: 'hidden-password' } } }],
    [TaskMessage, { taskId, executionId, message: 'Mensagem completa' }], [Conversation, { _id: conversationId, taskId }],
    [ConversationMessage, { conversationId, content: 'Conversa completa' }], [ActionProposal, { conversationId, taskId }],
    [DeliveryEvent, { sequence: 1, taskIds: [taskId] }], [TaskDiff, { taskId, patch: 'diff completo' }],
    [AutomationJob, { taskId, providerSessionId: 'hidden-session' }],
    [MarkdownDocument, { _id: documentId, targetId: taskId, targetKind: 'task', name: 'Documento', revision: 2 }],
    [MarkdownRevision, { documentId, revision: 1, content: 'Revisão antiga' }],
    [MarkdownRevision, { documentId, revision: 2, content: 'Conteúdo atual' }]
  ];
  for (const [model, fields] of records) await model.create({ _id: randomUUID(), projectId, ...fields });
  const result = await service.exportProject(await authenticate(adminToken, 'human'), projectId);
  const data = result.data as any;
  assert.equal(result.counts.tasks, 105);
  assert.equal(result.counts.markdownRevisions, 2);
  assert.equal(data.project.repositories[0].id, repositoryId);
  assert.equal(data.tasks.find((t: any) => t._id === taskId).featureId, featureId);
  assert.deepEqual(data.tasks[0].acceptanceProgress, [true]);
  assert.equal(data.features[0].archived, true);
  for (const [key, count] of Object.entries(result.counts)) if (!['project', 'repositories'].includes(key)) assert.equal(data[key].length, count);
  assert.equal(data.executions[0]._id, executionId);
  assert.equal(data.events[0].data.evidence, 'Evidência completa');
  assert.equal(data.conversationMessages[0].conversationId, conversationId);
  assert.equal(data.markdownRevisions[0].documentId, documentId);
  assert.doesNotMatch(JSON.stringify(result), /hidden-|user:secret|Outro projeto/);
  assert.equal(data.project.members, undefined);
  assert.match(result.migrationInstructions, /mapa persistente/);
  assert.match(result.migrationInstructions, /Não apague nem altere a origem/);
  assert.equal((await Project.findById(projectId))?.accessTokenHash, 'hidden-hash');
});

test('HTTP export requires human project administrator and disables caching', async () => {
  const projectId = randomUUID();
  await Project.create({ _id: projectId, name: 'Protected' });
  const actor = await authenticate(adminToken, 'human');
  const memberToken = randomBytes(32).toString('hex'), agentToken = randomBytes(32).toString('hex');
  for (const [scope, token] of [['human', memberToken], ['agent', agentToken]]) await service.admin(actor, {
    action: 'issue', operationId: randomUUID(), userId: `${scope}@example.com`, scope, systemAdmin: false, token
  });
  const app = createApp(service, []), server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const post = (token: string, id = projectId) => fetch(`http://127.0.0.1:${address.port}/admin/projects/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: id })
  });
  try {
    for (const token of ['', memberToken, agentToken]) assert.ok([401, 403].includes((await post(token)).status));
    const response = await post(adminToken);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).schemaVersion, 1);
    assert.equal((await post(adminToken, 'invalid')).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await app.locals.close?.();
  }
});

test('redacts nested secrets and recognizable secrets in free text without changing ordinary content', () => {
  const result = redactExport({ nested: { apiKey: 'secret', credentialId: 'private', text: 'Authorization: Bearer abc123 token=secret https://user:password@host/path' }, content: '# Documento\nCritério cumprido', _id: 'original-id' }) as any;
  assert.equal(result.nested.apiKey, undefined);
  assert.doesNotMatch(result.nested.text, /abc123|secret|user:password/);
  assert.equal(result.content, '# Documento\nCritério cumprido');
  assert.equal(result._id, 'original-id');
});
