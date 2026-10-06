import { useQuery } from '@tanstack/react-query';
import { listAdminCredentials } from '../../api';

export type Assignee = { email: string; kind: 'pessoa' | 'agente' };

const MAX_PAGES = 5;

async function collect(token: string, filters: { projectId?: string; scope: 'human' | 'agent' }) {
  const emails: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listAdminCredentials(token, { ...filters, status: 'active', limit: 100, ...(after ? { after } : {}) });
    emails.push(...result.items.map(item => item.email));
    after = result.next ?? undefined;
    if (!after) break;
  }
  return emails;
}

/**
 * Pessoas: credenciais humanas ativas com acesso ao projeto. Agentes: credenciais de agente ativas
 * (a consulta é global e só administradores do sistema podem fazê-la; para os demais a lista fica só com pessoas).
 */
export async function fetchAssignees(token: string, projectId: string, systemAdmin: boolean): Promise<Assignee[]> {
  const [people, agents] = await Promise.all([
    collect(token, { projectId, scope: 'human' }),
    systemAdmin ? collect(token, { scope: 'agent' }).catch(() => [] as string[]) : Promise.resolve([] as string[])
  ]);
  const seen = new Set<string>();
  const result: Assignee[] = [];
  const add = (emails: string[], kind: Assignee['kind']) => {
    for (const email of [...new Set(emails.map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ email, kind });
    }
  };
  add(people, 'pessoa');
  add(agents, 'agente');
  return result;
}

export function useAssignees(token: string, nonce: string, projectId: string, systemAdmin: boolean) {
  return useQuery({
    queryKey: ['assignees', nonce, projectId, systemAdmin],
    enabled: Boolean(token && nonce && projectId),
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchAssignees(token, projectId, systemAdmin)
  });
}
