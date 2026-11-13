import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" className={cn('text-[10px] font-semibold leading-none text-[#566275] peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)} {...props} />;
}

export { Label };
