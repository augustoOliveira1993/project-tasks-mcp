import { Badge } from '../../../components/ui/badge';
import { statusLabels } from '../status';

const tones: Record<string, 'secondary' | 'info' | 'destructive' | 'warning' | 'success' | 'muted'> = {
  pendente: 'secondary',
  em_execucao: 'info',
  bloqueada: 'destructive',
  em_revisao: 'warning',
  concluida: 'success',
  cancelada: 'secondary'
};

export function TaskStatusBadge({ status }: { status: string }) {
  return <Badge variant={tones[status] ?? 'muted'}>{statusLabels[status] ?? status}</Badge>;
}
