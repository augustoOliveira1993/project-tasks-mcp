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
  return projects.flatMap(project => (project.repositories ?? [])
    .filter((binding: any) => binding.git?.canonicalRemoteUrl === repository.remoteUrl && binding.git?.rootCommit === repository.rootCommit)
    .map((binding: any) => ({ project, repository: binding })));
}
