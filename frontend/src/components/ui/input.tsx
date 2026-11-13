import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input
    data-slot="input"
    type={type}
    className={cn('flex min-h-[39px] w-full min-w-0 rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-xs file:font-medium disabled:cursor-not-allowed disabled:bg-[#f7f8fc] aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 focus-visible:border-[#929ef2] focus-visible:ring-[3px] focus-visible:ring-[#596ce31a]', className)}
    {...props}
  />;
}

export { Input };
