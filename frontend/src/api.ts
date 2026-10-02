export type ApiPage<T> = { items: T[]; next?: string | null };
export type AdminCapabilities = { scope: string; systemAdmin: boolean; canHardDelete: boolean };
export type Project = {
  _id: string;
  version: number;
  name: string;
  description?: string;
  instructions?: string;
  visibility?: string;
  repositories?: Array<{ id: string; name: string; url: string; instructions?: string; git?: { canonicalRemoteUrl: string; rootCommit: string } }>;
  areas?: string[];
  createdAt?: string;
  updatedAt?: string;
};
export type ProjectSummary = { project: Project; taskSummary: Record<string, unknown> };
export type AdminCredential = {
  credentialId: string;
  email: string;
  scope: 'human' | 'agent';
  systemAdmin: boolean;
  state: 'active' | 'revoked';
  createdAt: string | null;
  projectId?: string;
  projectName?: string | null;
  role?: string | null;
};
export type AdminCredentialPage = { items: AdminCredential[]; next?: string | null };
export type Task = {
  _id: string;
  version: number;
  name: string;
  description?: string;
  instructions?: string;
  status: string;
  area?: string;
  repositoryId?: string;
  dependencies?: string[];
  type?: string;
  priority?: number;
  responsible?: string;
  featureId?: string | null;
  acceptance?: string[];
  acceptanceProgress?: boolean[];
  acceptanceEvidence?: Array<string | null>;
  checked?: boolean;
  checkedAt?: string;
  checkedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  leaseUntil?: string;
};

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const apiPrefix = import.meta.env.DEV ? '/api' : '';

export async function request<T>(token: string, path: string, options: { method?: string; body?: unknown; gzip?: boolean } = {}): Promise<T> {
  let body: BodyInit | undefined = options.body === undefined ? undefined : JSON.stringify(options.body);
  let contentEncoding: Record<string, string> = {};
  if (body && options.gzip && typeof CompressionStream !== 'undefined') {
    const compressed = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
    body = await new Response(compressed).blob();
    contentEncoding = { 'content-encoding': 'gzip' };
  }
  const response = await fetch(apiPrefix + path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      authorization: 'Bearer ' + token,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json', ...contentEncoding })
    },
    ...(body === undefined ? {} : { body })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.reason === 'string' ? data.reason : typeof data?.error === 'string' ? data.error : 'Falha na solicitação (' + response.status + ').';
    throw new ApiRequestError(message, response.status);
  }
  return data as T;
}

export function query<T>(token: string, tool: string, args: Record<string, unknown>): Promise<T> {
  return request<T>(token, '/admin/query', { body: { tool, arguments: args } });
}

export async function allRecords<T>(token: string, args: Record<string, unknown>): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  do {
    const page = await query<ApiPage<T>>(token, 'list_records', { ...args, limit: 100, ...(after ? { after } : {}) });
    items.push(...page.items);
    after = page.next ?? undefined;
  } while (after);
  return items;
}

export async function listProjects(token: string): Promise<ProjectSummary[]> {
  const items: ProjectSummary[] = [];
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (after) params.set('after', after);
    const page = await request<ApiPage<ProjectSummary>>(token, '/admin/projects/summary?' + params.toString());
    items.push(...page.items);
    after = page.next ?? undefined;
  } while (after);
  return items;
}

export async function listAdminCredentials(token: string, filters: {
  projectId?: string;
  scope?: 'human' | 'agent';
  status?: 'active' | 'revoked';
  email?: string;
  after?: string;
  limit?: number;
}): Promise<AdminCredentialPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return request<AdminCredentialPage>(token, '/admin/credentials?' + params.toString());
}

export function operationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  // randomUUID is restricted to secure contexts; getRandomValues also works over HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
