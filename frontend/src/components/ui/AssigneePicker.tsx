import { useState } from 'react';
import type { Assignee } from '../../features/tasks/assignees';
import { personName } from '../../lib/labels';

const OTHER = '__other__';
const control = 'min-h-[34px] w-full rounded-ui-sm border border-line-strong bg-white px-2 py-0 text-ui-sm';
const note = 'text-ui-xs text-muted-strong';

type Props = {
  assignees: Assignee[];
  isPending?: boolean;
  isError?: boolean;
  defaultValue?: string | null;
  /** Nome do campo de formulário (um input oculto leva o valor final). */
  name?: string;
  label?: string;
  allowEmpty?: boolean;
  /** Permite digitar um e-mail fora da lista; desligue quando só valem responsáveis cadastrados. */
  allowCustom?: boolean;
  emptyLabel?: string;
  onChange?: (email: string) => void;
  className?: string;
};

/** Seleciona o responsável entre as credenciais cadastradas (pessoas e agentes); aceita outro e-mail quando necessário. */
export function AssigneePicker({ assignees, isPending = false, isError = false, defaultValue = '', name, label = 'Responsável', allowEmpty = true, allowCustom = true, emptyLabel = 'Sem responsável', onChange, className = '' }: Props) {
  const initial = (defaultValue ?? '').trim();
  const [selected, setSelected] = useState(initial);
  const [custom, setCustom] = useState(false);
  const people = assignees.filter(item => item.kind === 'pessoa');
  const agents = assignees.filter(item => item.kind === 'agente');
  const match = assignees.find(item => item.email.toLowerCase() === selected.toLowerCase());
  const currentIsExtra = Boolean(selected) && !custom && !match;

  function update(value: string) {
    setSelected(value);
    onChange?.(value);
  }

  return <div className={`grid min-w-0 gap-1.5 ${className}`.trim()}>
    <label className="grid gap-[5px] text-inherit [font-size:inherit] [font-weight:inherit]">{label}
      <select className={control} value={custom ? OTHER : match?.email ?? selected} disabled={isPending} onChange={event => {
        if (event.target.value === OTHER) { setCustom(true); update(''); }
        else { setCustom(false); update(event.target.value); }
      }}>
        {allowEmpty && <option value="">{isPending ? 'Carregando credenciais…' : emptyLabel}</option>}
        {currentIsExtra && <option value={selected}>{selected} (atual, sem credencial ativa)</option>}
        {people.length > 0 && <optgroup label="Pessoas">{people.map(item => <option key={item.email} value={item.email}>{personName(item.email)} · {item.email}</option>)}</optgroup>}
        {agents.length > 0 && <optgroup label="Agentes de IA">{agents.map(item => <option key={item.email} value={item.email}>{item.email}</option>)}</optgroup>}
        {allowCustom && <option value={OTHER}>Outro e-mail…</option>}
      </select>
    </label>
    {custom && <input className={control} type="text" autoFocus maxLength={320} value={selected} placeholder="E-mail ou nome" aria-label={`${label}: outro e-mail`} onChange={event => update(event.target.value)} />}
    {isError && <small className={`${note} mt-1 font-semibold`}>Não foi possível listar as credenciais; {allowCustom ? 'use “Outro e-mail…”.' : 'tente atualizar a página.'}</small>}
    {!isPending && !isError && assignees.length === 0 && <small className={note}>Nenhuma credencial ativa encontrada para este projeto.</small>}
    {name && <input type="hidden" name={name} value={selected} />}
  </div>;
}
