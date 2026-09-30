import type { ReactNode } from 'react';

const tones: Record<string, string> = {
  muted: 'bg-slate-100 text-slate-600',
  blue: 'bg-indigo-50 text-indigo-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-rose-50 text-rose-700'
};

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge inline-flex items-center rounded-full px-2 py-1 text-[9px] font-semibold ' + (tones[tone] ?? tones.muted)}>{children}</span>;
}
