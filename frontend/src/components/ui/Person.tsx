import { personInitials, personName, personTone } from '../../lib/labels';

const avatarTones = [
  'bg-[#e5edff] text-[#2b4f9e]',
  'bg-[#fff0db] text-[#85490a]',
  'bg-[#e2f4ea] text-[#1c6a42]',
  'bg-[#f1e8ff] text-[#62399a]',
  'bg-[#e0f2f4] text-[#165f66]'
];

export function Avatar({ identity, size = 22, className = '' }: { identity?: string | null; size?: number; className?: string }) {
  return <span className={`inline-grid flex-none place-items-center rounded-full font-bold tracking-[.02em] ${avatarTones[personTone(identity)]} ${className}`.trim()} style={{ width: size, height: size, fontSize: Math.round(size * .42) }} aria-hidden="true">{personInitials(identity)}</span>;
}

export function Person({ identity, avatarUrl, emptyLabel = 'Não atribuído' }: { identity?: string | null; avatarUrl?: string; emptyLabel?: string }) {
  if (!identity?.trim()) return <span className="inline-flex min-w-0 items-center gap-[7px] text-ui-sm italic text-muted-strong">{emptyLabel}</span>;
  return <span className="inline-flex min-w-0 items-center gap-[7px] text-ui-sm text-ink-2" title={identity}><span className="relative inline-grid size-[22px] shrink-0 place-items-center"><Avatar identity={identity} />{avatarUrl && <img key={avatarUrl} className="absolute inset-0 size-full rounded-full object-cover" src={avatarUrl} alt="" aria-hidden="true" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}</span><span className="truncate font-semibold">{personName(identity)}</span></span>;
}
