import type { ReactNode } from 'react';

const tones: Record<string, string> = {
  muted: 'bg-slate-100 text-slate-700',
  blue: 'bg-indigo-50 text-indigo-800',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-900',
  red: 'bg-rose-50 text-rose-800'
};

export function Badge({ children, tone = 'muted', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span title={title} className={'badge inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ' + (tones[tone] ?? tones.muted)}>{children}</span>;
}
