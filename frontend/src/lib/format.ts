export function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

/** Orientação curta sobre o que fazer após uma falha, quando a causa é reconhecível. */
export function errorHint(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : undefined;
  if (status === 401) return 'Sua sessão pode ter expirado. Saia e entre novamente com o token.';
  if (status === 403) return 'Esta credencial não tem permissão para a operação. Peça acesso a um administrador do projeto.';
  if (status === 404) return 'O registro não existe mais ou foi movido. Atualize a lista.';
  if (status === 409) return 'Outra pessoa alterou o registro. Atualize os dados e tente novamente.';
  if (status !== undefined && status >= 500) return 'O servidor falhou ao processar o pedido. Tente novamente em instantes.';
  if (error instanceof TypeError) return 'Não foi possível conectar ao servidor. Verifique a rede e tente novamente.';
  return '';
}
