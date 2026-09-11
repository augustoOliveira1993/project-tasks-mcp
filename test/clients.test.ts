import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect } from '../src/db.js';
import { authenticate, bootstrap, Service } from '../src/service.js';
import { createApp } from '../src/http.js';

const exec = promisify(execFile);
test('real Codex and Claude Code clients connect over HTTP', { timeout: 120000 }, async () => {
  assert.ok(process.env.CODEX_BIN && process.env.CLAUDE_BIN, 'Set CODEX_BIN and CLAUDE_BIN');
  const dir = await mkdtemp(join(tmpdir(), 'project-tasks-clients-'));
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connect(repl.getUri('clients'));
  const service = new Service();
  const humanToken = await bootstrap('client-test');
  const human = await authenticate(humanToken, 'human');
  const token = randomBytes(32).toString('hex');
  await service.admin(human, { action: 'issue', operationId: randomUUID(), userId: 'client-test', scope: 'agent', token });
  let handshakes = 0; let toolLists = 0;
  const app = createApp(service, []);
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { const message = JSON.parse(body); if (message.method === 'initialize') handshakes++; if (message.method === 'tools/list') toolLists++; } catch {}
    });
    app(req, res);
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  const env = { ...process.env, PTM_TEST_TOKEN: token, CLAUDE_CONFIG_DIR: join(dir, 'claude') };
  const codex = spawn(process.env.CODEX_BIN!, ['app-server', '-c', `mcp_servers={project_tasks_test={url="${url}",bearer_token_env_var="PTM_TEST_TOKEN",startup_timeout_sec=15}}`], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = ''; codex.stderr.on('data', data => { stderr += data; });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: codex.stdout });
  lines.on('line', line => { try { const message = JSON.parse(line); const waiting = pending.get(message.id); if (waiting) { pending.delete(message.id); if (message.error) waiting.reject(new Error(JSON.stringify(message.error))); else waiting.resolve(message.result); } } catch {} });
  let seq = 0;
  const request = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    const id = ++seq; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Codex timeout: ${method}; ${stderr.slice(-1000)}`)); }, 25000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    codex.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await request('initialize', { clientInfo: { name: 'project_tasks_connection_test', title: 'MCP connection test', version: '1' }, capabilities: null });
    codex.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const status = await request('mcpServerStatus/list', { detail: 'full' });
    const entry = status.data.find((item: any) => item.name === 'project_tasks_test');
    assert.ok(entry && Object.values(entry.tools).some((tool: any) => tool.name === 'claim_task'), JSON.stringify({ entry, handshakes, stderr: stderr.slice(-3000).replaceAll(token, '[redacted]') }));
    assert.ok(handshakes >= 1 && toolLists >= 1, 'Codex must perform actual initialize and tools/list');
    console.log('Codex: HTTP initialize and tools/list succeeded');
    const previous = handshakes;
    await exec(process.env.CLAUDE_BIN!, ['mcp', 'add-json', '--scope', 'user', 'project_tasks_test', JSON.stringify({ type: 'http', url, headers: { Authorization: 'Bearer ${PTM_TEST_TOKEN}' } })], { env, cwd: dir, windowsHide: true, timeout: 30000 });
    const checked = await exec(process.env.CLAUDE_BIN!, ['mcp', 'get', 'project_tasks_test'], { env, cwd: dir, windowsHide: true, timeout: 30000 });
    assert.ok(/connected/i.test(checked.stdout), checked.stdout);
    assert.ok(handshakes > previous, 'Claude must perform actual initialize');
    console.log('Claude Code: HTTP MCP health check succeeded');
    const actor = await authenticate(token, 'agent');
    const repo = randomUUID();
    const project = await service.call(actor, 'create_project', { operationId: randomUUID(), data: { name: 'CLI flow', description: 'Review via CLI', instructions: 'Focused test', repositories: [{ id: repo, name: 'repo', url: 'https://example.com/repo.git', instructions: 'Local checkout' }] } });
    const feature = await service.call(actor, 'create_feature', { operationId: randomUUID(), projectId: project._id, data: { name: 'Feature', objective: 'Test CLI', context: 'Acceptance', acceptance: ['Approved'] } });
    let task = await service.call(actor, 'create_task', { operationId: randomUUID(), projectId: project._id, data: { name: 'Back', instructions: 'Implement', acceptance: ['Works'], priority: 1, area: 'backend', repositoryId: repo, featureId: feature._id, dependencies: [] } });
    task = await service.call(actor, 'claim_task', { operationId: randomUUID(), projectId: project._id, taskId: task._id, version: task.version, agent: 'test' });
    task = await service.call(actor, 'submit_task', { operationId: randomUUID(), projectId: project._id, taskId: task._id, executionId: task.executionId, version: task.version, result: { summary: 'Ready', changedFiles: [], checksRun: ['flow'], checksOmitted: [], evidence: ['passed'] } });
    const cliEnv = { ...env, ADMIN_TOKEN: humanToken, SERVICE_URL: url };
    const context = await exec(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), 'context', project._id, task._id], { env: cliEnv, windowsHide: true });
    assert.equal(JSON.parse(context.stdout).executions[0].result.summary, 'Ready');
    const operationFile = join(dir, 'review.json');
    await writeFile(operationFile, JSON.stringify({ action: 'review', operationId: randomUUID(), projectId: project._id, taskId: task._id, version: task.version, decision: 'approve', reason: 'Human CLI test' }));
    const approved = await exec(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), 'apply', operationFile], { env: cliEnv, windowsHide: true });
    assert.equal(JSON.parse(approved.stdout).status, 'concluida');
    console.log('Human CLI: context evidence and approval succeeded over HTTP');
  } finally {
    codex.kill(); lines.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await mongoose.disconnect(); await repl.stop();
  }
});
