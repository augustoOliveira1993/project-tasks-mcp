export const statusLabels: Record<string, string> = {
  pendente: 'Pendente',
  em_execucao: 'Em execução',
  bloqueada: 'Bloqueada',
  em_revisao: 'Em revisão',
  concluida: 'Concluída',
  cancelada: 'Cancelada'
};

export const statusTone: Record<string, string> = {
  pendente: 'muted',
  em_execucao: 'blue',
  bloqueada: 'red',
  em_revisao: 'amber',
  concluida: 'green',
  cancelada: 'muted'
};
