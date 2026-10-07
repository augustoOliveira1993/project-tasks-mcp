import type { ReactNode } from 'react';
import { personName } from '../../lib/labels';
import { Avatar } from './Person';

export type AvatarPerson = { email: string; title?: string; lines?: ReactNode[] };

const lift = 'transition-transform duration-120 ease-[ease] group-hover/item:-translate-y-0.5 group-focus-visible/item:-translate-y-0.5';
const card = "absolute bottom-[calc(100%+10px)] left-1/2 z-20 hidden min-w-[230px] max-w-[300px] -translate-x-1/2 rounded-ui-md border border-line bg-white px-3.5 py-3 text-left text-ui-xs leading-[1.45] whitespace-normal text-ink-2 shadow-[0_12px_30px_#18223033] pointer-events-none group-hover/item:grid group-focus-visible/item:grid max-[760px]:left-0 max-[760px]:translate-x-0 after:absolute after:top-full after:left-1/2 after:-mt-[5px] after:size-2.5 after:-translate-x-1/2 after:rotate-45 after:border-r after:border-b after:border-line after:bg-white after:content-[''] max-[760px]:after:left-[18px]";
const item = 'group/item relative inline-flex -ml-2 first:ml-0 cursor-default rounded-full shadow-[0_0_0_2px_#fff] outline-offset-[3px] hover:z-[3] focus-visible:z-[3]';
const small = 'block overflow-hidden text-ellipsis text-ui-xs text-muted-strong';

/** Cartão de detalhes que abre ao passar o mouse ou focar com o teclado (CSS puro, sem estado). */
function HoverCard({ person }: { person: AvatarPerson }) {
  return <span className={`${card} gap-1.5`} role="tooltip">
    <span className="flex items-center gap-2.5"><Avatar identity={person.email} size={34} className={lift} /><span className="grid min-w-0"><strong className="text-ui-sm text-ink">{personName(person.email)}</strong><small className={small}>{person.email}</small></span></span>
    {person.title && <span className="w-fit rounded-full bg-tone-amber-bg px-2 py-px font-bold text-tone-amber">{person.title}</span>}
    {person.lines?.filter(Boolean).map((line, index) => <span className="text-ink-2" key={index}>{line}</span>)}
  </span>;
}

export function AvatarStack({ people, max = 4, emptyLabel = 'Sem responsáveis', label }: { people: AvatarPerson[]; max?: number; emptyLabel?: string; label: string }) {
  if (!people.length) return <span className="text-ui-xs text-muted-strong">{emptyLabel}</span>;
  const shown = people.slice(0, max);
  const rest = people.slice(max);
  return <span className="inline-flex items-center" role="list" aria-label={label}>
    {shown.map(person => <span className={item} role="listitem" tabIndex={0} key={person.email} aria-label={`${personName(person.email)}, ${person.email}`}><Avatar identity={person.email} size={30} className={lift} /><HoverCard person={person} /></span>)}
    {rest.length > 0 && <span className={item} role="listitem" tabIndex={0} aria-label={`mais ${rest.length}: ${rest.map(person => person.email).join(', ')}`}>
      <span className="inline-grid size-[30px] place-items-center rounded-full bg-[#e7eaf3] text-[11px] font-bold text-ink-2" aria-hidden="true">+{rest.length}</span>
      <span className={`${card} gap-2`} role="tooltip"><strong>Mais {rest.length}</strong>{rest.map(person => <span className="flex items-center gap-2" key={person.email}><Avatar identity={person.email} size={22} className={lift} /><span>{personName(person.email)}<small className={small}>{person.email}</small></span></span>)}</span>
    </span>}
  </span>;
}
