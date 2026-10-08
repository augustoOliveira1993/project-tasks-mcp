/**
 * Normalize Git remote URLs to a protocol- and credential-independent identity.
 * HTTPS, SSH URL, and SCP-style URLs for the same host/path become comparable,
 * regardless of the repository's display label.
 */
export function normalizeGitRemote(value: string) {
  const remote = value.trim();
  if (!remote) return '';

  const windowsPath = remote.match(/^([a-z]):[\\/](.*)$/i);
  if (windowsPath) return `${windowsPath[1].toLowerCase()}:/${windowsPath[2].replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()}`;

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(remote);
  const scp = hasScheme ? null : remote.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
  const candidate = scp ? `ssh://${scp[1]}/${scp[2]}` : remote;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    const defaultPort = ({ 'http:': '80', 'https:': '443', 'ssh:': '22', 'git:': '9418' } as Record<string, string>)[parsed.protocol];
    const port = parsed.port && parsed.port !== defaultPort ? `:${parsed.port}` : '';
    const path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
    if (!host) return path;
    return `${host}${port}${path}`;
  } catch {
    return remote
      .replace(/^git@([^:]+):/i, '$1/')
      .replace(/^(?:https?|ssh|git):\/\//i, '')
      .replace(/^git@/i, '')
      .replace(/\.git\/?$/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}
