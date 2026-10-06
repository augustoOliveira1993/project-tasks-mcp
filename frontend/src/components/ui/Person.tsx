import { personInitials, personName, personTone } from '../../lib/labels';

export function Avatar({ identity, size = 22 }: { identity?: string | null; size?: number }) {
  return <span className={`person-avatar person-avatar-tone-${personTone(identity)}`} style={{ width: size, height: size, fontSize: Math.round(size * .42) }} aria-hidden="true">{personInitials(identity)}</span>;
}

export function Person({ identity, emptyLabel = 'Não atribuído' }: { identity?: string | null; emptyLabel?: string }) {
  if (!identity?.trim()) return <span className="person person-empty">{emptyLabel}</span>;
  return <span className="person" title={identity}><Avatar identity={identity} /><span className="person-name">{personName(identity)}</span></span>;
}
