import { useQueries } from '@tanstack/react-query';
import { listAdminCredentials } from '../../api';
import type { AdminCredential } from '../../api';

export type ProjectMember = {
  email: string;
  /** Papéis do e-mail neste projeto (ex.: administrador, colaborador). */
  roles: string[];
  /** Quantidade de tokens ativos emitidos para o e-mail. */
  credentials: number;
  since?: string;
  systemAdmin: boolean;
  /** Demais projetos que o e-mail alcança. */
  otherProjects: string[];
};

/** Agrupa as credenciais ativas por e-mail: uma pessoa pode ter vários tokens. */
export function groupMembers(items: AdminCredential[], projectId: string): ProjectMember[] {
  const byEmail = new Map<string, ProjectMember>();
  for (const credential of items) {
    if (credential.state !== 'active') continue;
    const key = credential.email.toLowerCase();
    const current = byEmail.get(key) ?? { email: credential.email, roles: [], credentials: 0, systemAdmin: false, otherProjects: [] };
    current.credentials += 1;
    current.systemAdmin ||= credential.systemAdmin;
    if (credential.createdAt && (!current.since || credential.createdAt < current.since)) current.since = credential.createdAt;
    const own = credential.projects?.find(item => item.projectId === projectId);
    for (const role of [own?.role ?? (credential.projectId === projectId ? credential.role : null)]) if (role && !current.roles.includes(role)) current.roles.push(role);
    for (const project of credential.projects ?? []) {
      const name = project.projectName ?? 'Projeto';
      if (project.projectId !== projectId && !current.otherProjects.includes(name)) current.otherProjects.push(name);
    }
    byEmail.set(key, current);
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'));
}

/** Pessoas com acesso ativo a cada projeto, a partir das credenciais humanas. */
export function useProjectMembers(token: string, nonce: string, projectIds: string[]) {
  const results = useQueries({
    queries: projectIds.map(projectId => ({
      queryKey: ['project-members', nonce, projectId],
      enabled: Boolean(token && nonce && projectId),
      staleTime: 60_000,
      retry: false,
      queryFn: async () => groupMembers((await listAdminCredentials(token, { projectId, scope: 'human', status: 'active', limit: 100 })).items, projectId)
    }))
  });
  return new Map(projectIds.map((projectId, index) => [projectId, { members: results[index].data ?? [], isPending: results[index].isPending, isError: results[index].isError }]));
}
