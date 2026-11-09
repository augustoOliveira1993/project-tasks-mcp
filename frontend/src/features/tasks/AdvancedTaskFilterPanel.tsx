import { useId, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { defaultCondition, filterFields, operatorLabels, operatorsForField, type FilterCondition, type FilterField, type FilterGroup, type FilterNode } from './advanced-filter';
import { buttonBase, buttonPrimary, buttonSecondarySmall } from '../../components/ui/classes';

const fieldClass = 'grid min-w-0 gap-1 text-[10px] font-semibold text-slate-600';
const controlClass = 'min-h-[34px] min-w-0 rounded-[7px] border border-slate-200 bg-white px-2.5 text-[11px] font-normal text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const quietButton = `${buttonBase} min-h-[29px] border-transparent bg-transparent px-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-100`;
const operatorsWithoutValue = new Set(['isEmpty', 'isNotEmpty']);

type Option = { value: string; label: string };
const booleanOptions: Option[] = [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }];

function normalizeOptionSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function OptionValuePicker({ options, value, ariaLabel, multiple, booleanValue = false, emptyLabel = 'Selecione…', emptyValue = '', className = 'grid gap-1.5', controlClassName = controlClass, onChange }: {
  options: Option[]; value: unknown; ariaLabel: string; multiple: boolean; booleanValue?: boolean; emptyLabel?: string; emptyValue?: string;
  className?: string; controlClassName?: string; onChange: (value: string | string[] | boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedValues = multiple
    ? Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === emptyValue ? [] : [String(value)]
    : value === undefined || value === null || value === emptyValue ? [] : [String(value)];
  const selectedOptions = selectedValues.map(selected => options.find(option => option.value === selected) ?? { value: selected, label: selected });
  const normalizedSearch = normalizeOptionSearch(search.trim());
  const filteredOptions = options.filter(option => normalizeOptionSearch(`${option.label} ${option.value}`).includes(normalizedSearch));
  const close = () => { setOpen(false); setSearch(''); triggerRef.current?.focus(); };
  function selectValue(selected: string) {
    if (multiple) {
      onChange(selectedValues.includes(selected) ? selectedValues.filter(value => value !== selected) : [...selectedValues, selected]);
      return;
    }
    onChange(booleanValue ? selected === 'true' : selected);
    close();
  }

  return <div className={className} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    {multiple && <div className="flex flex-wrap gap-1.5" aria-label={`${ariaLabel} selecionados`}>
      {selectedOptions.length ? selectedOptions.map(option => <span key={option.value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 py-0.5 pr-1 pl-2 text-[10px] font-medium text-indigo-800">
        <span className="max-w-[260px] truncate" title={option.label}>{option.label}</span>
        <button type="button" className="grid size-5 shrink-0 place-items-center rounded-full text-indigo-700 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-500" aria-label={`Remover ${option.label}`} onClick={() => selectValue(option.value)}>×</button>
      </span>) : <span className="text-[10px] font-normal text-slate-400">Nenhuma opção selecionada</span>}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <button ref={triggerRef} type="button" className={`${controlClassName} inline-flex w-full items-center justify-between gap-2 text-left`} aria-label={`${open ? 'Fechar' : 'Selecionar'} valores de ${ariaLabel}`} aria-expanded={open} aria-controls={panelId} onClick={() => open ? close() : setOpen(true)}>
        <span className="min-w-0 truncate">{open ? 'Fechar opções' : multiple ? 'Selecionar opções' : selectedOptions[0]?.label ?? emptyLabel}</span>
        {multiple && selectedValues.length > 0 && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{selectedValues.length} {selectedValues.length === 1 ? 'opção selecionada' : 'opções selecionadas'}</span>}
        <span aria-hidden="true" className="shrink-0 text-slate-400">{open ? '⌃' : '⌄'}</span>
      </button>
      {selectedValues.length > 0 && !booleanValue && <button type="button" className={quietButton} onClick={() => onChange(multiple ? [] : emptyValue)}>Limpar seleção</button>}
    </div>
    {open && <div id={panelId} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <input className={controlClass} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar opções…" aria-label={`Buscar opções de ${ariaLabel}`} autoComplete="off" autoFocus />
      {filteredOptions.length ? <div className="grid max-h-44 gap-0.5 overflow-y-auto" role="group" aria-label={`Opções de ${ariaLabel}`}>
        {filteredOptions.map(option => <label key={option.value} className={`flex min-h-9 cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-[11px] font-normal hover:bg-white ${selectedValues.includes(option.value) ? 'bg-white text-indigo-800' : 'text-slate-700'}`}>
          <input className="mt-0.5 size-3.5 shrink-0 accent-indigo-600" type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : panelId} checked={selectedValues.includes(option.value)} onChange={() => selectValue(option.value)} />
          <span className="min-w-0 break-words">{option.label}</span>
        </label>)}
      </div> : <p className="m-0 px-2 py-3 text-center text-[10px] text-slate-500">Nenhuma opção encontrada.</p>}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
        <span className="text-[10px] text-slate-500">{selectedValues.length} {selectedValues.length === 1 ? 'valor selecionado' : 'valores selecionados'}</span>
        <button type="button" className={quietButton} onClick={close}>Concluir</button>
      </div>
    </div>}
  </div>;
}

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
    onChange(current => {
      const value = operatorsWithoutValue.has(next) ? undefined
        : next === 'between' ? ['', '']
          : next === 'in' || next === 'notIn'
            ? Array.isArray(current.value) ? current.value : current.value === undefined || current.value === '' ? [] : [String(current.value)]
            : Array.isArray(current.value) ? current.value[0] ?? '' : current.value ?? '';
      return { ...current, operator: next, value };
    });
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
  const multiSelect = field.type === 'enum' && values.length > 0;
  const optionPicker = field.type === 'boolean' || (field.type === 'enum' && values.length > 0);
  const renderValue = (value: unknown, set: (value: unknown) => void, aria: string) => {
    if (field.type === 'boolean') return <OptionValuePicker key={condition.field} options={booleanOptions} value={value ?? true} ariaLabel={aria} multiple={false} booleanValue onChange={set} />;
    if (field.type === 'enum' && values.length) return <OptionValuePicker key={condition.field} options={values} value={value} ariaLabel={aria} multiple={multiSelect} onChange={next => onChange(current => {
      if (!Array.isArray(next)) return { ...current, value: next as FilterCondition['value'] };
      if (current.operator !== 'is' && current.operator !== 'isNot') return { ...current, value: next };
      if (next.length <= 1) return { ...current, value: next[0] ?? '' };
      return { ...current, operator: current.operator === 'isNot' ? 'notIn' : 'in', value: next };
    })} />;
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
      {optionPicker
        ? <div className={fieldClass}><span>Valor</span>{renderValue(condition.value, next => onChange(current => ({ ...current, value: next as FilterCondition['value'] })), `filtro ${field.label}`)}</div>
        : <label className={fieldClass}>{range ? (field.type === 'number' ? 'Mínimo' : 'De') : 'Valor'}{renderValue(range ? (Array.isArray(condition.value) ? condition.value[0] : '') : condition.value, next => range ? setRangePart(0, next) : onChange(current => ({ ...current, value: next as FilterCondition['value'] })), range ? 'Valor mínimo/inicial' : 'Valor do filtro')}</label>}
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

