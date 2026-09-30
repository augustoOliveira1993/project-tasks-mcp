import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Project } from '../src/db.js';
import { authenticate, bootstrap, Service, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';

let repl: MongoMemoryReplSet;
let service: Service;
let adminToken: string;
let admin: Actor;
let creator: Actor;
const operationId = () => randomUUID();
const token = () => randomBytes(32).toString('hex');

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('credentials'));
  service = new Service();
  adminToken = await bootstrap('root@example.com');
  admin = await authenticate(adminToken, 'human');
  const agentToken = token();
  await service.admin(admin, { action: 'issue', operationId: operationId(), userId: 'creator@example.com', scope: 'agent', systemAdmin: false, token: agentToken });
  creator = await authenticate(agentToken, 'agent');
});

after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

async function createProject(name: string) {
  return service.call(creator, 'create_project', {
    operationId: operationId(),
    data: {
      name,
      description: 'Credential inventory test',
      instructions: 'Test fixture',
      repositories: [{ id: operationId(), name: 'repo', url: 'https://example.test/repo.git', instructions: 'test' }]
    }
  });
}

async function issueMember(projectId: string, email: string) {
  const project = await Project.findById(projectId).lean();
  assert.ok(project);
  const issuedToken = token();
  const result = await service.admin(admin, { action: 'issue_project_member', operationId: operationId(), projectId, version: project.version, userId: email, token: issuedToken });
  return { credentialId: result.credentialId, token: issuedToken };
}

test('admin credential inventory is paginated, searchable and never returns secrets', async () => {
  const project = await createProject('Credential project');
  const member = await issueMember(project._id, 'person@example.com');
  const agentToken = token();
  const agent = await service.admin(admin, { action: 'issue', operationId: operationId(), userId: 'agent@example.com', scope: 'agent', systemAdmin: false, token: agentToken });
  const secondAgentToken = token();
  const secondAgent = await service.admin(admin, { action: 'issue', operationId: operationId(), userId: 'agent@example.com', scope: 'agent', systemAdmin: false, token: secondAgentToken });

  const app = createApp(service, []);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/admin/credentials`;
  const headers = { authorization: `Bearer ${adminToken}` };
  try {
    const firstPageResponse = await fetch(`${url}?scope=agent&email=agent%40example.com&limit=1`, { headers });
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json() as any;
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.next);
    assert.equal(firstPage.items[0].email, 'agent@example.com');
    assert.equal(firstPage.items[0].state, 'active');

    const nextPageResponse = await fetch(`${url}?scope=agent&email=agent%40example.com&limit=1&after=${firstPage.next}`, { headers });
    assert.equal(nextPageResponse.status, 200);
    const nextPage = await nextPageResponse.json() as any;
    assert.equal(nextPage.items.length, 1);
    assert.notEqual(nextPage.items[0].credentialId, firstPage.items[0].credentialId);
    assert.equal(nextPage.items[0].state, 'active');

    const projectResponse = await fetch(`${url}?projectId=${project._id}&scope=human&email=person%40example.com`, { headers });
    assert.equal(projectResponse.status, 200);
    const projectPage = await projectResponse.json() as any;
    assert.equal(projectPage.items.length, 1);
    assert.equal(projectPage.items[0].credentialId, member.credentialId);
    assert.equal(projectPage.items[0].email, 'person@example.com');
    assert.equal(projectPage.items[0].projectId, project._id);
    const memberActor = await authenticate(member.token, 'human');
    await assert.rejects(service.listCredentials(memberActor, { projectId: project._id, scope: 'human', limit: 25 }), /Project access denied/);

    const serialized = JSON.stringify([firstPage, nextPage, projectPage]);
    for (const secret of [adminToken, member.token, agentToken, secondAgentToken]) assert.equal(serialized.includes(secret), false);
    for (const hash of [adminToken, member.token, agentToken, secondAgentToken].map(value => createHash('sha256').update(value).digest('hex'))) assert.equal(serialized.includes(hash), false);
    assert.equal(Object.values(firstPage.items[0]).includes(undefined), false);

    await service.admin(admin, { action: 'revoke', operationId: operationId(), credentialId: agent.credentialId });
    const revokedResponse = await fetch(`${url}?scope=agent&email=agent%40example.com&status=revoked`, { headers });
    const revokedPage = await revokedResponse.json() as any;
    assert.equal(revokedResponse.status, 200);
    assert.ok(revokedPage.items.some((item: any) => item.credentialId === agent.credentialId && item.state === 'revoked'));
    assert.notEqual(secondAgent.credentialId, agent.credentialId);

    const agentRequest = await fetch(url, { headers: { authorization: `Bearer ${agentToken}` } });
    assert.equal(agentRequest.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('project human credentials require project administrator authorization', async () => {
  const projectA = await createProject('Project A');
  const projectB = await createProject('Project B');
  await issueMember(projectA._id, 'collaborator@example.com');
  await issueMember(projectB._id, 'other@example.com');
  const manager = await issueMember(projectA._id, 'manager@example.com');
  const managerActor = await authenticate(manager.token, 'human');
  const current = await Project.findById(projectA._id).lean();
  assert.ok(current);
  await service.admin(admin, { action: 'member', operationId: operationId(), projectId: projectA._id, version: current.version, userId: 'manager@example.com', role: 'administrador' });

  const visible = await service.listCredentials(managerActor, { projectId: projectA._id, scope: 'human', limit: 25 });
  assert.deepEqual(visible.items.map(item => item.email).sort(), ['collaborator@example.com', 'manager@example.com']);
  await assert.rejects(service.listCredentials(managerActor, { projectId: projectB._id, scope: 'human', limit: 25 }), /Project access denied/);
  await assert.rejects(service.listCredentials(managerActor, { scope: 'agent', limit: 25 }), /System administrator or project administrator required/);
});
