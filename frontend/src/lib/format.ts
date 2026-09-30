export function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}
