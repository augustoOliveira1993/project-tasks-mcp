export const taskTypeLabels: Record<string, string> = {
  feature: 'Feature', fix: 'Correção', refactor: 'Refatoração', chore: 'Manutenção', docs: 'Documentação',
  test: 'Teste', perf: 'Performance', build: 'Build', ci: 'CI'
};

export const areaLabels: Record<string, string> = { backend: 'Backend', frontend: 'Frontend', outro: 'Outro' };

export function areaLabel(area?: string | null) {
  if (!area) return 'Sem área';
  return areaLabels[area] ?? area;
}

export function typeLabel(type?: string | null) {
  if (!type) return 'Sem tipo';
  return taskTypeLabels[type] ?? type;
}

const priorityMeta: Record<number, { label: string; tone: string }> = {
  1: { label: 'Alta', tone: 'red' },
  2: { label: 'Média', tone: 'amber' },
  3: { label: 'Baixa', tone: 'muted' }
};

export function priorityInfo(priority?: number | null) {
  if (priority == null) return { text: 'Sem prioridade', short: '—', tone: 'muted' };
  const meta = priorityMeta[priority] ?? { label: '', tone: 'muted' };
  return { text: meta.label ? `P${priority} · ${meta.label}` : `P${priority}`, short: `P${priority}`, tone: meta.tone };
}

export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function shortId(id: string) {
  return id.slice(0, 8);
}

/** Primeiro nome legível a partir de um e-mail ou identificador. */
export function personName(identity?: string | null) {
  const value = (identity ?? '').trim();
  if (!value) return '';
  const localPart = value.includes('@') ? value.slice(0, value.indexOf('@')) : value;
  const first = localPart.split(/[._+-]/).find(Boolean) ?? localPart;
  return first ? first[0].toLocaleUpperCase('pt-BR') + first.slice(1) : value;
}

export function personInitials(identity?: string | null) {
  const value = (identity ?? '').trim();
  if (!value) return '?';
  const localPart = value.includes('@') ? value.slice(0, value.indexOf('@')) : value;
  const parts = localPart.split(/[\s._+-]+/).filter(Boolean);
  return (parts.slice(0, 2).map(part => part[0]).join('') || localPart.slice(0, 2)).toLocaleUpperCase('pt-BR');
}

export function personTone(identity?: string | null) {
  return Array.from(identity ?? '').reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
}

/** "agora", "há 5 min", "há 3 h", "há 2 d" ou data curta para períodos maiores. */
export function relativeTime(value?: string | null, now = Date.now()) {
  if (!value) return '—';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (diff < 45_000) return 'agora';
  if (diff < hour) return `há ${Math.max(1, Math.round(diff / minute))} min`;
  if (diff < day) return `há ${Math.round(diff / hour)} h`;
  if (diff < 7 * day) return `há ${Math.round(diff / day)} d`;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(timestamp));
}

/** Prévia em texto simples de um Markdown (sem crases, marcadores ou links). */
export function plainText(markdown?: string | null, maxLength = 120) {
  const text = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*#>~|]/g, '')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + '…' : text;
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  if (totalSeconds === 0) return 'menos de 1 s';
  const units = [
    [Math.floor(totalSeconds / 86400), 'd'],
    [Math.floor(totalSeconds % 86400 / 3600), 'h'],
    [Math.floor(totalSeconds % 3600 / 60), 'min'],
    [totalSeconds % 60, 's']
  ] as const;
  return units.filter(([value]) => value > 0).map(([value, label]) => `${value} ${label}`).slice(0, 2).join(' ');
}
