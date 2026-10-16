import { z } from 'zod';

export const taskFilterFields = [
  'name', 'id', 'status', 'area', 'type', 'priority', 'responsible', 'feature',
  'createdAt', 'updatedAt', 'checked', 'unread', 'openQuestions', 'hasGitDiff', 'hasPlanning', 'hasAttachments', 'hasConversations'
] as const;
export const taskFilterOperators = [
  'contains', 'not', 'exact', 'equals', 'startsWith', 'endsWith', 'is', 'isNot', 'in', 'notIn', 'isEmpty', 'isNotEmpty',
  'before', 'after', 'on', 'between', 'gt', 'gte', 'lt', 'lte'
] as const;
export type TaskFilterField = typeof taskFilterFields[number];
export type TaskFilterOperator = typeof taskFilterOperators[number];
export type TaskFilterCondition = { kind: 'condition'; field: TaskFilterField; operator: TaskFilterOperator; value?: string | number | boolean | Array<string | number> };
export type TaskFilterGroup = { kind: 'group'; operator: 'AND' | 'OR'; children: TaskFilterNode[] };
export type TaskFilterNode = TaskFilterCondition | TaskFilterGroup;

const filterValue = z.union([
  z.string().max(512), z.number().int().min(0).max(5), z.boolean(),
  z.array(z.string().max(512)).min(1).max(50), z.array(z.number().int().min(0).max(5)).length(2)
]);
const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const conditionSchema = z.object({
  kind: z.literal('condition'), field: z.enum(taskFilterFields), operator: z.enum(taskFilterOperators), value: filterValue.optional()
}).strict().superRefine((condition, context) => {
  const { field, operator, value } = condition;
  const textFields = ['name', 'id', 'responsible'] as const;
  const enumFields = ['status', 'area', 'type', 'feature'] as const;
  const numericFields = ['priority'] as const;
  const dateFields = ['createdAt', 'updatedAt'] as const;
  const booleanFields = ['checked', 'unread', 'openQuestions', 'hasGitDiff', 'hasPlanning', 'hasAttachments', 'hasConversations'] as const;
  const allowed = new Set<TaskFilterOperator>(
    field === 'id' ? ['exact', 'equals', 'startsWith', 'isEmpty', 'isNotEmpty']
      : textFields.includes(field as typeof textFields[number]) ? ['contains', 'not', 'exact', 'equals', 'startsWith', ...(field === 'name' ? ['endsWith' as const] : []), 'isEmpty', 'isNotEmpty'] as TaskFilterOperator[]
      : enumFields.includes(field as typeof enumFields[number]) ? ['is', 'isNot', 'in', 'notIn', 'isEmpty', 'isNotEmpty']
        : numericFields.includes(field as typeof numericFields[number]) ? ['is', 'isNot', 'gt', 'gte', 'lt', 'lte', 'between']
          : dateFields.includes(field as typeof dateFields[number]) ? ['on', 'before', 'after', 'between']
            : booleanFields.includes(field as typeof booleanFields[number]) ? ['is'] : []
  );
  if (!allowed.has(operator)) context.addIssue({ code: 'custom', path: ['operator'], message: `Operator ${operator} is not valid for ${field}` });
  const emptyOperator = operator === 'isEmpty' || operator === 'isNotEmpty';
  if (emptyOperator && value !== undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'This operator does not accept a value' });
  if (!emptyOperator && value === undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'This operator requires a value' });
  if (value === undefined) return;
  if (textFields.includes(field as typeof textFields[number]) && typeof value !== 'string') context.addIssue({ code: 'custom', path: ['value'], message: 'Text fields require a string value' });
  if (enumFields.includes(field as typeof enumFields[number]) && !((typeof value === 'string' && operator !== 'in' && operator !== 'notIn') || (Array.isArray(value) && value.every(item => typeof item === 'string') && ['in', 'notIn'].includes(operator)))) context.addIssue({ code: 'custom', path: ['value'], message: 'Choose one catalog value or a list of values' });
  if (numericFields.includes(field as typeof numericFields[number]) && operator === 'between') {
    if (!Array.isArray(value) || value.length !== 2 || value.some(item => typeof item !== 'number')) context.addIssue({ code: 'custom', path: ['value'], message: 'Priority range requires two numbers' });
    else if (value[0] > value[1]) context.addIssue({ code: 'custom', path: ['value'], message: 'The minimum priority must not exceed the maximum' });
  } else if (numericFields.includes(field as typeof numericFields[number]) && typeof value !== 'number') context.addIssue({ code: 'custom', path: ['value'], message: 'Priority requires a number' });
  if (dateFields.includes(field as typeof dateFields[number]) && (typeof value !== 'string' && !(Array.isArray(value) && value.length === 2))) context.addIssue({ code: 'custom', path: ['value'], message: 'Date operators require a date or a pair of dates' });
  if (dateFields.includes(field as typeof dateFields[number]) && typeof value === 'string' && !isoDate(value)) context.addIssue({ code: 'custom', path: ['value'], message: 'Use a valid date in YYYY-MM-DD format' });
  if (dateFields.includes(field as typeof dateFields[number]) && Array.isArray(value) && (value.length !== 2 || value.some(item => typeof item !== 'string' || !isoDate(item)))) context.addIssue({ code: 'custom', path: ['value'], message: 'Date range requires two valid YYYY-MM-DD dates' });
  if (operator === 'between' && dateFields.includes(field as typeof dateFields[number]) && Array.isArray(value) && value.length === 2 && value[0] > value[1]) context.addIssue({ code: 'custom', path: ['value'], message: 'The start date must be before the end date' });
  if (booleanFields.includes(field as typeof booleanFields[number]) && typeof value !== 'boolean') context.addIssue({ code: 'custom', path: ['value'], message: 'This field requires a boolean value' });
  if (operator === 'in' || operator === 'notIn') if (!Array.isArray(value)) context.addIssue({ code: 'custom', path: ['value'], message: 'Choose one or more catalog values' });
  if (operator !== 'in' && operator !== 'notIn' && operator !== 'between' && Array.isArray(value)) context.addIssue({ code: 'custom', path: ['value'], message: 'This operator accepts one value' });
  if (operator === 'between' && (!Array.isArray(value) || value.length !== 2)) context.addIssue({ code: 'custom', path: ['value'], message: 'Between requires two range values' });
});

const filterNode: z.ZodType<TaskFilterNode> = z.lazy(() => z.union([
  conditionSchema,
  z.object({ kind: z.literal('group'), operator: z.enum(['AND', 'OR']), children: z.array(filterNode).min(1).max(20) }).strict()
]));
export const taskFilterExpressionSchema = filterNode.superRefine((node, context) => {
  let conditions = 0;
  const visit = (current: TaskFilterNode, groupDepth: number, path: Array<string | number>) => {
    if (current.kind === 'condition') { conditions++; return; }
    const nextDepth = groupDepth + 1;
    if (nextDepth > 3) context.addIssue({ code: 'custom', path, message: 'Filter expressions support at most three nested groups' });
    current.children.forEach((child, index) => visit(child, nextDepth, [...path, 'children', index]));
  };
  visit(node, 0, []);
  if (conditions > 20) context.addIssue({ code: 'custom', path: [], message: 'Filter expressions support at most twenty conditions' });
});

export const taskWorkspaceSearchSchema = z.object({
  projectId: z.string().uuid(),
  quick: z.object({
    search: z.string().trim().max(160).optional(), status: z.string().max(80).optional(), area: z.string().max(80).optional(),
    type: z.string().max(80).optional(), priority: z.number().int().min(0).max(5).optional(), responsible: z.string().max(320).optional(),
    featureId: z.string().uuid().optional(), createdAfter: z.string().refine(isoDate, 'Invalid date').optional(),
    createdBefore: z.string().refine(isoDate, 'Invalid date').optional(), updatedAfter: z.string().refine(isoDate, 'Invalid date').optional(),
    updatedBefore: z.string().refine(isoDate, 'Invalid date').optional(), flag: z.enum(['unread', 'questions', 'diff']).optional()
  }).strict().default({}),
  expression: taskFilterExpressionSchema.optional(), sort: z.enum(['priority', 'updated', 'created', 'name', 'status']).default('priority'),
  limit: z.number().int().min(10).max(100).default(25), after: z.string().min(1).max(4096).optional()
}).strict();

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startOfDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const endOfDay = (value: string) => new Date(`${value}T23:59:59.999Z`);

export function compileTaskFilter(node: TaskFilterNode): Record<string, unknown> {
  if (node.kind === 'group') return { [node.operator === 'AND' ? '$and' : '$or']: node.children.map(compileTaskFilter) };
  const { field, operator, value } = node;
  const fieldMap: Record<TaskFilterField, string> = {
    name: 'name', id: '_id', status: 'status', area: 'area', type: 'type', priority: 'priority', responsible: 'responsible', feature: 'featureId',
    createdAt: 'createdAt', updatedAt: 'updatedAt', checked: 'checked', unread: '__workspace.unread', openQuestions: '__workspace.openQuestions', hasGitDiff: '__workspace.hasGitDiff',
    hasPlanning: '__workspace.hasPlanning', hasAttachments: '__workspace.hasAttachments', hasConversations: '__workspace.hasConversations'
  };
  const path = fieldMap[field];
  if (operator === 'isEmpty') return { $or: [{ [path]: { $exists: false } }, { [path]: null }, { [path]: '' }] };
  if (operator === 'isNotEmpty') return { [path]: { $exists: true, $nin: [null, ''] } };
  if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith' || operator === 'not') {
    const pattern = `${operator === 'startsWith' ? '^' : ''}${escaped(String(value))}${operator === 'endsWith' ? '$' : ''}`;
    return { [path]: operator === 'not'
      ? { $not: { $regex: pattern, $options: 'i' } }
      : { $regex: pattern, $options: 'i' } };
  }
  if (operator === 'exact' || operator === 'equals' || operator === 'is') return { [path]: value };
  if (operator === 'isNot') return { [path]: { $ne: value } };
  if (operator === 'in') return { [path]: { $in: value } };
  if (operator === 'notIn') return { [path]: { $nin: value } };
  if (operator === 'before') return { [path]: { $lt: startOfDay(String(value)) } };
  if (operator === 'after') return { [path]: { $gt: endOfDay(String(value)) } };
  if (operator === 'on') return { [path]: { $gte: startOfDay(String(value)), $lte: endOfDay(String(value)) } };
  if (operator === 'between' && field === 'priority') return { [path]: { $gte: (value as number[])[0], $lte: (value as number[])[1] } };
  if (operator === 'between') return { [path]: { $gte: startOfDay((value as string[])[0]), $lte: endOfDay((value as string[])[1]) } };
  if (operator === 'gt') return { [path]: { $gt: value } };
  if (operator === 'gte') return { [path]: { $gte: value } };
  if (operator === 'lt') return { [path]: { $lt: value } };
  if (operator === 'lte') return { [path]: { $lte: value } };
  throw new Error('Unsupported task filter operator');
}

export function taskFilterUsesCollaboration(node?: TaskFilterNode): boolean {
  if (!node) return false;
  if (node.kind === 'condition') return ['unread', 'openQuestions', 'hasGitDiff'].includes(node.field);
  return node.children.some(child => taskFilterUsesCollaboration(child));
}

export type TaskContentFilterField = Extract<TaskFilterField, 'hasPlanning' | 'hasAttachments' | 'hasConversations'>;
const taskContentFilterFields = new Set<TaskContentFilterField>(['hasPlanning', 'hasAttachments', 'hasConversations']);
export function taskFilterContentFields(node?: TaskFilterNode): TaskContentFilterField[] {
  const fields = new Set<TaskContentFilterField>();
  const visit = (current?: TaskFilterNode) => {
    if (!current) return;
    if (current.kind === 'group') { current.children.forEach(visit); return; }
    if (taskContentFilterFields.has(current.field as TaskContentFilterField)) fields.add(current.field as TaskContentFilterField);
  };
  visit(node);
  return [...fields];
}

export const quickFlagFilter = (flag?: string) => flag === 'unread' ? { '__workspace.unread': true }
  : flag === 'questions' ? { '__workspace.openQuestions': true }
    : flag === 'diff' ? { '__workspace.hasGitDiff': true } : undefined;

export const taskFilterSorts: Record<string, Record<string, 1 | -1>> = {
  updated: { updatedAt: -1, _id: 1 }, created: { createdAt: -1, _id: 1 }, name: { name: 1, _id: 1 },
  priority: { priority: 1, updatedAt: -1, _id: 1 }, status: { __workspaceStatusRank: 1, priority: 1, updatedAt: -1, _id: 1 }
};

