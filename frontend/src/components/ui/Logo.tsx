import { useId } from 'react';

/** Marca do Project Tasks: lista de tarefas com a primeira concluída. Mesmo desenho de public/favicon.svg. */
export function Logo({ size = 34, title }: { size?: number; title?: string }) {
  const gradient = useId().replace(/:/g, '');
  return <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
    <defs>
      <linearGradient id={gradient} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#7a86f3" /><stop offset="1" stopColor="#4350c8" /></linearGradient>
    </defs>
    <rect width="64" height="64" rx="15" fill={`url(#${gradient})`} />
    <circle cx="19" cy="20" r="7.5" fill="#fff" />
    <path d="m15.4 20.2 2.6 2.6 4.8-5.4" fill="none" stroke="#4a58d0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="31" y="16.5" width="22" height="7" rx="3.5" fill="#fff" />
    <circle cx="19" cy="34" r="6.2" fill="none" stroke="#fff" strokeWidth="2.6" opacity=".85" />
    <rect x="31" y="30.5" width="17" height="7" rx="3.5" fill="#fff" opacity=".85" />
    <circle cx="19" cy="48" r="6.2" fill="none" stroke="#fff" strokeWidth="2.6" opacity=".55" />
    <rect x="31" y="44.5" width="12" height="7" rx="3.5" fill="#fff" opacity=".55" />
  </svg>;
}
