export function Skeleton({ rows = 3, label = 'Carregando…' }: { rows?: number; label?: string }) {
  return <div className="skeleton-block" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span className="skeleton-line" style={{ width: `${92 - (index % 3) * 14}%` }} key={index} aria-hidden="true" />)}
  </div>;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="skeleton-table" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">Carregando tarefas…</span>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index} aria-hidden="true"><span className="skeleton-line" style={{ width: '14px' }} /><span className="skeleton-line" style={{ width: `${55 - (index % 3) * 8}%` }} /><span className="skeleton-line" style={{ width: '12%' }} /><span className="skeleton-line" style={{ width: '10%' }} /></div>)}
  </div>;
}
