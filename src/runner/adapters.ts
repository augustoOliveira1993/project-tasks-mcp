import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';

async function withinCheckout(cwd: string, path: string) {
  const root = await realpath(cwd); let target = resolve(root, path);
  while (true) {
    try { target = await realpath(target); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(target) === target) return false; target = dirname(target); }
  }
  const delta = relative(root, target); return delta === '' || !delta.startsWith('..') && !isAbsolute(delta);
}

export type Usage = { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
export type AdapterOptions = {
  cwd: string; sessionId?: string; readOnly: boolean; model?: string; binary?: string;
  mcp: { url: string; token: string };
  onSession: (id: string) => Promise<void>;
  permission: (request: { id: string; title: string; detail: string }) => Promise<boolean>;
};
export interface AgentAdapter {
  start(options: AdapterOptions): Promise<void>;
  send(prompt: string): Promise<{ text: string; usage: Usage }>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export class CodexAdapter implements AgentAdapter {
  private process?: ChildProcessWithoutNullStreams;
  private options!: AdapterOptions;
  private threadId?: string;
  private turnId?: string;
  private requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private turn?: { resolve: (value: any) => void; reject: (error: Error) => void };
  private output = '';
  private usage: Usage = { inputTokens: null, outputTokens: null, costUsd: null };
  private totals?: { inputTokens: number; outputTokens: number };
  private baseline?: { inputTokens: number; outputTokens: number };
  private sendMessage(value: unknown) { this.process!.stdin.write(JSON.stringify(value) + '\n'); }
  private request(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 30000);
      this.requests.set(id, { resolve, reject, timer }); this.sendMessage({ id, method, params });
    });
  }
  private fail(error: Error) { for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); } this.requests.clear(); this.turn?.reject(error); this.turn = undefined; }
  async start(options: AdapterOptions) {
    this.options = options;
    // Dedicated config overrides global MCPs. The only MCP credential is job-scoped.
    const config = `mcp_servers={project_tasks_runner={url=${JSON.stringify(options.mcp.url)},bearer_token_env_var="PTM_JOB_BRIDGE_TOKEN",default_tools_approval_mode="auto"}}`;
    const env: NodeJS.ProcessEnv = { ...process.env, PTM_JOB_BRIDGE_TOKEN: options.mcp.token }; delete env.RUNNER_TOKEN; delete env.ADMIN_TOKEN;
    this.process = spawn(options.binary ?? 'codex', ['app-server', '-c', config], { cwd: options.cwd, env, windowsHide: true, stdio: 'pipe' });
    this.process.stderr.on('data', () => {});
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', () => this.fail(new Error('Codex process exited; reconcile session before retry')));
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', line => { let msg; try { msg = JSON.parse(line); } catch { return; } void this.receive(msg).catch(error => this.fail(error)); });
    await this.request('initialize', { clientInfo: { name: 'project_tasks_runner', version: '0.2.0' }, capabilities: null });
    this.sendMessage({ method: 'initialized' });
    const result = await this.request(options.sessionId ? 'thread/resume' : 'thread/start', { ...(options.sessionId ? { threadId: options.sessionId } : {}), cwd: options.cwd, approvalPolicy: 'on-request', sandbox: options.readOnly ? 'read-only' : 'workspace-write', ...(options.model ? { model: options.model } : {}) });
    this.threadId = result.thread.id;
    if (options.sessionId && this.threadId !== options.sessionId) throw new Error('Codex resumed a different session');
    await options.onSession(this.threadId!);
  }
  private async receive(msg: any) {
    if (msg.id !== undefined && !msg.method) {
      const request = this.requests.get(msg.id);
      if (request) { clearTimeout(request.timer); this.requests.delete(msg.id); if (msg.error) request.reject(new Error(msg.error.message)); else request.resolve(msg.result); }
      return;
    }
    if (msg.id !== undefined && msg.method) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(msg.method)) {
        const allowed = await this.options.permission({ id: String(msg.id), title: msg.method, detail: JSON.stringify({ reason: msg.params?.reason, command: msg.params?.command, cwd: msg.params?.cwd, grantRoot: msg.params?.grantRoot }).slice(0, 4000) });
        this.sendMessage({ id: msg.id, result: { decision: allowed ? 'accept' : 'decline' } });
      } else if (msg.method === 'item/permissions/requestApproval') {
        const allowed = await this.options.permission({ id: String(msg.id), title: msg.method, detail: JSON.stringify(msg.params.permissions).slice(0, 4000) });
        this.sendMessage({ id: msg.id, result: { permissions: allowed ? msg.params.permissions : {}, scope: 'turn' } });
      } else if (msg.method === 'item/tool/requestUserInput' || msg.method === 'tool/requestUserInput') {
        const questions = msg.params.questions ?? [];
        const allowed = await this.options.permission({ id: String(msg.id), title: msg.method, detail: JSON.stringify(questions).slice(0, 4000) });
        const answers: Record<string, { answers: string[] }> = {};
        for (const question of questions) {
          const option = question.options?.find((o: any) => allowed ? /^(Accept|Approve|Allow)(\b|$)/i.test(o.label) : /^(Decline|Deny|Cancel)(\b|$)/i.test(o.label));
          answers[question.id] = { answers: option ? [option.label] : [] };
        }
        this.sendMessage({ id: msg.id, result: { answers } });
      } else {
        await this.options.permission({ id: String(msg.id), title: `Unsupported: ${msg.method}`, detail: 'This provider request is not supported by this adapter version. Deny and review the local session.' });
        this.sendMessage({ id: msg.id, error: { code: -32601, message: 'Unsupported request: human intervention required' } });
      }
      return;
    }
    if (this.threadId && msg.params?.threadId && msg.params.threadId !== this.threadId) return;
    if (msg.method === 'turn/started') this.turnId = msg.params.turn.id;
    if (msg.method === 'item/agentMessage/delta') this.output = (this.output + msg.params.delta).slice(-20000);
    if (msg.method === 'thread/tokenUsage/updated') {
      const total = msg.params.tokenUsage?.total;
      if (typeof total?.inputTokens === 'number' && typeof total?.outputTokens === 'number') {
        this.totals = total;
        this.usage = { inputTokens: this.baseline ? Math.max(0, total.inputTokens - this.baseline.inputTokens) : null, outputTokens: this.baseline ? Math.max(0, total.outputTokens - this.baseline.outputTokens) : null, costUsd: null };
      }
    }
    if (msg.method === 'turn/completed') {
      const turn = this.turn; this.turn = undefined; this.turnId = undefined;
      if (msg.params.turn.status === 'completed') turn?.resolve({ text: this.output, usage: this.usage });
      else turn?.reject(new Error(`Codex turn ${msg.params.turn.status}`));
    }
  }
  async send(prompt: string) {
    if (this.turn) throw new Error('A Codex turn is already running');
    this.output = ''; this.usage = { inputTokens: null, outputTokens: null, costUsd: null };
    this.baseline = this.totals ?? (this.options.sessionId ? undefined : { inputTokens: 0, outputTokens: 0 });
    const result = new Promise<{ text: string; usage: Usage }>((resolve, reject) => { this.turn = { resolve, reject }; });
    void this.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: prompt }], sandboxPolicy: this.options.readOnly ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [this.options.cwd], networkAccess: false }, approvalPolicy: 'on-request' }).catch(error => this.fail(error));
    return result;
  }
  async interrupt() { if (this.turnId) await this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(() => undefined); }
  async close() {
    await this.interrupt(); this.fail(new Error('Codex adapter closed'));
    const child = this.process;
    if (!child?.pid) return;
    try {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          // Windows launchers can leave descendants holding the checkout and pipes.
          await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => { if (child.exitCode === null && child.signalCode === null) throw error; });
        } else await new Promise<void>(resolve => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill();
        });
      }
    } finally { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); this.process = undefined; }
  }
}

export class ClaudeAdapter implements AgentAdapter {
  private options!: AdapterOptions;
  private sessionId?: string;
  private query?: { interrupt(): Promise<unknown>; close(): void };
  async start(options: AdapterOptions) { this.options = options; this.sessionId = options.sessionId; }
  async send(prompt: string) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = this.options;
    const env = { ...process.env }; delete env.RUNNER_TOKEN; delete env.ADMIN_TOKEN;
    const stream = query({ prompt, options: {
      cwd: options.cwd, resume: this.sessionId, model: options.model, pathToClaudeCodeExecutable: options.binary,
      settingSources: [], permissionMode: 'default', maxTurns: 10, env,
      tools: options.readOnly ? ['Read', 'Glob', 'Grep'] : ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
      mcpServers: { project_tasks_runner: { type: 'http', url: options.mcp.url, headers: { Authorization: `Bearer ${options.mcp.token}` } } },
      canUseTool: async (name, input) => {
        if (name.startsWith('mcp__project_tasks_runner__')) return { behavior: 'allow' as const, updatedInput: input };
        const fileTool = ['Read', 'Glob', 'Grep', 'Write', 'Edit'].includes(name);
        if (fileTool) {
          const path = String(input.file_path ?? input.path ?? '.');
          const safe = await withinCheckout(options.cwd, path);
          if (!safe || options.readOnly && ['Write', 'Edit'].includes(name)) return { behavior: 'deny' as const, message: 'Tool outside authorized checkout or consultation is read-only' };
          return { behavior: 'allow' as const, updatedInput: input };
        }
        if (options.readOnly) return { behavior: 'deny' as const, message: 'Consultation is read-only' };
        const allowed = await options.permission({ id: randomUUID(), title: name, detail: JSON.stringify({ command: input.command, path: input.file_path ?? input.path }).slice(0, 4000) });
        return allowed ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: 'Human denied permission' };
      }
    } });
    this.query = stream;
    let text = ''; let usage: Usage = { inputTokens: null, outputTokens: null, costUsd: null }; let success = false;
    try {
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') {
          if (this.sessionId && this.sessionId !== message.session_id) throw new Error('Claude resumed a different session');
          this.sessionId = message.session_id; await options.onSession(this.sessionId);
        }
        if (message.type === 'result') {
          usage = { inputTokens: message.usage ? message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) : null, outputTokens: message.usage?.output_tokens ?? null, costUsd: message.total_cost_usd ?? null };
          success = message.subtype === 'success';
          if (success && 'result' in message) text = message.result.slice(-20000);
          if (!success) throw new Error(`Claude turn ${message.subtype}`);
        }
      }
      if (!success) throw new Error('Claude ended without a result; reconcile before retry');
      return { text, usage };
    } finally { stream.close(); this.query = undefined; }
  }
  async interrupt() { await this.query?.interrupt(); }
  async close() { this.query?.close(); this.query = undefined; }
}
