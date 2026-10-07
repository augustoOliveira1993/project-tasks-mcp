import type { ReactNode } from 'react';

const tones: Record<string, string> = {
  muted: 'bg-slate-100 text-slate-700',
  blue: 'bg-indigo-50 text-indigo-800',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-900',
  red: 'bg-rose-50 text-rose-800'
};

const sizes = { sm: 'min-h-5', lg: 'min-h-6' };

type BadgeProps = {
  children: ReactNode;
  tone?: string;
  title?: string;
  size?: keyof typeof sizes;
  /** Permite quebrar o texto em várias linhas em vez de manter uma só. */
  wrap?: boolean;
  className?: string;
};

export function Badge({ children, tone = 'muted', title, size = 'sm', wrap = false, className = '' }: BadgeProps) {
  const layout = wrap ? 'max-w-full min-w-0 leading-[1.35] whitespace-normal wrap-anywhere' : 'whitespace-nowrap';
  return <span title={title} className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${sizes[size]} ${layout} ${tones[tone] ?? tones.muted} ${className}`.trim()}>{children}</span>;
}
