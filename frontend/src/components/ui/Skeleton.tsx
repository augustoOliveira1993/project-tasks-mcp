const line = 'block rounded-ui-sm bg-[linear-gradient(90deg,#eceff5_25%,#f6f7fb_37%,#eceff5_63%)] bg-[length:400%_100%] animate-shimmer';
const panel = 'grid gap-2.5 px-6 py-4';

export function Skeleton({ rows = 3, label = 'Carregando…' }: { rows?: number; label?: string }) {
  return <div className={panel} role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span className={`${line} h-3`} style={{ width: `${92 - (index % 3) * 14}%` }} key={index} aria-hidden="true" />)}
  </div>;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className={panel} role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">Carregando tarefas…</span>
    {Array.from({ length: rows }, (_, index) => <div className="flex items-center gap-4 border-b border-[#f0f2f6] py-2.5" key={index} aria-hidden="true"><span className={`${line} h-3`} style={{ width: '14px' }} /><span className={`${line} h-3.5 flex-auto`} style={{ width: `${55 - (index % 3) * 8}%` }} /><span className={`${line} h-3`} style={{ width: '12%' }} /><span className={`${line} h-3`} style={{ width: '10%' }} /></div>)}
  </div>;
}
