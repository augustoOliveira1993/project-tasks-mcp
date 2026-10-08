import { IconCheck } from '../ui/icons';
import { phaseLabels, type ConversationPhase } from '../../lib/conversation-ui';
import type { ConversationStage } from './conversation-types';

const connector = "not-last:after:mx-2 not-last:after:h-0.5 not-last:after:min-w-3 not-last:after:flex-[1_1_12px] not-last:after:content-['']";
const stepStates = {
  done: { item: 'not-last:after:bg-[#1f8a4c]', dot: 'border-[#1f8a4c] bg-[#1f8a4c] text-white', label: '' },
  current: { item: 'not-last:after:bg-[#d5dae3]', dot: 'border-[#4b4fcb] bg-[#4b4fcb] text-white', label: ' font-bold text-ink' },
  future: { item: 'not-last:after:bg-[#d5dae3]', dot: 'border-[#c5cad6] bg-white text-muted-strong', label: '' }
};

/** Mostra as etapas do tipo selecionado; o tipo Geral mantém as quatro fases conhecidas. */
export function ConversationStepper({ phase, stages }: { phase: ConversationPhase; stages?: ConversationStage[] }) {
  const labels = stages?.length ? stages.map(stage => stage.title) : [...phaseLabels];
  const current = stages?.length
    ? phase >= 4 ? stages.length : phase >= 3 ? Math.max(1, stages.length - 1) : 1
    : phase;
  return <nav className="flex-none border-b border-[#eef0f4] bg-white px-5 py-2.5" aria-label="Fases da conversa">
    <p className="mb-1.5 hidden text-ui-sm font-semibold text-ink-2 max-[768px]:block" aria-hidden="true">Passo {current} de {labels.length} · {labels[current - 1]}</p>
    <ol className="flex min-w-0 items-center overflow-x-auto max-[768px]:hidden">{labels.map((label, index) => {
      const number = index + 1;
      const state = number < current ? 'done' : number === current ? 'current' : 'future';
      const tone = stepStates[state];
      return <li key={label} className={`flex min-w-0 flex-[1_1_0] items-center gap-2 text-[12.5px] text-muted-strong ${connector} ${tone.item}`} aria-current={state === 'current' ? 'step' : undefined}>
        <span className={`inline-grid size-6 flex-none place-items-center rounded-full border-2 text-[11.5px] font-bold ${tone.dot}`} aria-hidden="true">{state === 'done' ? <IconCheck size={12} /> : number}</span>
        <span className={'whitespace-nowrap' + tone.label}>{label}<span className="sr-only">{state === 'done' ? ' (concluída)' : state === 'current' ? ' (fase atual)' : ' (pendente)'}</span></span>
      </li>;
    })}</ol>
  </nav>;
}
