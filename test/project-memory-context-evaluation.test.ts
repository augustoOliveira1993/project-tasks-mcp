import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, ProjectMemory } from '../src/db.js';
import { PROJECT_MEMORY_RETRIEVAL_VERSION, searchProjectMemories } from '../src/services/project-memory-retrieval-service.js';
import {
  PROJECT_MEMORY_EVALUATION_V2_VERSION,
  projectMemoryEvaluationV2Memories,
  projectMemoryEvaluationV2Queries
} from './fixtures/project-memory-evaluation.v2.js';

const LegacyProjectMemory = mongoose.models.ProjectMemoryLegacy ?? mongoose.model('ProjectMemoryLegacy', new mongoose.Schema({
  _id: String, projectId: String, title: String, category: String, content: String, status: String,
  archived: Boolean, revision: Number, sources: [{ kind: String, id: String, title: String, revision: Number, area: String }]
}, { collection: 'projectMemoryLegacyFixture', timestamps: true, versionKey: false }));
LegacyProjectMemory.schema.index({ projectId: 1, title: 'text', content: 'text' }, {
  name: 'legacy_project_memory_text', default_language: 'portuguese', weights: { title: 5, content: 1 }
});

let repl: MongoMemoryReplSet;

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = repl.getUri('project-memory-context-evaluation');
  const setup = await mongoose.createConnection(uri).asPromise();
  const collection = setup.db!.collection(ProjectMemory.collection.collectionName);
  await collection.createIndex({ migrationFixture: 1 }, { name: 'project_memory_migration_fixture' });
  await collection.insertOne({
    _id: 'legacy-memory-preserved', projectId: 'legacy-project', title: 'Memória antiga', category: 'decision',
    content: 'Conteúdo preservado durante a migração.', status: 'active', archived: false, revision: 1,
    sources: [], createdAt: new Date(), updatedAt: new Date()
  });
  await collection.createIndex(
    { projectId: 1, title: 'text', content: 'text' },
    { name: 'project_memory_text', default_language: 'portuguese', weights: { title: 5, content: 1 } }
  );
  await setup.close();
  await connect(uri);
  const indexes = await ProjectMemory.collection.listIndexes().toArray();
  const migratedIndex = indexes.find(index => index.name === 'project_memory_text');
  assert.deepEqual(migratedIndex?.weights, { title: 5, category: 2, 'sources.title': 2, content: 1 });
  assert.ok(indexes.some(index => index.name === 'project_memory_migration_fixture'));
  assert.equal(await ProjectMemory.countDocuments({ _id: 'legacy-memory-preserved', projectId: 'legacy-project' }), 1);
  await LegacyProjectMemory.init();
});

after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

function searchTerms(query: string) {
  const terms = query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(terms)].slice(0, 32).join(' ');
}

function legacySnippet(content: string, maxChars = 360) {
  const chars = Array.from(content);
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join('')}…` : content;
}

async function searchLegacy(projectId: string, query: string) {
  const terms = searchTerms(query);
  if (!terms) return { items: [], hasMore: false };
  const rows = await LegacyProjectMemory.find({
    projectId, archived: false, status: 'active', $text: { $search: terms, $caseSensitive: false, $diacriticSensitive: false }
  })
    .select({ _id: 1, title: 1, category: 1, content: 1, status: 1, revision: 1, sources: 1, score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, updatedAt: -1, _id: 1 })
    .limit(6)
    .lean();
  const hasMore = rows.length > 5;
  if (hasMore) rows.pop();
  return {
    items: rows.map((memory: any, index: number) => ({
      memoryId: memory._id, title: memory.title, category: memory.category, revision: memory.revision,
      status: memory.status, rank: index + 1, snippet: legacySnippet(memory.content),
      sources: (memory.sources ?? []).map((source: any) => ({ kind: source.kind, id: source.id, title: source.title, revision: source.revision }))
    })),
    hasMore
  };
}

function percentile(values: number[], quantile: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(quantile * ordered.length) - 1)] ?? 0;
}

function summarize(results: Array<{ queryId: string; kind: string; result: any; latencyMs: number }>, queryById: Map<string, any>, keyByMemoryId: Map<string, string>, sourceByKey: Map<string, string>) {
  const groups = new Map<string, typeof results>();
  for (const item of results) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  const metric = (items: typeof results) => {
    const expected = items.filter(item => queryById.get(item.queryId).expectedKeys.length > 0);
    let hits = 0;
    let reciprocalRanks = 0;
    let referencesCovered = 0;
    const misses: string[] = [];
    for (const item of expected) {
      const expectedKeys = new Set(queryById.get(item.queryId).expectedKeys);
      const rank = item.result.items.findIndex((row: any) => expectedKeys.has(keyByMemoryId.get(row.memoryId) ?? ''));
      if (rank >= 0) {
        hits += 1;
        reciprocalRanks += 1 / (rank + 1);
        const matched = item.result.items[rank];
        const expectedSource = sourceByKey.get(keyByMemoryId.get(matched.memoryId) ?? '');
        if (expectedSource && matched.sources.some((source: any) => source.kind === 'task' && source.id === expectedSource && source.revision === 1)) referencesCovered += 1;
      } else misses.push(item.queryId);
    }
    const negatives = items.filter(item => queryById.get(item.queryId).kind === 'no-match');
    const latency = items.map(item => item.latencyMs);
    const bytes = items.map(item => Buffer.byteLength(JSON.stringify(item.result), 'utf8'));
    return {
      queryCount: items.length,
      hitAt5: { hits, rate: expected.length ? hits / expected.length : 0 },
      mrr: expected.length ? Number((reciprocalRanks / expected.length).toFixed(4)) : 0,
      misses,
      expectedSourceRevisionCoverage: { covered: referencesCovered, expected: expected.length, rate: expected.length ? referencesCovered / expected.length : 0 },
      noMatchFalsePositiveRate: negatives.length ? negatives.filter(item => item.result.items.length > 0).length / negatives.length : null,
      outputBytes: { mean: Math.round(bytes.reduce((sum, value) => sum + value, 0) / Math.max(1, bytes.length)), max: Math.max(0, ...bytes) },
      latencyMs: { mean: Number((latency.reduce((sum, value) => sum + value, 0) / Math.max(1, latency.length)).toFixed(2)), p50: Number(percentile(latency, 0.5).toFixed(2)), p95: Number(percentile(latency, 0.95).toFixed(2)) }
    };
  };
  return {
    overall: metric(results),
    sourceAndParaphrase: metric(results.filter(item => item.kind === 'source' || item.kind === 'paraphrase')),
    byKind: Object.fromEntries([...groups].map(([kind, items]) => [kind, metric(items)]))
  };
}

test('context-aware retrieval beats the previous index on source queries without regressing direct queries', async () => {
  const projectId = randomUUID();
  const ids = new Map<string, { memoryId: string; sourceId: string }>();
  const records = projectMemoryEvaluationV2Memories.map(entry => {
    const memoryId = randomUUID();
    const sourceId = randomUUID();
    ids.set(entry.key, { memoryId, sourceId });
    return {
      _id: memoryId, projectId, version: 0, title: entry.title, category: entry.category,
      content: entry.content, status: 'active', archived: false, revision: 1, author: 'evaluation-fixture',
      sources: [{ kind: 'task', id: sourceId, title: entry.sourceTitle, revision: 1, area: entry.area }]
    };
  });
  await ProjectMemory.insertMany(records);
  await LegacyProjectMemory.insertMany(records);

  const keyByMemoryId = new Map([...ids].map(([key, value]) => [value.memoryId, key]));
  const sourceByKey = new Map([...ids].map(([key, value]) => [key, value.sourceId]));
  const queryById = new Map(projectMemoryEvaluationV2Queries.map(query => [query.id, query]));
  const legacyResults = [];
  const contextResults = [];
  for (const query of projectMemoryEvaluationV2Queries) {
    const legacyStarted = performance.now();
    const legacyResult = await searchLegacy(projectId, query.query);
    legacyResults.push({ queryId: query.id, kind: query.kind, result: legacyResult, latencyMs: performance.now() - legacyStarted });

    const contextStarted = performance.now();
    const contextResult = await searchProjectMemories({ projectId, query: query.query, limit: 5, snippetChars: 360 });
    contextResults.push({ queryId: query.id, kind: query.kind, result: contextResult, latencyMs: performance.now() - contextStarted });
    for (const result of contextResult.items) {
      assert.ok(result.rank >= 1 && result.rank <= 5);
      assert.equal(result.status, 'active');
      assert.ok(result.sources.length > 0);
      assert.ok(result.sources.some((source: { kind?: string; revision?: number }) => source.kind === 'task' && source.revision === 1));
    }
  }

  const legacy = summarize(legacyResults, queryById, keyByMemoryId, sourceByKey);
  const contextAware = summarize(contextResults, queryById, keyByMemoryId, sourceByKey);
  const report = {
    datasetVersion: PROJECT_MEMORY_EVALUATION_V2_VERSION,
    baseline: { retrievalVersion: 'mongo-text-v1', fields: 'title, content', ...legacy },
    candidate: { retrievalVersion: PROJECT_MEMORY_RETRIEVAL_VERSION, fields: 'title, category, content, verified source titles', ...contextAware },
    queryKinds: Object.fromEntries([...new Set(projectMemoryEvaluationV2Queries.map(query => query.kind))].map(kind => [kind, projectMemoryEvaluationV2Queries.filter(query => query.kind === kind).length])),
    answerQualityEvaluated: false,
    externalProvider: 'none'
  };
  console.log(`PROJECT_MEMORY_CONTEXT_EVALUATION ${JSON.stringify(report)}`);

  assert.equal(projectMemoryEvaluationV2Queries.length, 50);
  assert.ok(contextAware.sourceAndParaphrase.mrr > legacy.sourceAndParaphrase.mrr, 'source-context retrieval should improve the combined source/paraphrase subset');
  assert.ok(contextAware.overall.hitAt5.rate >= legacy.overall.hitAt5.rate - 0.05, 'overall Hit@5 regressed by more than five percentage points');
  assert.equal(contextAware.byKind['no-match'].noMatchFalsePositiveRate, 0);
  assert.equal(contextAware.overall.expectedSourceRevisionCoverage.rate, contextAware.overall.hitAt5.rate);
  assert.ok(contextResults.every(item => Buffer.byteLength(JSON.stringify(item.result), 'utf8') <= 128 * 1024));
});
