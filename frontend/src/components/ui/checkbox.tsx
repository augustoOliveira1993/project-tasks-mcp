import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return <input
    data-slot="checkbox"
    type="checkbox"
    className={cn('size-4 shrink-0 cursor-pointer rounded-sm accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50', className)}
    {...props}
  />;
}

export { Checkbox };
