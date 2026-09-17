import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connect, Task, AutomationJob, TaskMessage, Execution } from '../src/db.js';
import { Service, bootstrap, authenticate, type Actor } from '../src/service.js';
import { createApp } from '../src/http.js';
import { LocalRunner, RunnerClient, limitedTaskContext, runnerConfig, runnerPrompt } from '../src/runner/runtime.js';
import { CodexAdapter, ClaudeAdapter, type AgentAdapter, type AdapterOptions } from '../src/runner/adapters.js';
import { createJobBridge } from '../src/runner/bridge.js';

const exec = promisify(execFile);
const op = randomUUID;
let repl: MongoMemoryReplSet; let service: Service; let agent: Actor; let human: Actor; let token: string; let temp: string;
before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'ptm-runner-test-'));
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await connect(repl.getUri('runner'));
  service = new Service(); human = await authenticate(await bootstrap('test'), 'human'); token = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: op(), userId: 'test', scope: 'agent', token }); agent = await authenticate(token, 'agent');
});
after(async () => {
  await service.events.close(); await mongoose.disconnect(); await repl.stop();
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !temp.includes('ptm-runner-test-')) throw new Error('Unexpected fixture cleanup path');
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
async function until(check: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out waiting for runner');
}
class SimulatedAdapter implements AgentAdapter {
  private options!: AdapterOptions;
  async start(options: AdapterOptions) { this.options = options; await options.onSession(op()); }
  async send(_prompt: string) {
    const client = new Client({ name: 'simulated-agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.options.mcp.url), { requestInit: { headers: { authorization: `Bearer ${this.options.mcp.token}` } } }));
    try {
      const response = await client.callTool({ name: 'submit_task', arguments: { result: { summary: 'Simulated task completed', changedFiles: [], checksRun: ['simulation'], checksOmitted: ['real model'], evidence: ['bridge exercised'] } } });
      assert.ok(!response.isError, JSON.stringify(response));
      return { text: 'Submitted', usage: { inputTokens: 10, outputTokens: 5, costUsd: null } };
    } finally { await client.close(); }
  }
  async interrupt() {} async close() {}
}

for (const real of [false, true]) test(`${real ? 'real providers' : 'simulation'}: runner drives Codex/Claude jobs through the bridge and human dependency approval`, { skip: real && !process.env.PTM_REAL_CLIENTS, timeout: real ? 240000 : 90000 }, async () => {
  const repo = join(temp, real ? 'real-repo' : 'repo');
  await exec('git', ['init', repo], { windowsHide: true });
  await writeFile(join(repo, 'fixture.txt'), 'test\n');
  await exec('git', ['-C', repo, 'add', 'fixture.txt'], { windowsHide: true });
  await exec('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'test: initialize fixture'], { windowsHide: true });
  const repositoryId = op();
  const project = await service.call(agent, 'create_project', { operationId: op(), data: { name: 'Runner integration', description: 'Test', instructions: 'Local fixture', repositories: [{ id: repositoryId, name: 'test', url: 'https://example.com/repo', instructions: 'Use fixture' }] } });
  const create = (name: string, dependencies: string[] = []) => service.call(agent, 'create_task', { operationId: op(), projectId: project._id, data: { name, instructions: 'Submit the fixture', acceptance: ['Submitted'], area: 'backend', repositoryId, priority: 1, dependencies } });
  const back = await create('back'); const front = await create('front', [back._id]);
  if (real) {
    Object.assign(back, await service.call(agent, 'edit_record', { operationId: op(), projectId: project._id, kind: 'task', id: back._id, version: back.version, data: { instructions: `Use the MCP read_repository_file tool to read fixture.txt (contains test); do not run shell commands. Send a contrato message with text fixture-v1 to relatedTaskId ${front._id} using send_task_message. Then submit_task with summary mentioning fixture-v1, changedFiles [], checksRun ["read fixture.txt"], checksOmitted [], evidence ["fixture-v1"]. Do not modify files or run tests. This is a tiny integration probe.` } }));
    Object.assign(front, await service.call(agent, 'edit_record', { operationId: op(), projectId: project._id, kind: 'task', id: front._id, version: front.version, data: { instructions: 'Read messages and the approved dependency context. Verify the fixture-v1 contract and use the MCP read_repository_file tool for fixture.txt (contains test); do not run shell commands. Submit using submit_task with summary mentioning fixture-v1, changedFiles [], checksRun ["read fixture and contract"], checksOmitted [], evidence ["fixture-v1"]. Do not modify files or run tests. This is a tiny integration probe.' } }));
  }
  await service.admin(human, { action: 'automation_policy', operationId: op(), projectId: project._id, version: 0, enabled: true, routes: [{ repositoryId, area: 'backend', provider: 'codex' }] });
  for (const [task, provider] of [[back, 'codex'], [front, 'claude']] as const) await service.admin(human, { action: 'automation_release', operationId: op(), projectId: project._id, taskId: task._id, version: task.version, provider });
  const app = createApp(service, []); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const selected: string[] = [];
  const runner = new LocalRunner(runnerConfig.parse({ serviceUrl: url, machineId: op(), projects: [project._id], providers: ['codex', 'claude'], repositories: { [repositoryId]: repo }, worktreeRoot: join(temp, 'worktrees'), codexBinary: process.env.CODEX_BIN, claudeBinary: process.env.CLAUDE_BIN }), new RunnerClient(url, token), name => { selected.push(name); return real ? name === 'codex' ? new CodexAdapter() : new ClaudeAdapter() : new SimulatedAdapter(); });
  const running = runner.run();
  try {
    await until(async () => (await Task.findById(back._id))?.status === 'em_revisao', real ? 120000 : 30000);
    assert.equal((await Task.findById(front._id))!.status, 'pendente');
    const done = await Task.findById(back._id);
    await service.admin(human, { action: 'review', operationId: op(), projectId: project._id, taskId: back._id, version: done!.version, decision: 'approve', reason: 'Verified fixture' });
    await until(async () => (await Task.findById(front._id))?.status === 'em_revisao', real ? 120000 : 30000);
    assert.deepEqual(selected, ['codex', 'claude']);
    const jobs = await AutomationJob.find({ projectId: project._id }).lean();
    assert.notEqual(jobs[0].cwd, jobs[1].cwd);
    await until(async () => (await AutomationJob.countDocuments({ projectId: project._id, turnInFlight: false, usage: { $ne: null } })) === 2);
    assert.equal(await readFile(join(repo, 'fixture.txt'), 'utf8'), 'test\n');
    if (real) {
      assert.equal(await TaskMessage.countDocuments({ projectId: project._id, relatedTaskId: front._id, type: 'contrato', message: /fixture-v1/ }), 1);
      const executions = await Execution.find({ projectId: project._id }).lean();
      assert.ok(executions.every(e => /fixture-v1/.test(e.result.summary)));
      console.log(JSON.stringify({ probe: 'real-cooperation', providers: selected, usage: (await AutomationJob.find({ projectId: project._id }).select('provider usage turns status').lean()) }));
    }
  } finally { await runner.stop(); await running; await app.locals.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('runner forbids plaintext bearer transport outside loopback', () => {
  assert.throws(() => new RunnerClient('http://internal-server:3443', token), /HTTPS/);
});

test('runner prompt limits the initial context to the authorized area and repository', () => {
  const state = {
    task: { _id: 'task-backend', area: 'backend', repositoryId: 'repo-backend', name: 'Backend task', type: 'feature', priority: 1, instructions: 'Only this task', acceptance: ['Done'] },
    repository: { id: 'repo-backend', name: 'backend-repo', url: 'file:///backend', instructions: 'Backend only' },
    project: { repositories: [{ name: 'frontend-repo' }] }, dependencies: [{ name: 'Frontend task', area: 'frontend' }], messages: [{ message: 'Frontend detail' }]
  };
  const context = limitedTaskContext(state);
  assert.deepEqual(context, {
    scope: { taskId: 'task-backend', area: 'backend', repositoryId: 'repo-backend' },
    task: { id: 'task-backend', name: 'Backend task', area: 'backend', type: 'feature', priority: 1, instructions: 'Only this task', acceptance: ['Done'] },
    repository: { id: 'repo-backend', name: 'backend-repo', url: 'file:///backend', instructions: 'Backend only' }
  });
  const prompt = runnerPrompt(state, { mode: 'execution' });
  assert.match(prompt, /Do not implement, edit, or expand work from another area/);
  assert.doesNotMatch(prompt, /frontend-repo|Frontend task|Frontend detail/);
});

test('read-only bridge rejects traversal, linked paths and write tools', async () => {
  const root = join(temp, 'read-root'); await mkdir(root); await writeFile(join(root, 'file.txt'), 'first\nsecond\n');
  const outside = join(temp, 'outside'); await mkdir(outside); await writeFile(join(outside, 'private.txt'), 'outside checkout');
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const bridge = await createJobBridge(async () => ({}), true, root);
  const client = new Client({ name: 'read-only-probe', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url), { requestInit: { headers: { authorization: `Bearer ${bridge.token}` } } }));
    assert.ok(!(await client.listTools()).tools.some(t => t.name === 'submit_task' || t.name === 'block_task'));
    const read = await client.callTool({ name: 'read_repository_file', arguments: { path: 'file.txt', line: 2, limit: 1 } });
    assert.equal((read.content as any)[0].text, 'second');
    for (const path of ['../outside/private.txt', 'linked/private.txt']) assert.equal((await client.callTool({ name: 'read_repository_file', arguments: { path } })).isError, true);
  } finally { await client.close(); await bridge.close(); }
});

test('installed Codex app-server accepts the adapter protocol without model generation', { skip: !process.env.CODEX_BIN, timeout: 40000 }, async () => {
  const bridge = await createJobBridge(async () => ({}), true); const adapter = new CodexAdapter(); let sessionId = '';
  try {
    await adapter.start({ binary: process.env.CODEX_BIN, cwd: temp, readOnly: true, mcp: bridge, onSession: async id => { sessionId = id; }, permission: async () => false });
    assert.ok(sessionId);
  } finally { await adapter.close(); await bridge.close(); }
});
