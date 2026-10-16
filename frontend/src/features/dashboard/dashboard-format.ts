export type DashboardPeriod = '30d' | '90d' | 'year' | 'all';

export function periodStart(period: DashboardPeriod) {
  if (period === 'all') return undefined;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (period === '30d') date.setDate(date.getDate() - 29);
  if (period === '90d') date.setDate(date.getDate() - 89);
  if (period === 'year') date.setMonth(0, 1);
  return date.toISOString();
}

export function formatDuration(value?: number | null) {
  if (value == null) return '—';
  const days = value / 86_400_000;
  if (days < 1) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 3_600_000)} h`;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(days)} ${days < 2 ? 'dia' : 'dias'}`;
}

export function displayResponsible(value?: string | null) {
  if (!value) return 'Sem responsável';
  return value.split('@')[0].split(/[._+\-\s]+/).filter(Boolean)
    .map(part => part[0].toLocaleUpperCase('pt-BR') + part.slice(1)).join(' ');
}

export function formatPercent(value?: number | null) {
  if (value == null) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}
