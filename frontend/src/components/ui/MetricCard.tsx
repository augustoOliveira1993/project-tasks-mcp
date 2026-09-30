export function MetricCard({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return <article className="metric grid min-h-28 gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}
