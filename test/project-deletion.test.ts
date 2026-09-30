import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  AutomationJob,
  AutomationPolicy,
  Credential,
  DeliveryEvent,
  DeliveryRead,
  Event,
  Execution,
  Feature,
  MarkdownDocument,
  MarkdownRevision,
  Operation,
  Project,
  Runner,
  Task,
  TaskDiff,
  TaskMessage,
  connect
} from '../src/db.js';
import { authenticate, bootstrap, Service, trustedLocal, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';
import { env } from '../src/env.js';

let repl: MongoMemoryReplSet;
let service: Service;
let adminToken: string;
let admin: Actor;
let agentToken: string;
let regularHumanToken: string;
const op = () => randomUUID();
const token = () => randomBytes(32).toString('hex');

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('project-deletion'));
  service = new Service();
  adminToken = await bootstrap('root@example.com');
  admin = await authenticate(adminToken, 'human');
  agentToken = token();
  await service.admin(admin, { action: 'issue', operationId: op(), userId: 'agent@example.com', scope: 'agent', systemAdmin: false, token: agentToken });
  const regularToken = token();
  await service.admin(admin, { action: 'issue', operationId: op(), userId: 'member@example.com', scope: 'human', systemAdmin: false, token: regularToken });
  regularHumanToken = regularToken;
});

after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

async function makeProject(name: string, repositories = [randomUUID()]) {
  const projectId = randomUUID();
  await Project.create({
    _id: projectId,
    name,
    description: name,
    instructions: 'fixture',
    repositories: repositories.map((id, index) => ({ id, name: `repo-${index}`, url: `https://example.test/${id}.git`, instructions: 'fixture' })),
    members: { root: 'administrador' }
  });
  return { projectId, repositoryIds: repositories };
}

async function startServer() {
  const app = createApp(service, []);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await (app.locals as any).close?.();
    }
  };
}

test('hard delete endpoint accepts only an active system administrator credential', async () => {
  const { projectId } = await makeProject('Authorization target');
  const server = await startServer();
  try {
    const path = `${server.url}/admin/projects/${projectId}`;
    const capabilitiesUrl = `${server.url}/admin/capabilities`;
    const readCapabilities = async (credential: string) => {
      const response = await fetch(capabilitiesUrl, { headers: { authorization: `Bearer ${credential}` } });
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.deepEqual(await readCapabilities(adminToken), { scope: 'human', systemAdmin: true, canHardDelete: true });
    assert.deepEqual(await readCapabilities(regularHumanToken), { scope: 'human', systemAdmin: false, canHardDelete: false });
    assert.deepEqual(await readCapabilities(agentToken), { scope: 'agent', systemAdmin: false, canHardDelete: false });
    const localCapabilities = await fetch(capabilitiesUrl, { headers: { 'x-project-tasks-email': 'member@example.com' } });
    if (env.authMode === 'trusted_local') {
      assert.equal(localCapabilities.status, 200);
      assert.deepEqual(await localCapabilities.json(), { scope: 'trusted_local', systemAdmin: false, canHardDelete: false });
    } else assert.equal(localCapabilities.status, 401);

    const request = (authorization?: string, extraHeaders: Record<string, string> = {}) => fetch(path, {
      method: 'DELETE',
      headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ operationId: op() })
    });

    assert.equal((await request()).status, 401);
    assert.equal((await request(agentToken)).status, 401);
    assert.equal((await request(undefined, { 'x-project-tasks-email': 'member@example.com' })).status, 401);
    assert.equal((await request(regularHumanToken)).status, 403);
    await assert.rejects(service.deleteProject(await authenticate(agentToken, 'agent'), projectId, op()), /Human credential required/);
    await assert.rejects(service.deleteProject(trustedLocal('member@example.com'), projectId, op()), /Human credential required/);
    assert.ok(await Project.exists({ _id: projectId }));

    const success = await fetch(path, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: op() })
    });
    assert.equal(success.status, 200);
    assert.equal((await success.json() as any).deleted, true);
    assert.equal(await Project.exists({ _id: projectId }), null);
  } finally {
    await server.close();
  }
});

test('archive_record remains reversible project archival, separate from hard deletion', async () => {
  const agent = await authenticate(agentToken, 'agent');
  const project = await service.call(agent, 'create_project', {
    operationId: op(),
    data: {
      name: 'Reversible archive fixture',
      description: 'archive_record test',
      instructions: 'fixture',
      repositories: [{ id: randomUUID(), name: 'repo', url: 'https://example.test/archive.git', instructions: 'fixture' }]
    }
  });
  const archived = await service.call(agent, 'archive_record', {
    operationId: op(), projectId: project._id, kind: 'project', id: project._id, version: project.version
  });
  assert.equal(archived.archived, true);
  assert.ok(await Project.exists({ _id: project._id, archived: true }));
});

test('HTTP archive endpoint keeps archive_record separate from permanent deletion', async () => {
  const { projectId } = await makeProject('HTTP archive target');
  const project = await Project.findById(projectId).lean();
  assert.ok(project);
  const server = await startServer();
  try {
    const response = await fetch(`${server.url}/admin/archive`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: op(), projectId, kind: 'project', id: projectId, version: project.version })
    });
    assert.equal(response.status, 200, await response.clone().text());
    const archived = await response.json() as { _id: string; archived: boolean };
    assert.equal(archived._id, projectId);
    assert.equal(archived.archived, true);
    assert.ok(await Project.exists({ _id: projectId, archived: true }));
  } finally {
    await server.close();
  }
});

test('hard delete returns 409 and preserves a project with active task, execution, or runner work', async () => {
  const server = await startServer();
  const cases: Array<{ name: string; taskStatus: string; executionStatus?: string; jobStatus?: string; turnInFlight?: boolean }> = [
    { name: 'active task', taskStatus: 'em_execucao' },
    { name: 'active execution', taskStatus: 'pendente', executionStatus: 'em_execucao' },
    { name: 'reserved runner', taskStatus: 'pendente', jobStatus: 'reserved' },
    { name: 'in-flight provider turn', taskStatus: 'pendente', jobStatus: 'completed', turnInFlight: true }
  ];
  try {
    for (const scenario of cases) {
      const project = await makeProject(`Active guard ${scenario.name}`);
      const taskId = randomUUID();
      const executionId = randomUUID();
      await Task.create([{
        _id: taskId,
        projectId: project.projectId,
        name: scenario.name,
        instructions: 'fixture',
        acceptance: [],
        repositoryId: project.repositoryIds[0],
        dependencies: [],
        status: scenario.taskStatus,
        ...(scenario.executionStatus ? { executionId } : {})
      }]);
      if (scenario.executionStatus) {
        await Execution.create([{ _id: executionId, projectId: project.projectId, taskId, status: scenario.executionStatus }]);
      }
      if (scenario.jobStatus) {
        await AutomationJob.create([{
          _id: randomUUID(),
          projectId: project.projectId,
          taskId,
          repositoryId: project.repositoryIds[0],
          status: scenario.jobStatus,
          turnInFlight: scenario.turnInFlight ?? false
        }]);
      }

      const response = await fetch(`${server.url}/admin/projects/${project.projectId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: op() })
      });
      assert.equal(response.status, 409, scenario.name);
      assert.ok(await Project.exists({ _id: project.projectId }), scenario.name);
      assert.ok(await Task.exists({ _id: taskId, projectId: project.projectId }), scenario.name);
      if (scenario.executionStatus) assert.ok(await Execution.exists({ _id: executionId }), scenario.name);
      if (scenario.jobStatus) assert.ok(await AutomationJob.exists({ projectId: project.projectId }), scenario.name);
    }
  } finally {
    await server.close();
  }
});

test('hard delete cascades project data, preserves shared credentials and other projects, and rolls back on failure', async () => {
  const sharedRepositoryId = randomUUID();
  const exclusiveRepositoryId = randomUUID();
  const target = await makeProject('Delete target', [sharedRepositoryId, exclusiveRepositoryId]);
  const other = await makeProject('Surviving project', [sharedRepositoryId]);
  const targetFeatureId = randomUUID();
  const otherFeatureId = randomUUID();
  const targetTaskId = randomUUID();
  const otherTaskId = randomUUID();
  const targetExecutionId = randomUUID();
  const targetDocumentId = randomUUID();
  const sharedToken = token();
  const targetProject = await Project.findById(target.projectId).lean();
  const otherProject = await Project.findById(other.projectId).lean();
  assert.ok(targetProject && otherProject);
  const issued = await service.admin(admin, { action: 'issue_project_member', operationId: op(), projectId: target.projectId, version: targetProject.version, userId: 'shared@example.com', token: sharedToken });
  await service.admin(admin, { action: 'member', operationId: op(), projectId: other.projectId, version: otherProject.version, userId: 'shared@example.com', role: 'administrador' });

  await Feature.create([
    { _id: targetFeatureId, projectId: target.projectId, name: 'Target feature', objective: 'Delete me', context: 'fixture', acceptance: [] },
    { _id: otherFeatureId, projectId: other.projectId, name: 'Other feature', objective: 'Keep me', context: 'fixture', acceptance: [] }
  ]);
  await Task.create([
    { _id: targetTaskId, projectId: target.projectId, featureId: targetFeatureId, name: 'Target task', instructions: 'Delete me', acceptance: [], repositoryId: exclusiveRepositoryId, dependencies: [], status: 'pendente' },
    { _id: otherTaskId, projectId: other.projectId, featureId: otherFeatureId, name: 'Other task', instructions: 'Keep me', acceptance: [], repositoryId: sharedRepositoryId, dependencies: [], status: 'pendente' }
  ]);
  await Execution.create([{ _id: targetExecutionId, projectId: target.projectId, taskId: targetTaskId, credentialId: issued.credentialId, userId: 'shared@example.com', status: 'approve' }]);
  await Event.create([
    { _id: randomUUID(), projectId: target.projectId, entityId: targetTaskId, action: 'fixture', author: 'root@example.com', at: new Date(), data: { content: 'project scoped' } },
    { _id: randomUUID(), projectId: other.projectId, entityId: otherTaskId, action: 'fixture', author: 'root@example.com', at: new Date(), data: { content: 'survive' } }
  ]);
  await TaskMessage.create([{ _id: randomUUID(), projectId: target.projectId, taskId: targetTaskId, message: 'remove', author: 'shared@example.com' }]);
  await DeliveryEvent.create([
    { _id: randomUUID(), projectId: target.projectId, sequence: 2, taskIds: [targetTaskId], action: 'fixture', at: new Date() },
    { _id: randomUUID(), projectId: other.projectId, sequence: 2, taskIds: [otherTaskId], action: 'fixture', at: new Date() }
  ]);
  await DeliveryRead.create([
    { projectId: target.projectId, userId: 'shared@example.com', lastSequence: 1 },
    { projectId: other.projectId, userId: 'shared@example.com', lastSequence: 1 }
  ]);
  await TaskDiff.create([{ _id: randomUUID(), projectId: target.projectId, taskId: targetTaskId, repositoryId: exclusiveRepositoryId, files: [], patch: '', author: 'shared@example.com' }]);
  await AutomationPolicy.create([{ _id: target.projectId, enabled: true }, { _id: other.projectId, enabled: true }]);
  await AutomationJob.create([
    { _id: randomUUID(), projectId: target.projectId, taskId: targetTaskId, repositoryId: exclusiveRepositoryId, status: 'queued' },
    { _id: randomUUID(), projectId: other.projectId, taskId: otherTaskId, repositoryId: sharedRepositoryId, status: 'queued' }
  ]);
  await Runner.create([{ _id: randomUUID(), credentialId: issued.credentialId, machineId: 'shared-runner', repositories: [sharedRepositoryId, exclusiveRepositoryId], providers: ['anthropic'], maxConcurrent: 2 }]);
  await MarkdownDocument.create([{ _id: targetDocumentId, projectId: target.projectId, targetKind: 'task', targetId: targetTaskId, name: 'plan.md', summary: 'Target', revision: 1 }]);
  await MarkdownRevision.create([{ _id: randomUUID(), projectId: target.projectId, documentId: targetDocumentId, revision: 1, summary: 'Target', content: 'sensitive project content' }]);
  await Operation.create([
    { _id: `legacy:${op()}`, projectId: target.projectId, fingerprint: 'target', result: { projectId: target.projectId } },
    { _id: `other:${op()}`, projectId: other.projectId, fingerprint: 'other', result: { projectId: other.projectId } }
  ]);

  const originalDeleteOne = Project.deleteOne;
  (Project as any).deleteOne = function (...args: any[]) {
    if (args[1]?.session) throw new Error('injected final write failure');
    return originalDeleteOne.apply(Project, args as any);
  };
  try {
    await assert.rejects(service.deleteProject(admin, target.projectId, op()), /injected final write failure/);
  } finally {
    (Project as any).deleteOne = originalDeleteOne;
  }
  assert.ok(await Project.exists({ _id: target.projectId }));
  assert.ok(await Task.exists({ _id: targetTaskId }));
  assert.ok(await TaskMessage.exists({ projectId: target.projectId }));

  const server = await startServer();
  let operationId = op();
  try {
    const response = await fetch(`${server.url}/admin/projects/${target.projectId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId })
    });
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.deleted, true);
    assert.ok(result.removed.features >= 1 && result.removed.tasks >= 1);
    assert.equal(await Project.exists({ _id: target.projectId }), null);
    assert.equal(await Feature.exists({ projectId: target.projectId }), null);
    assert.equal(await Task.exists({ projectId: target.projectId }), null);
    assert.equal(await Execution.exists({ projectId: target.projectId }), null);
    assert.equal(await Event.exists({ projectId: target.projectId }), null);
    assert.equal(await TaskMessage.exists({ projectId: target.projectId }), null);
    assert.equal(await DeliveryEvent.exists({ projectId: target.projectId }), null);
    assert.equal(await DeliveryRead.exists({ projectId: target.projectId }), null);
    assert.equal(await TaskDiff.exists({ projectId: target.projectId }), null);
    assert.equal(await AutomationPolicy.exists({ _id: target.projectId }), null);
    assert.equal(await AutomationJob.exists({ projectId: target.projectId }), null);
    assert.equal(await MarkdownDocument.exists({ projectId: target.projectId }), null);
    assert.equal(await MarkdownRevision.exists({ projectId: target.projectId }), null);
    assert.equal(await Operation.exists({ projectId: target.projectId }), null);
    assert.equal(await Runner.exists({ repositories: exclusiveRepositoryId }), null);
    assert.ok(await Project.exists({ _id: other.projectId }));
    assert.ok(await Feature.exists({ _id: otherFeatureId }));
    assert.ok(await Task.exists({ _id: otherTaskId }));
    assert.ok(await AutomationJob.exists({ projectId: other.projectId }));
    assert.ok(await AutomationPolicy.exists({ _id: other.projectId }));
    assert.ok(await Operation.exists({ projectId: other.projectId }));
    const runner = await Runner.findOne({ credentialId: issued.credentialId }).lean();
    assert.deepEqual(runner?.repositories, [sharedRepositoryId]);
    assert.ok(await Credential.exists({ _id: issued.credentialId, scope: 'human', revoked: false }));
    assert.ok(await authenticate(sharedToken, 'human'));
    const sharedActor = await authenticate(sharedToken, 'human');
    assert.ok(await service.access(sharedActor, other.projectId));
    const audit = await Event.findOne({ action: 'hard_delete_project', entityId: target.projectId, projectId: { $exists: false } }).lean();
    assert.ok(audit);
    assert.equal(JSON.stringify(audit).includes(sharedToken), false);
    assert.equal(JSON.stringify(audit).includes('sensitive project content'), false);

    const retry = await fetch(`${server.url}/admin/projects/${target.projectId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId })
    });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json() as any).deleted, true);
    operationId = op();
    const missing = await fetch(`${server.url}/admin/projects/${target.projectId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId })
    });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});
