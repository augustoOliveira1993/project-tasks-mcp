export type FilterField = 'name' | 'id' | 'status' | 'area' | 'type' | 'priority' | 'responsible' | 'feature' | 'createdAt' | 'updatedAt' | 'checked' | 'unread' | 'openQuestions' | 'hasGitDiff';
export type FilterOperator = 'contains' | 'not' | 'exact' | 'equals' | 'startsWith' | 'endsWith' | 'is' | 'isNot' | 'in' | 'notIn' | 'isEmpty' | 'isNotEmpty' | 'before' | 'after' | 'on' | 'between' | 'gt' | 'gte' | 'lt' | 'lte';
export type FilterCondition = { kind: 'condition'; field: FilterField; operator: FilterOperator; value?: string | number | boolean | Array<string | number> };
export type FilterGroup = { kind: 'group'; operator: 'AND' | 'OR'; children: FilterNode[] };
export type FilterNode = FilterCondition | FilterGroup;

export const emptyFilterGroup = (): FilterGroup => ({ kind: 'group', operator: 'AND', children: [] });

export const filterFields: Array<{ value: FilterField; label: string; type: 'text' | 'enum' | 'number' | 'date' | 'boolean' }> = [
  { value: 'name', label: 'Nome da tarefa', type: 'text' }, { value: 'id', label: 'ID', type: 'text' },
  { value: 'status', label: 'Status', type: 'enum' }, { value: 'area', label: 'Área', type: 'enum' },
  { value: 'type', label: 'Tipo', type: 'enum' }, { value: 'priority', label: 'Prioridade', type: 'number' },
  { value: 'responsible', label: 'Responsável', type: 'enum' }, { value: 'feature', label: 'Feature', type: 'enum' },
  { value: 'createdAt', label: 'Data de criação', type: 'date' }, { value: 'updatedAt', label: 'Data de atualização', type: 'date' },
  { value: 'checked', label: 'Conferida', type: 'boolean' }, { value: 'unread', label: 'Tem novidades não lidas', type: 'boolean' },
  { value: 'openQuestions', label: 'Tem perguntas abertas', type: 'boolean' }, { value: 'hasGitDiff', label: 'Tem diff Git', type: 'boolean' }
];

export const operatorsForField: Record<FilterField, FilterOperator[]> = {
  name: ['contains', 'not', 'exact', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'], id: ['exact', 'startsWith', 'isEmpty', 'isNotEmpty'],
  status: ['is', 'isNot', 'in', 'notIn'], area: ['is', 'isNot', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  type: ['is', 'isNot', 'in', 'notIn'], priority: ['is', 'isNot', 'gt', 'gte', 'lt', 'lte', 'between'],
  responsible: ['is', 'isNot', 'in', 'notIn', 'isEmpty', 'isNotEmpty'], feature: ['is', 'isNot', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  createdAt: ['on', 'before', 'after', 'between'], updatedAt: ['on', 'before', 'after', 'between'],
  checked: ['is'], unread: ['is'], openQuestions: ['is'], hasGitDiff: ['is']
};

export const operatorLabels: Record<FilterOperator, string> = {
  contains: 'contém', not: 'não contém', exact: 'exatamente igual a', equals: 'exatamente igual a', startsWith: 'começa com', endsWith: 'termina com', is: 'é', isNot: 'não é', in: 'está em', notIn: 'não está em',
  isEmpty: 'está vazio', isNotEmpty: 'não está vazio', before: 'antes de', after: 'depois de', on: 'em', between: 'entre',
  gt: 'maior que', gte: 'maior ou igual a', lt: 'menor que', lte: 'menor ou igual a'
};

export const defaultCondition = (field: FilterField = 'status'): FilterCondition => {
  const operator = operatorsForField[field][0];
  const type = filterFields.find(item => item.value === field)?.type;
  const value = operator === 'in' || operator === 'notIn' ? [] : type === 'boolean' ? true : type === 'number' ? 2 : type === 'date' ? '' : '';
  return { kind: 'condition', field, operator, ...(operator === 'isEmpty' || operator === 'isNotEmpty' ? {} : { value }) };
};

export function expressionHasRules(node?: FilterNode): boolean {
  return Boolean(node && (node.kind === 'condition' || node.children.some(expressionHasRules)));
}

export function expressionIsReady(node?: FilterNode, root = true): boolean {
  if (!node) return true;
  if (node.kind === 'group') return (root && node.children.length === 0 || node.children.length > 0) && node.children.every(child => expressionIsReady(child, false));
  if (node.operator === 'isEmpty' || node.operator === 'isNotEmpty') return true;
  if (node.operator === 'between' && !Array.isArray(node.value)) return false;
  if (Array.isArray(node.value)) {
    if (node.operator === 'between') return node.value.length === 2 && node.value.every(value => typeof value === 'number'
      ? Number.isInteger(value) && value >= 0 && value <= 5
      : value.trim().length > 0 && (node.field !== 'priority' || Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 5));
    return node.value.length > 0 && node.value.every(value => typeof value === 'number' || value.trim().length > 0);
  }
  if (node.field === 'priority') return typeof node.value === 'number' && Number.isInteger(node.value) && node.value >= 0 && node.value <= 5;
  if (typeof node.value === 'string') return node.value.trim().length > 0;
  return node.value !== undefined && node.value !== null;
}

export function decodeFilterExpression(value: string | null): FilterGroup {
  if (!value?.startsWith('v1.') || value.length > 8192) return emptyFilterGroup();
  try {
    const base64 = value.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as FilterNode;
    let conditions = 0;
    const valid = (node: any, groupDepth: number): boolean => {
      if (!node || typeof node !== 'object') return false;
      if (node.kind === 'condition') {
        conditions++;
        return conditions <= 20 && filterFields.some(field => field.value === node.field)
          && Object.hasOwn(operatorsForField, node.field)
          && (operatorsForField[node.field as FilterField].includes(node.operator)
            || (node.operator === 'equals' && ['name', 'id'].includes(node.field)));
      }
      if (node.kind !== 'group' || !['AND', 'OR'].includes(node.operator) || !Array.isArray(node.children) || !node.children.length || node.children.length > 20 || groupDepth >= 3) return false;
      return node.children.every((child: unknown) => valid(child, groupDepth + 1));
    };
    if (parsed.kind !== 'group' || !valid(parsed, 0)) return emptyFilterGroup();
    const normalizeLegacyExact = (node: FilterNode): FilterNode => node.kind === 'condition'
      ? ['name', 'id'].includes(node.field) && node.operator === 'equals' ? { ...node, operator: 'exact' } : node
      : { ...node, children: node.children.map(normalizeLegacyExact) };
    return normalizeLegacyExact(parsed) as FilterGroup;
  } catch { return emptyFilterGroup(); }
}

export function encodeFilterExpression(node: FilterGroup): string | null {
  if (!expressionHasRules(node)) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(node));
  let binary = '';
  bytes.forEach(value => { binary += String.fromCharCode(value); });
  return `v1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

