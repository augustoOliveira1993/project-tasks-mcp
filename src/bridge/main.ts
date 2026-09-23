import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { id, tools } from '../schema.js';

const exec = promisify(execFile);
const serviceUrl = process.env.PTM_SERVICE_URL;
const token = process.env.PTM_BRIDGE_TOKEN ?? process.env.PTM_TOKEN;
if (!serviceUrl || !token) throw new Error('PTM_SERVICE_URL and PTM_BRIDGE_TOKEN (or PTM_TOKEN) are required');

type Context = { root: string; remoteUrl: string; rootCommit: string; branch: string; commit: string };
async function git(root: string, ...args: string[]) { return (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim(); }
function canonical(url: string) { return url.trim().replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase(); }
async function context(): Promise<Context> {
  const root = await git(process.cwd(), 'rev-parse', '--show-toplevel');
  const [remote, rootCommit, branch, commit] = await Promise.all([
    git(root, 'remote', 'get-url', 'origin'), git(root, 'rev-list', '--max-parents=0', 'HEAD').then(value => value.split(/\r?\n/)[0]), git(root, 'branch', '--show-current'), git(root, 'rev-parse', 'HEAD')
  ]);
  return { root, remoteUrl: canonical(remote), rootCommit, branch: branch || 'HEAD', commit };
}
const client = new Client({ name: 'project-tasks-bridge', version: '0.2.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(new URL('/mcp', serviceUrl).toString()), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
async function call(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(String((response.content as any[])?.[0]?.text ?? 'Project Tasks error'));
  return JSON.parse(String((response.content as any[])?.[0]?.text ?? '{}'));
}
async function resolve() {
  const repo = await context(); const projects = await call('list_records', { kind: 'project', limit: 100 });
  const matches = projects.items.flatMap((project: any) => project.repositories.filter((repository: any) => repository.git?.canonicalRemoteUrl === repo.remoteUrl && repository.git?.rootCommit === repo.rootCommit).map((repository: any) => ({ project, repository })));
  return { repo, matches };
}
async function status() {
  try {
    const { repo, matches } = await resolve();
    const selection = matches.length === 1 ? matches[0] : undefined;
    const novidades = selection ? await call('get_project_novelties', { projectId: selection.project._id, limit: 25 }) : undefined;
    return { repository: repo, projects: matches.map(({ project, repository }: any) => ({ projectId: project._id, project: project.name, repositoryId: repository.id, area: undefined })), ready: !!selection, missing: selection ? [] : ['Bind this repository with a human administrator or select projectId explicitly.'], ...(novidades ? { novidades } : {}) };
  } catch (error) { return { ready: false, missing: [(error as Error).message] }; }
}
const server = new McpServer({ name: 'project-tasks-bridge', version: '0.2.0' }, { instructions: 'Use status first. This local bridge derives repository scope from Git; it never grants access.' });
server.registerTool('status', { description: 'Read the local Git context, matched Project Tasks projects, and unread collaboration events.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: JSON.stringify(await status()) }] }));
server.registerTool('publish_task_diff', { description: 'Publish a Git diff for a task in the uniquely matched project. Patch storage is opt-in.', inputSchema: z.object({ taskId: z.string().uuid(), baseCommit: z.string().regex(/^[0-9a-f]{40}$/i).optional(), commit: z.string().regex(/^[0-9a-f]{40}$/i).optional(), includePatch: z.boolean().default(false), agent: z.string().min(1).max(100).optional() }).strict() }, async input => {
  try {
    const { repo, matches } = await resolve(); if (matches.length !== 1) throw new Error('Git repository does not resolve to exactly one Project Tasks project');
    const { project, repository } = matches[0]; const commit = input.commit ?? repo.commit;
    const previous = await call('list_task_diffs', { projectId: project._id, taskId: input.taskId, limit: 1 });
    const baseCommit = input.baseCommit ?? previous.items?.[0]?.commit ?? await git(repo.root, 'merge-base', 'HEAD', 'origin/HEAD').catch(() => git(repo.root, 'rev-parse', 'HEAD~1'));
    await git(repo.root, 'merge-base', '--is-ancestor', baseCommit, commit);
    const files = (await git(repo.root, 'diff', '--name-only', `${baseCommit}..${commit}`)).split(/\r?\n/).filter(Boolean);
    const fullPatch = input.includePatch ? await git(repo.root, 'diff', '--no-ext-diff', `${baseCommit}..${commit}`) : undefined;
    const tooLarge = !!fullPatch && Buffer.byteLength(fullPatch, 'utf8') > 100 * 1024;
    const result = await call('record_task_diff', { operationId: randomUUID(), projectId: project._id, taskId: input.taskId, repositoryId: repository.id, baseCommit, commit, branch: repo.branch, files, ...(fullPatch && !tooLarge ? { patch: fullPatch } : {}), truncated: tooLarge, agent: input.agent });
    const novidades = await call('get_project_novelties', { projectId: project._id, limit: 25 });
    return { content: [{ type: 'text', text: JSON.stringify({ result, novidades }) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; }
});
for (const [name, schema] of Object.entries(tools)) {
  if (['get_session_context', 'record_task_diff', 'get_project_novelties', 'mark_project_read'].includes(name)) continue;
  const shape: Record<string, z.ZodType> = { ...(schema as any).shape };
  const needsProject = 'projectId' in shape;
  if (needsProject) shape.projectId = id.optional();
  server.registerTool(name, { description: `${name} through the local Git-aware bridge. Call status first; projectId is optional only when Git resolves one project.`, inputSchema: z.object(shape).strict(), annotations: { readOnlyHint: !('operationId' in (schema as any).shape) } }, async args => {
    try {
      const input: any = { ...args }; let projectId = input.projectId;
      if (needsProject && !projectId) {
        const { matches } = await resolve();
        if (matches.length !== 1) throw new Error('Git repository does not resolve to exactly one Project Tasks project');
        projectId = matches[0].project._id; input.projectId = projectId;
      }
      const result = await call(name, input);
      const novidades = projectId ? await call('get_project_novelties', { projectId, limit: 25 }) : undefined;
      if (projectId && novidades?.cursor) setTimeout(() => { void call('mark_project_read', { operationId: randomUUID(), projectId, cursor: novidades.cursor }).catch(() => undefined); }, 0);
      return { content: [{ type: 'text', text: JSON.stringify({ result, ...(novidades ? { novidades } : {}) }) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; }
  });
}
await server.connect(new StdioServerTransport());
