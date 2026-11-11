import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const shimmer = 'block rounded-sm bg-[linear-gradient(90deg,#eceff5_25%,#f6f7fb_37%,#eceff5_63%)] bg-[length:400%_100%] animate-shimmer motion-reduce:animate-none';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

function SkeletonRows({ rows = 3, label = 'Carregando…' }: { rows?: number; label?: string }) {
  return <div className="grid gap-2.5 px-6 py-4" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <Skeleton className={`${shimmer} h-3`} style={{ width: `${92 - (index % 3) * 14}%` }} key={index} />)}
  </div>;
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="grid gap-2.5 px-6 py-4" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">Carregando tarefas…</span>
    {Array.from({ length: rows }, (_, index) => <div className="flex items-center gap-4 border-b border-border py-2.5" key={index} aria-hidden="true"><Skeleton className={`${shimmer} h-3 w-[14px]`} /><Skeleton className={`${shimmer} h-3.5 flex-auto`} style={{ width: `${55 - (index % 3) * 8}%` }} /><Skeleton className={`${shimmer} h-3 w-[12%]`} /><Skeleton className={`${shimmer} h-3 w-[10%]`} /></div>)}
  </div>;
}

export { Skeleton, SkeletonRows, TableSkeleton };
