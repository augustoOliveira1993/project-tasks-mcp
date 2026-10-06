import type { ReactNode } from 'react';
import { personName } from '../../lib/labels';
import { Avatar } from './Person';

export type AvatarPerson = { email: string; title?: string; lines?: ReactNode[] };

/** Cartão de detalhes que abre ao passar o mouse ou focar com o teclado (CSS puro, sem estado). */
function HoverCard({ person }: { person: AvatarPerson }) {
  return <span className="avatar-card" role="tooltip">
    <span className="avatar-card-head"><Avatar identity={person.email} size={34} /><span><strong>{personName(person.email)}</strong><small>{person.email}</small></span></span>
    {person.title && <span className="avatar-card-title">{person.title}</span>}
    {person.lines?.filter(Boolean).map((line, index) => <span className="avatar-card-line" key={index}>{line}</span>)}
  </span>;
}

export function AvatarStack({ people, max = 4, emptyLabel = 'Sem responsáveis', label }: { people: AvatarPerson[]; max?: number; emptyLabel?: string; label: string }) {
  if (!people.length) return <span className="muted-text avatar-empty">{emptyLabel}</span>;
  const shown = people.slice(0, max);
  const rest = people.slice(max);
  return <span className="avatar-stack" role="list" aria-label={label}>
    {shown.map(person => <span className="avatar-item" role="listitem" tabIndex={0} key={person.email} aria-label={`${personName(person.email)}, ${person.email}`}><Avatar identity={person.email} size={30} /><HoverCard person={person} /></span>)}
    {rest.length > 0 && <span className="avatar-item avatar-more" role="listitem" tabIndex={0} aria-label={`mais ${rest.length}: ${rest.map(person => person.email).join(', ')}`}>
      <span className="avatar-more-count" aria-hidden="true">+{rest.length}</span>
      <span className="avatar-card avatar-card-list" role="tooltip"><strong>Mais {rest.length}</strong>{rest.map(person => <span className="avatar-card-row" key={person.email}><Avatar identity={person.email} size={22} /><span>{personName(person.email)}<small>{person.email}</small></span></span>)}</span>
    </span>}
  </span>;
}
