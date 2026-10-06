import { IconCheck } from '../ui/icons';
import { phaseLabels, type ConversationPhase } from '../../lib/conversation-ui';

/** Fases da conversa: Esclarecer → Proposta → Autorização → Execução. */
export function ConversationStepper({ phase }: { phase: ConversationPhase }) {
  return <nav className="conversation-stepper" aria-label="Fases da conversa">
    <p className="stepper-compact" aria-hidden="true">Passo {phase} de 4 · {phaseLabels[phase - 1]}</p>
    <ol>{phaseLabels.map((label, index) => {
      const number = index + 1;
      const state = number < phase ? 'done' : number === phase ? 'current' : 'future';
      return <li key={label} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="step-dot" aria-hidden="true">{state === 'done' ? <IconCheck size={12} /> : number}</span>
        <span className="step-label">{label}<span className="sr-only">{state === 'done' ? ' (concluída)' : state === 'current' ? ' (fase atual)' : ' (pendente)'}</span></span>
      </li>;
    })}</ol>
  </nav>;
}
