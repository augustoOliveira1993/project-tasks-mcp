import { useQuery } from '@tanstack/react-query';
import { listAdminCredentials } from '../../api';
import type { AdminCredential, ResponsibleProfile } from '../../api';

export type Responsible = {
  email: string;
  /** Pessoa e/ou agente: o mesmo e-mail pode ter os dois tipos de credencial. */
  kinds: Array<'pessoa' | 'agente'>;
  /** Projetos alcançados pelos tokens de pessoa. Agentes têm acesso global. */
  projects: string[];
  tokens: number;
  systemAdmin: boolean;
  since?: string;
  avatarUrl?: string;
};

/** Agrupa credenciais ativas por e-mail. */
export function groupResponsibles(items: AdminCredential[], profiles: ResponsibleProfile[] = []): Responsible[] {
  const byEmail = new Map<string, Responsible>();
  const avatarByEmail = new Map(profiles.map(profile => [profile.userId.toLowerCase(), `data:${profile.contentType};base64,${profile.data}`]));
  for (const credential of items) {
    if (credential.state !== 'active') continue;
    const key = credential.email.toLowerCase();
    const current = byEmail.get(key) ?? { email: credential.email, kinds: [], projects: [], tokens: 0, systemAdmin: false, avatarUrl: avatarByEmail.get(key) };
    const kind = credential.scope === 'agent' ? 'agente' : 'pessoa';
    if (!current.kinds.includes(kind)) current.kinds.push(kind);
    current.tokens += 1;
    current.systemAdmin ||= credential.systemAdmin;
    if (credential.createdAt && (!current.since || credential.createdAt < current.since)) current.since = credential.createdAt;
    const names = [...(credential.projects ?? []).map(project => project.projectName ?? 'Projeto'), ...(credential.projectName && !credential.projects?.length ? [credential.projectName] : [])];
    for (const name of names) if (!current.projects.includes(name)) current.projects.push(name);
    byEmail.set(key, current);
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'));
}

async function collect(token: string, filters: { projectId?: string; scope?: 'human' | 'agent' }) {
  const items: AdminCredential[] = [];
  const profiles = new Map<string, ResponsibleProfile>();
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await listAdminCredentials(token, { ...filters, status: 'active', limit: 100, ...(after ? { after } : {}) });
    items.push(...result.items);
    for (const profile of result.profiles ?? []) profiles.set(profile.userId.toLowerCase(), profile);
    after = result.next ?? undefined;
    if (!after) break;
  }
  return { items, profiles: [...profiles.values()] };
}

/**
 * Administradores do sistema veem todos os responsáveis (todos os projetos, pessoas e agentes).
 * Os demais veem as pessoas do projeto ativo, pois a consulta de agentes é global.
 */
export function useResponsibles(token: string, nonce: string, projectId: string, systemAdmin: boolean) {
  return useQuery({
    queryKey: ['responsibles', nonce, systemAdmin ? 'all' : projectId, systemAdmin],
    enabled: Boolean(token && nonce && (systemAdmin || projectId)),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const result = await collect(token, systemAdmin ? {} : { projectId, scope: 'human' });
      return groupResponsibles(result.items, result.profiles);
    }
  });
}
