export function MetricCard({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return <article className="grid min-h-28 gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm max-[760px]:min-h-[91px] max-[760px]:gap-1.5 max-[760px]:p-[13px]"><span className="text-ui-xs font-semibold text-[#778395]">{label}</span><strong className="font-display text-[25px] leading-none font-bold tracking-[-.05em] text-[#273245] max-[760px]:text-[22px]">{value}</strong><small className="text-[10px] text-[#a1a9b6]">{hint}</small></article>;
}
