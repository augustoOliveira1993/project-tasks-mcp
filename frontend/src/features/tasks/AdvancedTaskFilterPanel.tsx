import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { defaultCondition, filterFields, operatorLabels, operatorsForField, type FilterCondition, type FilterField, type FilterGroup, type FilterNode } from './advanced-filter';
import { buttonBase, buttonPrimary, buttonSecondarySmall } from '../../components/ui/classes';

const fieldClass = 'grid min-w-0 gap-1 text-[10px] font-semibold text-slate-600';
const controlClass = 'min-h-[34px] min-w-0 rounded-[7px] border border-slate-200 bg-white px-2.5 text-[11px] font-normal text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const quietButton = `${buttonBase} min-h-[29px] border-transparent bg-transparent px-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-100`;
const operatorsWithoutValue = new Set(['isEmpty', 'isNotEmpty']);

type Option = { value: string; label: string };
type Props = {
  open: boolean;
  draft: FilterGroup;
  valid: boolean;
  setDraft: Dispatch<SetStateAction<FilterGroup>>;
  options: Partial<Record<FilterField, Option[]>>;
  quickControls?: ReactNode;
  close: () => void;
  apply: () => void;
  clear: () => void;
};

function updateNode(node: FilterNode, path: number[], update: (target: FilterNode) => FilterNode): FilterNode {
  if (!path.length) return update(node);
  if (node.kind !== 'group') return node;
  const [index, ...rest] = path;
  return { ...node, children: node.children.map((child, childIndex) => childIndex === index ? updateNode(child, rest, update) : child) };
}

function addChild(group: FilterGroup, path: number[], child: FilterNode): FilterGroup {
  return updateNode(group, path, node => node.kind === 'group' ? { ...node, children: [...node.children, child] } : node) as FilterGroup;
}

function GroupEditor({ group, path, depth, options, setDraft, remove }: {
  group: FilterGroup; path: number[]; depth: number; options: Props['options']; setDraft: Props['setDraft']; remove?: () => void;
}) {
  function editChild(index: number, update: (node: FilterNode) => FilterNode) {
    setDraft(current => updateNode(current, [...path, index], update) as FilterGroup);
  }
  function removeChild(index: number) {
    setDraft(current => updateNode(current, path, node => node.kind === 'group' ? { ...node, children: node.children.filter((_item, childIndex) => childIndex !== index) } : node) as FilterGroup);
  }
  return <div className={`${depth ? 'ml-3 border-l-2 border-indigo-100 pl-3' : ''} grid gap-2.5`}>
    <div className="flex flex-wrap items-center gap-2">
      <strong className="text-[10px] text-slate-500">Combine as</strong>
      <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Combinar condições">
        {(['AND', 'OR'] as const).map(operator => <button key={operator} type="button" className={`rounded-full px-3 py-1 text-[10px] font-bold ${group.operator === operator ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`} aria-pressed={group.operator === operator} onClick={() => setDraft(current => updateNode(current, path, node => node.kind === 'group' ? { ...node, operator } : node) as FilterGroup)}>{operator}</button>)}
      </div>
      {depth > 0 && <button type="button" className={`${quietButton} ml-auto`} onClick={remove}>Remover grupo</button>}
    </div>
    {!group.children.length && <p className="m-0 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400">Adicione uma condição ou um grupo para começar.</p>}
    {group.children.map((node, index) => node.kind === 'group'
      ? <GroupEditor key={`${path.join('.')}-${index}`} group={node} path={[...path, index]} depth={depth + 1} options={options} setDraft={setDraft} remove={() => removeChild(index)} />
      : <ConditionEditor key={`${path.join('.')}-${index}`} condition={node} options={options} onChange={update => editChild(index, current => current.kind === 'condition' ? update(current) : current)} onRemove={() => removeChild(index)} />)}
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={quietButton} onClick={() => setDraft(current => addChild(current, path, defaultCondition()))}>＋ Condição</button>
      {depth < 2 && <button type="button" className={quietButton} onClick={() => setDraft(current => addChild(current, path, { kind: 'group', operator: 'AND', children: [defaultCondition()] }))}>＋ Grupo</button>}
    </div>
  </div>;
}

function ConditionEditor({ condition, options, onChange, onRemove }: {
  condition: FilterCondition; options: Props['options']; onChange: (update: (value: FilterCondition) => FilterCondition) => void; onRemove: () => void;
}) {
  const field = filterFields.find(item => item.value === condition.field)!;
  const operators = operatorsForField[condition.field];
  const values = options[condition.field] ?? [];
  function changeField(next: FilterField) { const nextCondition = defaultCondition(next); onChange(() => nextCondition); }
  function setOperator(next: FilterCondition['operator']) {
    onChange(current => ({ ...current, operator: next,
      ...(operatorsWithoutValue.has(next) ? { value: undefined }
        : { value: next === 'between' ? ['', ''] : (next === 'in' || next === 'notIn') ? (Array.isArray(current.value) ? current.value : []) : Array.isArray(current.value) ? '' : current.value ?? '' })
    }));
  }
  function setRangePart(index: number, next: unknown) {
    onChange(current => {
      const parts: Array<string | number> = Array.isArray(current.value) ? [...current.value] : ['', ''];
      parts[index] = field.type === 'number' ? next as string | number : String(next ?? '');
      return { ...current, value: parts };
    });
  }
  const noValue = operatorsWithoutValue.has(condition.operator);
  const range = condition.operator === 'between';
  const renderValue = (value: unknown, set: (value: unknown) => void, aria: string) => {
    if (field.type === 'boolean') return <select className={controlClass} aria-label={aria} value={String(value ?? true)} onChange={event => set(event.target.value === 'true')}><option value="true">Sim</option><option value="false">Não</option></select>;
    if (field.type === 'enum' && values.length && ['in', 'notIn'].includes(condition.operator)) return <select multiple className={`${controlClass} min-h-[72px] py-1`} aria-label={aria} value={Array.isArray(value) ? value : []} onChange={event => set(Array.from(event.currentTarget.selectedOptions, option => option.value))}>{values.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    if (field.type === 'enum' && values.length) return <select className={controlClass} aria-label={aria} value={String(value ?? '')} onChange={event => set(event.target.value)}><option value="">Selecione…</option>{values.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    if (field.type === 'date') return <input className={controlClass} aria-label={aria} type="date" value={String(value ?? '')} onChange={event => set(event.target.value)} />;
    if (field.type === 'number') return <input className={controlClass} aria-label={aria} type="number" min="0" max="5" step="1" value={String(value ?? '')} onChange={event => set(event.target.value === '' ? '' : Number(event.target.value))} />;
    return <input className={controlClass} aria-label={aria} value={String(value ?? '')} placeholder={condition.field === 'id' ? 'ID ou prefixo' : 'Digite um valor'} onChange={event => set(event.target.value)} />;
  };
  return <div className="grid gap-2 rounded-[10px] border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_#1d29390d]">
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 max-[600px]:grid-cols-1">
      <label className={fieldClass}>Campo<select className={controlClass} value={condition.field} onChange={event => changeField(event.target.value as FilterField)}>{filterFields.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className={fieldClass}>Operador<select className={controlClass} value={condition.operator} onChange={event => setOperator(event.target.value as FilterCondition['operator'])}>{operators.map(operator => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select></label>
      <button type="button" className={`${quietButton} self-end max-[600px]:justify-self-end`} onClick={onRemove} aria-label="Remover condição">Remover</button>
    </div>
    {!noValue && <div className={`grid gap-2 ${range ? 'grid-cols-2' : 'grid-cols-1'}`}>
      <label className={fieldClass}>{range ? (field.type === 'number' ? 'Mínimo' : 'De') : 'Valor'}{renderValue(range ? (Array.isArray(condition.value) ? condition.value[0] : '') : condition.value, next => range ? setRangePart(0, next) : onChange(current => ({ ...current, value: next as FilterCondition['value'] })), range ? 'Valor mínimo/inicial' : 'Valor do filtro')}</label>
      {range && <label className={fieldClass}>{field.type === 'number' ? 'Máximo' : 'Até'}{renderValue(Array.isArray(condition.value) ? condition.value[1] : '', next => setRangePart(1, next), 'Valor máximo/final')}</label>}
    </div>}
  </div>;
}

export function AdvancedTaskFilterPanel({ open, draft, valid, setDraft, options, quickControls, close, apply, clear }: Props) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/30 backdrop-blur-[1px]" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="flex h-full w-[min(580px,100vw)] flex-col border-l border-slate-200 bg-white shadow-2xl max-[760px]:w-full max-[760px]:border-0" role="dialog" aria-modal="true" aria-labelledby="advanced-filter-title">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5">
        <div><span className="text-[10px] font-bold uppercase tracking-[.12em] text-indigo-600">Construtor de regras</span><h2 id="advanced-filter-title" className="mb-1 mt-1 font-display text-[17px] font-bold text-slate-800">Filtros avançados</h2><p className="m-0 max-w-[410px] text-[11px] leading-relaxed text-slate-500">Combine campos da tarefa e sinais de colaboração. Grupos podem usar AND ou OR.</p></div>
        <button type="button" className={quietButton} onClick={close} aria-label="Fechar filtros">Fechar</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{quickControls && <div className="mb-5 border-b border-slate-100 pb-4">{quickControls}</div>}<GroupEditor group={draft} path={[]} depth={0} options={options} setDraft={setDraft} /></div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5 max-[420px]:grid max-[420px]:grid-cols-2">
        <button type="button" className={quietButton} onClick={clear}>Limpar</button>
        <div className="ml-auto flex items-center gap-2 max-[420px]:col-[1/-1] max-[420px]:ml-0 max-[420px]:justify-end">{!valid && <span className="text-[10px] text-amber-700" role="status">Complete as condições antes de aplicar.</span>}<button type="button" className={buttonSecondarySmall} onClick={close}>Cancelar</button><button type="button" className={`${buttonPrimary} disabled:cursor-not-allowed disabled:opacity-45`} onClick={apply} disabled={!valid}>Aplicar filtros</button></div>
      </footer>
    </aside>
  </div>;
}

