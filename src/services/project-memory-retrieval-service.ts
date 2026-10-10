import { ProjectMemory } from '../models.js';
import { logger } from '../logger.js';

export const PROJECT_MEMORY_RETRIEVAL_VERSION = 'mongo-text-context-v2';

export type ProjectMemorySearchOptions = {
  projectId: string;
  query: string;
  taskId?: string;
  featureId?: string;
  area?: string;
  limit: number;
  snippetChars: number;
};

function searchTerms(query: string) {
  const terms = query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(terms)].slice(0, 32).join(' ');
}

function snippet(content: string, query: string, maxChars: number) {
  const chars = Array.from(content);
  const normalized = content.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = searchTerms(query).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
  const offsets = terms.map(term => normalized.indexOf(term)).filter(offset => offset >= 0);
  const start = Math.max(0, (offsets.length ? Math.min(...offsets) : 0) - Math.floor(maxChars / 4));
  const prefix = start > 0 ? '…' : '';
  const contentBudget = Math.max(0, maxChars - Array.from(prefix).length);
  let end = Math.min(chars.length, start + contentBudget);
  const suffix = end < chars.length ? '…' : '';
  if (suffix) end = Math.max(start, end - Array.from(suffix).length);
  return `${prefix}${chars.slice(start, end).join('')}${suffix}`;
}

function potentialConflictGroups(items: any[]) {
  const parents = items.map((_item, index) => index);
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]!));
  const join = (left: number, right: number) => { parents[root(left)] = root(right); };
  for (let left = 0; left < items.length; left += 1) {
    const leftSources = new Set((items[left].sources ?? []).map((source: any) => `${source.kind}:${source.id}`));
    for (let right = left + 1; right < items.length; right += 1) {
      if (items[left].category !== items[right].category) continue;
      const sharesSource = (items[right].sources ?? []).some((source: any) => leftSources.has(`${source.kind}:${source.id}`));
      if (sharesSource) join(left, right);
    }
  }
  const groups = new Map<number, number[]>();
  items.forEach((_item, index) => {
    const group = root(index);
    groups.set(group, [...(groups.get(group) ?? []), index]);
  });
  return [...groups.values()].filter(indexes => indexes.length > 1).map(indexes => ({
    category: items[indexes[0]!].category,
    memoryIds: indexes.map(index => items[index]!._id),
    titles: indexes.map(index => items[index]!.title),
    sources: [...new Map(indexes.flatMap(index => items[index]!.sources ?? []).map((source: any) => [`${source.kind}:${source.id}`, source])).values()],
    note: 'Possible overlap only: shared category/source does not prove contradiction. Compare content and revisions.'
  }));
}

/** Text-ranked retrieval includes verified source titles and category; rank is not confidence or truth. */
export async function searchProjectMemories(options: ProjectMemorySearchOptions) {
  const startedAt = Date.now();
  const terms = searchTerms(options.query);
  if (!terms) {
    const result = {
    items: [], hasMore: false, potentialConflicts: [],
    notice: 'A consulta não contém termos pesquisáveis. Refine a consulta; nenhum resultado não prova que o conhecimento não exista.',
    interpretation: 'A ordenação é lexical e não representa probabilidade ou veracidade. Confira as fontes antes de usar uma memória como fato.'
    };
    logger.debug('project memory retrieval measured', {
      projectId: options.projectId, durationMs: Date.now() - startedAt, resultCount: 0,
      contextBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'), hasMore: false, potentialConflictCount: 0,
      hasTaskFilter: !!options.taskId, hasFeatureFilter: !!options.featureId, hasAreaFilter: !!options.area
    });
    return result;
  }

  const referenceMatches: Record<string, unknown>[] = [];
  if (options.taskId) referenceMatches.push({ sources: { $elemMatch: { kind: 'task', id: options.taskId } } });
  if (options.featureId) {
    referenceMatches.push({ sources: { $elemMatch: { kind: 'feature', id: options.featureId } } });
    referenceMatches.push({ sources: { $elemMatch: { featureId: options.featureId } } });
  }
  const filters: Record<string, unknown>[] = [
    { projectId: options.projectId, archived: false, status: 'active' },
    { $text: { $search: terms, $caseSensitive: false, $diacriticSensitive: false } }
  ];
  if (referenceMatches.length) filters.push({ $or: referenceMatches });
  if (options.area) filters.push({ sources: { $elemMatch: { kind: 'task', area: options.area } } });
  const filter = { $and: filters };
  const rows = await ProjectMemory.find(filter)
    .select({ _id: 1, title: 1, category: 1, content: 1, status: 1, revision: 1, sources: 1, score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, updatedAt: -1, _id: 1 })
    .limit(options.limit + 1)
    .lean();
  const hasMore = rows.length > options.limit;
  if (hasMore) rows.pop();
  const items = rows.map((memory: any, index: number) => ({
    memoryId: memory._id,
    title: Array.from(memory.title ?? '').slice(0, 255).join(''),
    category: memory.category,
    revision: memory.revision,
    status: 'active' as const,
    rank: index + 1,
    snippet: snippet(memory.content ?? '', options.query, options.snippetChars),
    sources: (memory.sources ?? []).slice(0, 20).map((source: any) => ({
      kind: source.kind, id: source.id, title: Array.from(source.title ?? '').slice(0, 240).join(''),
      ...(source.revision !== undefined ? { revision: source.revision } : {}),
      ...(source.area ? { area: Array.from(source.area).slice(0, 80).join('') } : {}),
      ...(source.featureId ? { featureId: source.featureId } : {})
    }))
  }));
  const potentialConflicts = potentialConflictGroups(rows);
  const result = {
    items, hasMore, potentialConflicts,
    notice: items.length
      ? 'Revise o conteúdo e as fontes. Rank expressa apenas a ordem da busca; não é probabilidade nem prova de verdade.'
      : 'Sem correspondências textuais ativas. Isso não prova que o conhecimento não exista; consulte as fontes ou refine a consulta.'
  };
  logger.debug('project memory retrieval measured', {
    projectId: options.projectId,
    durationMs: Date.now() - startedAt,
    resultCount: items.length,
    contextBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
    hasMore,
    potentialConflictCount: potentialConflicts.length,
    hasTaskFilter: !!options.taskId,
    hasFeatureFilter: !!options.featureId,
    hasAreaFilter: !!options.area
  });
  return result;
}
