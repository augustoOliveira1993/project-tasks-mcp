import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { defaultCondition, filterFields, operatorLabels, operatorsForField, type FilterCondition, type FilterField, type FilterGroup, type FilterNode } from './advanced-filter';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';

const fieldClass = 'grid min-w-0 gap-2 text-sm font-medium text-foreground';
const controlClass = 'min-h-9 min-w-0 w-full rounded-md border-border bg-background text-sm';
const operatorsWithoutValue = new Set(['isEmpty', 'isNotEmpty']);

type Option = { value: string; label: string };
const booleanOptions: Option[] = [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }];

function normalizeOptionSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function OptionValuePicker({ options, value, ariaLabel, multiple, booleanValue = false, emptyLabel = 'Selecione…', emptyValue = '', className = 'grid gap-1.5', controlClassName = controlClass, popover = false, onChange }: {
  options: Option[]; value: unknown; ariaLabel: string; multiple: boolean; booleanValue?: boolean; emptyLabel?: string; emptyValue?: string;
  className?: string; controlClassName?: string; popover?: boolean; onChange: (value: string | string[] | boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !popover) return;
    const update = () => { if (triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect()); };
    update();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false); setSearch('');
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('pointerdown', dismiss, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); document.removeEventListener('pointerdown', dismiss, true); };
  }, [open, popover]);
  const floating = popover && anchor !== null;
  const flip = floating && anchor.bottom + 300 > window.innerHeight && anchor.top > 300;
  const floatingStyle = floating ? { position: 'fixed' as const, left: Math.max(8, Math.min(anchor.left, window.innerWidth - 288)), minWidth: anchor.width, ...(flip ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }) } : undefined;
  const selectedValues = multiple
    ? Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === emptyValue ? [] : [String(value)]
    : value === undefined || value === null || value === emptyValue ? [] : [String(value)];
  const selectedOptions = selectedValues.map(selected => options.find(option => option.value === selected) ?? { value: selected, label: selected });
  const normalizedSearch = normalizeOptionSearch(search.trim());
  const filteredOptions = options.filter(option => normalizeOptionSearch(`${option.label} ${option.value}`).includes(normalizedSearch));
  const close = () => { setOpen(false); setSearch(''); triggerRef.current?.focus(); };
  const wrapPanel = (panel: ReactNode) => popover ? createPortal(panel, document.body) : panel;
  function selectValue(selected: string) {
    if (multiple) {
      onChange(selectedValues.includes(selected) ? selectedValues.filter(value => value !== selected) : [...selectedValues, selected]);
      return;
    }
    onChange(booleanValue ? selected === 'true' : selected);
    close();
  }

  return <div className={popover ? `relative ${className}` : className} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    {multiple && <div className="flex flex-wrap gap-1.5" aria-label={`${ariaLabel} selecionados`}>
      {selectedOptions.length ? selectedOptions.map(option => <span key={option.value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 py-0.5 pr-1 pl-2 text-[10px] font-medium text-indigo-800">
        <span className="max-w-[260px] truncate" title={option.label}>{option.label}</span>
        <Button type="button" variant="ghost" size="icon" className="size-5 rounded-full text-indigo-700 hover:bg-indigo-100" aria-label={`Remover ${option.label}`} onClick={() => selectValue(option.value)}>×</Button>
      </span>) : <span className="text-[10px] font-normal text-slate-400">Nenhuma opção selecionada</span>}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button ref={triggerRef} type="button" variant="outline" className={`${controlClassName} inline-flex w-full items-center justify-between gap-2 text-left`} aria-label={`${open ? 'Fechar' : 'Selecionar'} valores de ${ariaLabel}`} aria-expanded={open} aria-controls={panelId} onClick={() => open ? close() : setOpen(true)}>
        <span className="min-w-0 truncate">{open ? 'Fechar opções' : multiple ? 'Selecionar opções' : selectedOptions[0]?.label ?? emptyLabel}</span>
        {multiple && selectedValues.length > 0 && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{selectedValues.length} {selectedValues.length === 1 ? 'opção selecionada' : 'opções selecionadas'}</span>}
        <span aria-hidden="true" className="shrink-0 text-slate-400">{open ? '⌃' : '⌄'}</span>
      </Button>
      {selectedValues.length > 0 && !booleanValue && !popover && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange(multiple ? [] : emptyValue)}>Limpar seleção</Button>}
    </div>
    {open && (popover && !floating ? null : wrapPanel(<div id={panelId} ref={panelRef} style={floatingStyle} className={`grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 ${popover ? 'z-[70] w-max max-w-[280px] shadow-lg' : ''}`}>
      <Input className={controlClass} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar opções…" aria-label={`Buscar opções de ${ariaLabel}`} autoComplete="off" autoFocus />
      {filteredOptions.length ? <div className="grid max-h-44 gap-0.5 overflow-y-auto" role="group" aria-label={`Opções de ${ariaLabel}`}>
        {filteredOptions.map(option => <label key={option.value} className={`flex min-h-9 cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-[11px] font-normal hover:bg-white ${selectedValues.includes(option.value) ? 'bg-white text-indigo-800' : 'text-slate-700'}`}>
          {multiple ? <Checkbox className="mt-0.5 size-3.5 accent-indigo-600" checked={selectedValues.includes(option.value)} onChange={() => selectValue(option.value)} /> : <input className="mt-0.5 size-3.5 shrink-0 accent-indigo-600" type="radio" name={panelId} checked={selectedValues.includes(option.value)} onChange={() => selectValue(option.value)} />}
          <span className="min-w-0 break-words">{option.label}</span>
        </label>)}
      </div> : <p className="m-0 px-2 py-3 text-center text-[10px] text-slate-500">Nenhuma opção encontrada.</p>}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
        <span className="text-[10px] text-slate-500">{selectedValues.length} {selectedValues.length === 1 ? 'valor selecionado' : 'valores selecionados'}</span>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={close}>Concluir</Button>
      </div>
    </div>))}
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
      {(['AND', 'OR'] as const).map(operator => <Button key={operator} type="button" variant={group.operator === operator ? 'secondary' : 'ghost'} size="sm" className="rounded-full" aria-pressed={group.operator === operator} onClick={() => setDraft(current => updateNode(current, path, node => node.kind === 'group' ? { ...node, operator } : node) as FilterGroup)}>{operator}</Button>)}
      </div>
      {depth > 0 && <Button type="button" variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={remove}>Remover grupo</Button>}
    </div>
    {!group.children.length && <p className="m-0 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400">Adicione uma condição ou um grupo para começar.</p>}
    {group.children.map((node, index) => node.kind === 'group'
      ? <GroupEditor key={`${path.join('.')}-${index}`} group={node} path={[...path, index]} depth={depth + 1} options={options} setDraft={setDraft} remove={() => removeChild(index)} />
      : <ConditionEditor key={`${path.join('.')}-${index}`} condition={node} options={options} onChange={update => editChild(index, current => current.kind === 'condition' ? update(current) : current)} onRemove={() => removeChild(index)} />)}
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" variant="outline" size="sm" onClick={() => setDraft(current => addChild(current, path, defaultCondition()))}>＋ Condição</Button>
      {depth < 2 && <Button type="button" variant="outline" size="sm" onClick={() => setDraft(current => addChild(current, path, { kind: 'group', operator: 'AND', children: [defaultCondition()] }))}>＋ Grupo</Button>}
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
    if (field.type === 'date') return <Input className={controlClass} aria-label={aria} type="date" value={String(value ?? '')} onChange={event => set(event.target.value)} />;
    if (field.type === 'number') return <Input className={controlClass} aria-label={aria} type="number" min="0" max="5" step="1" value={String(value ?? '')} onChange={event => set(event.target.value === '' ? '' : Number(event.target.value))} />;
    return <Input className={controlClass} aria-label={aria} value={String(value ?? '')} placeholder={condition.field === 'id' ? 'ID ou prefixo' : 'Digite um valor'} onChange={event => set(event.target.value)} />;
  };
  return <div className="grid @container gap-2 rounded-[10px] border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_#1d29390d]">
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 @max-[520px]:grid-cols-1">
      <label className={fieldClass}>Campo<Select value={condition.field} onValueChange={value => changeField(value as FilterField)}><SelectTrigger className={controlClass}><SelectValue /></SelectTrigger><SelectContent>{filterFields.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>
      <label className={fieldClass}>Operador<Select value={condition.operator} onValueChange={value => setOperator(value as FilterCondition['operator'])}><SelectTrigger className={controlClass}><SelectValue /></SelectTrigger><SelectContent>{operators.map(operator => <SelectItem key={operator} value={operator}>{operatorLabels[operator]}</SelectItem>)}</SelectContent></Select></label>
      <Button type="button" variant="ghost" size="sm" className="self-end text-muted-foreground @max-[520px]:justify-self-end" onClick={onRemove} aria-label="Remover condição">Remover</Button>
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
  return <Sheet open={open} onOpenChange={nextOpen => { if (!nextOpen) close(); }}>
    <SheetContent side="right" showCloseButton={false} aria-labelledby="advanced-filter-title" className="w-full gap-0 p-0 sm:max-w-[580px]">
      <SheetHeader className="shrink-0 flex-row items-start justify-between gap-4 border-b border-border px-5 py-5">
        <div className="grid gap-1"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Construtor de regras</span><SheetTitle id="advanced-filter-title">Filtros avançados</SheetTitle><SheetDescription className="max-w-[410px]">Combine campos da tarefa e sinais de colaboração. Grupos podem usar AND ou OR.</SheetDescription></div>
        <Button type="button" variant="outline" size="sm" onClick={close} aria-label="Fechar filtros">Fechar</Button>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{quickControls && <div className="mb-5 border-b border-border pb-4">{quickControls}</div>}<GroupEditor group={draft} path={[]} depth={0} options={options} setDraft={setDraft} /></div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3.5 max-[420px]:grid max-[420px]:grid-cols-2">
        <Button type="button" variant="ghost" onClick={clear}>Limpar</Button>
        <div className="ml-auto flex items-center gap-2 max-[420px]:col-[1/-1] max-[420px]:ml-0 max-[420px]:justify-end">{!valid && <span className="text-xs text-amber-700" role="status">Complete as condições antes de aplicar.</span>}<Button type="button" variant="outline" onClick={close}>Cancelar</Button><Button type="button" onClick={apply} disabled={!valid}>Aplicar filtros</Button></div>
      </footer>
    </SheetContent>
  </Sheet>;
}

