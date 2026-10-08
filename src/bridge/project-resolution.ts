import { normalizeGitRemote } from '../git-remote.js';

type ToolCall = (name: string, args: Record<string, unknown>) => Promise<any>;

export async function listAccessibleProjects(callTool: ToolCall) {
  const projects: any[] = [];
  let after: string | undefined;
  do {
    const page = await callTool('list_records', { kind: 'project', limit: 100, ...(after ? { after } : {}) });
    projects.push(...(page.items ?? []));
    after = page.next ?? undefined;
  } while (after);
  return projects;
}

export function matchGitProjects(projects: any[], repository: { remoteUrl: string; rootCommit: string }) {
  const remoteUrl = normalizeGitRemote(repository.remoteUrl);
  const rootCommit = repository.rootCommit.toLowerCase();
  return projects.flatMap(project => (project.repositories ?? [])
    .filter((binding: any) => normalizeGitRemote(binding.git?.canonicalRemoteUrl ?? '') === remoteUrl && binding.git?.rootCommit?.toLowerCase() === rootCommit)
    .map((binding: any) => ({ project, repository: binding })));
}
