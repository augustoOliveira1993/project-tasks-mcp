import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { MarkdownView } from '../ui/MarkdownView';
import { formatDate } from '../../lib/format';
import { personName } from '../../lib/labels';
import { jobStatusLabel } from '../../lib/conversation-ui';
import type { ConversationJob, Proposal } from './conversation-types';

/**
 * Proposta de execução dentro da conversa. Autorizar exige confirmação em linha;
 * depois da autorização o cartão mostra quem autorizou, quando, e o estado da execução.
 */
export function ProposalCard({ proposal, taskVersion, job, approving, error, onApprove, onRequestChanges }: {
  proposal: Proposal; taskVersion?: number; job?: ConversationJob; approving: boolean; error?: string;
  onApprove: (proposal: Proposal) => void; onRequestChanges: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const approved = proposal.status === 'approved';
  const pending = proposal.status === 'pending';
  const outdated = pending && (proposal.stale || (taskVersion !== undefined && taskVersion !== proposal.expectedTaskVersion));
  const canAuthorize = pending && !outdated;
  const steps = proposal.taskPatch.instructions?.trim();
  const criteria = proposal.taskPatch.acceptance ?? [];

  return <article className={'proposal-message' + (approved ? ' approved' : '')} aria-label={`Proposta de execução, versão ${proposal.version}`}>
    <header className="proposal-message-head">
      <div><p className="eyebrow">PROPOSTA DE EXECUÇÃO · VERSÃO {proposal.version}</p><h3>{proposal.title}</h3></div>
      <Badge tone={approved ? 'green' : outdated ? 'muted' : pending ? 'amber' : 'blue'}>{approved ? 'Execução autorizada' : outdated ? 'Desatualizada' : pending ? 'Aguardando autorização' : proposal.status}</Badge>
    </header>
    <MarkdownView content={proposal.summary} />
    {steps && <section className="proposal-block"><h4>Instruções propostas</h4><MarkdownView content={steps} /></section>}
    {criteria.length > 0 && <section className="proposal-block"><h4>Critérios propostos</h4><ol className="proposal-steps">{criteria.map((criterion, index) => <li key={index}><MarkdownView content={criterion} /></li>)}</ol></section>}
    {outdated && <p className="notice" role="note">Esta proposta foi feita sobre uma versão anterior da tarefa (esperada v{proposal.expectedTaskVersion}{taskVersion !== undefined ? `, atual v${taskVersion}` : ''}). Peça uma nova versão à IA antes de autorizar.</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {approved ? <footer className="proposal-message-foot authorized">
      <p>Autorizada por <strong>{proposal.approvedBy ? personName(proposal.approvedBy) : 'alguém do projeto'}</strong>{proposal.approvedAt ? ` · ${formatDate(proposal.approvedAt)}` : ''}</p>
      {job && <Badge tone={job.failed ? 'red' : job.status === 'completed' ? 'green' : 'blue'}>{jobStatusLabel(job)}</Badge>}
    </footer> : confirming && canAuthorize ? <footer className="proposal-message-foot confirm" role="group" aria-label="Confirmar autorização">
      <p><strong>Confirmar?</strong> A IA começa a executar esta proposta e envia o resultado para revisão.</p>
      <div className="button-row"><button type="button" className="button secondary" onClick={() => setConfirming(false)} disabled={approving}>Voltar</button><button type="button" className="button primary" disabled={approving} autoFocus onClick={() => onApprove(proposal)}>{approving ? 'Autorizando…' : 'Confirmar e executar'}</button></div>
    </footer> : pending && <footer className="proposal-message-foot">
      <button type="button" className="button secondary" onClick={onRequestChanges}>Pedir ajustes</button>
      <button type="button" className="button primary authorize-button" disabled={!canAuthorize} onClick={() => setConfirming(true)}>Autorizar execução</button>
    </footer>}
  </article>;
}
