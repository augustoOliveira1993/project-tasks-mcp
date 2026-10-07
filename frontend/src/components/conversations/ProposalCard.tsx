import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { MarkdownView } from '../ui/MarkdownView';
import { formatDate } from '../../lib/format';
import { personName } from '../../lib/labels';
import { jobStatusLabel } from '../../lib/conversation-ui';
import { notice } from '../ui/classes';
import type { ConversationJob, Proposal } from './conversation-types';

const footButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-ui-sm font-bold transition';
const footSecondary = `${footButton} border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`;
const footPrimary = `${footButton} border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
const footBase = 'flex flex-wrap items-center gap-2.5';
const footText = 'text-[13px] text-ink-2';
const blockHeading = 'text-ui-sm text-ink-2';
const blockClass = 'grid gap-1 rounded-[10px] border border-[#efe6cc] bg-[rgba(255,255,255,.7)] px-3 py-2';

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

  return <article className={'grid gap-2.5 rounded-ui-lg border px-4 py-3.5 ' + (approved ? 'border-[#b9e3c8] bg-[#f7fcf9]' : 'border-[#f0c978] bg-[#fffdf6] shadow-[0_4px_14px_#b97d1418]')} data-proposal="" data-approved={approved ? '' : undefined} aria-label={`Proposta de execução, versão ${proposal.version}`}>
    <header className="flex items-start justify-between gap-2.5">
      <div><p className={'mb-1 font-display text-[9px] leading-[normal] font-bold tracking-[.11em] ' + (approved ? 'text-tone-green' : 'text-tone-amber')}>PROPOSTA DE EXECUÇÃO · VERSÃO {proposal.version}</p><h3 className="font-display text-[15px] leading-[1.35] font-bold text-ink">{proposal.title}</h3></div>
      <Badge tone={approved ? 'green' : outdated ? 'muted' : pending ? 'amber' : 'blue'}>{approved ? 'Execução autorizada' : outdated ? 'Desatualizada' : pending ? 'Aguardando autorização' : proposal.status}</Badge>
    </header>
    <MarkdownView content={proposal.summary} />
    {steps && <section className={blockClass}><h4 className={blockHeading}>Instruções propostas</h4><MarkdownView content={steps} /></section>}
    {criteria.length > 0 && <section className={blockClass}><h4 className={blockHeading}>Critérios propostos</h4><ol className="grid gap-1 pl-5 text-[13.5px]">{criteria.map((criterion, index) => <li key={index}><MarkdownView content={criterion} /></li>)}</ol></section>}
    {outdated && <p className={notice.info} role="note">Esta proposta foi feita sobre uma versão anterior da tarefa (esperada v{proposal.expectedTaskVersion}{taskVersion !== undefined ? `, atual v${taskVersion}` : ''}). Peça uma nova versão à IA antes de autorizar.</p>}
    {error && <p className="mt-1 text-ui-xs font-semibold text-tone-red" role="alert">{error}</p>}
    {approved ? <footer className={`${footBase} justify-between pt-1`}>
      <p className={`mr-auto ${footText}`}>Autorizada por <strong>{proposal.approvedBy ? personName(proposal.approvedBy) : 'alguém do projeto'}</strong>{proposal.approvedAt ? ` · ${formatDate(proposal.approvedAt)}` : ''}</p>
      {job && <Badge tone={job.failed ? 'red' : job.status === 'completed' ? 'green' : 'blue'}>{jobStatusLabel(job)}</Badge>}
    </footer> : confirming && canAuthorize ? <footer className={`${footBase} justify-end rounded-[10px] bg-[#fff4df] px-3 py-2.5`} role="group" aria-label="Confirmar autorização">
      <p className={`mr-auto ${footText}`}><strong>Confirmar?</strong> A IA começa a executar esta proposta e envia o resultado para revisão.</p>
      <div className="flex items-center gap-2"><button type="button" className={footSecondary} onClick={() => setConfirming(false)} disabled={approving}>Voltar</button><button type="button" className={footPrimary} disabled={approving} autoFocus onClick={() => onApprove(proposal)}>{approving ? 'Autorizando…' : 'Confirmar e executar'}</button></div>
    </footer> : pending && <footer className={`${footBase} justify-end pt-1`}>
      <button type="button" className={footSecondary} onClick={onRequestChanges}>Pedir ajustes</button>
      <button type="button" className={`${footPrimary} w-full`} disabled={!canAuthorize} onClick={() => setConfirming(true)}>Autorizar execução</button>
    </footer>}
  </article>;
}
