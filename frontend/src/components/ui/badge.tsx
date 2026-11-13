import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-1 text-[10px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'border-border bg-transparent text-foreground',
        success: 'border-transparent bg-tone-green-bg text-tone-green',
        info: 'border-transparent bg-tone-blue-bg text-tone-blue',
        warning: 'border-transparent bg-tone-amber-bg text-tone-amber',
        danger: 'border-transparent bg-tone-red-bg text-tone-red',
        muted: 'border-transparent bg-tone-slate-bg text-tone-slate'
      }
    },
    defaultVariants: { variant: 'default' }
  }
);

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants> & {
  /** Compatibilidade semântica para tags usadas nos módulos de domínio. */
  tone?: string;
  size?: 'sm' | 'lg';
  wrap?: boolean;
};

function Badge({ className, variant, tone, size = 'sm', wrap = false, ...props }: BadgeProps) {
  const toneVariants: Record<string, NonNullable<VariantProps<typeof badgeVariants>['variant']>> = {
    muted: 'muted', blue: 'info', green: 'success', amber: 'warning', red: 'danger'
  };
  const resolvedVariant = tone ? toneVariants[tone] ?? 'muted' : variant;
  return <span data-slot="badge" className={cn(
    badgeVariants({ variant: resolvedVariant }),
    'rounded-full',
    size === 'lg' ? 'min-h-6' : 'min-h-5',
    wrap ? 'max-w-full min-w-0 leading-[1.35] whitespace-normal wrap-anywhere' : 'whitespace-nowrap',
    className
  )} {...props} />;
}

export { Badge, badgeVariants };
export type { BadgeProps };
