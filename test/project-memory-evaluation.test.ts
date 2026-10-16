import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, ProjectMemory } from '../src/db.js';
import { PROJECT_MEMORY_RETRIEVAL_VERSION, searchProjectMemories } from '../src/services/project-memory-retrieval-service.js';
import { projectMemoryEvaluation, PROJECT_MEMORY_EVALUATION_VERSION } from './fixtures/project-memory-evaluation.v1.js';

let repl: MongoMemoryReplSet;

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('project-memory-evaluation'));
});

after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

function percentile(values: number[], quantile: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(quantile * ordered.length) - 1)] ?? 0;
}

test('versioned project memory retrieval benchmark reports Hit@5, reference coverage, context bytes, and latency', async () => {
  const projectId = randomUUID();
  const ids = new Map<string, { memoryId: string; sourceId: string }>();
  const records = projectMemoryEvaluation.map(entry => {
    const memoryId = randomUUID();
    const sourceId = randomUUID();
    ids.set(entry.key, { memoryId, sourceId });
    return {
      _id: memoryId, projectId, version: 0, title: entry.title, category: entry.category,
      content: entry.content, status: 'active', archived: false, revision: 1, author: 'evaluation-fixture',
      sources: [{ kind: 'task', id: sourceId, title: `Synthetic source for ${entry.key}`, revision: 1, area: entry.area }]
    };
  });
  await ProjectMemory.insertMany(records);

  const latencies: number[] = [];
  const contextSizes: number[] = [];
  const retrievedCounts: number[] = [];
  const misses: string[] = [];
  let coveredExpectedReferences = 0;
  let returnedReferenceCount = 0;
  let totalReturnedCount = 0;
  for (const query of projectMemoryEvaluation) {
    const started = performance.now();
    const result = await searchProjectMemories({ projectId, query: query.query, limit: 5, snippetChars: 360 });
    latencies.push(performance.now() - started);
    contextSizes.push(Buffer.byteLength(JSON.stringify(result), 'utf8'));
    retrievedCounts.push(result.items.length);
    const expected = ids.get(query.key)!;
    const matched = result.items.find(item => item.memoryId === expected.memoryId);
    if (matched) {
      const hasExpectedSource = matched.sources.some(source => source.kind === 'task' && source.id === expected.sourceId && source.revision === 1);
      if (hasExpectedSource) coveredExpectedReferences += 1;
      else misses.push(`${query.key}:relevant-result-missing-expected-source`);
    } else misses.push(query.key);
    for (const item of result.items) {
      totalReturnedCount += 1;
      if (item.revision > 0 && item.sources.length > 0 && item.sources.every(source => typeof source.id === 'string' && typeof source.kind === 'string')) returnedReferenceCount += 1;
      assert.ok(item.rank >= 1 && item.rank <= 5);
      assert.equal(item.status, 'active');
      assert.ok(item.sources.length > 0);
    }
  }

  const queryCount = projectMemoryEvaluation.length;
  const hitAt5 = (queryCount - misses.length) / queryCount;
  const report = {
    datasetVersion: PROJECT_MEMORY_EVALUATION_VERSION,
    retrievalVersion: PROJECT_MEMORY_RETRIEVAL_VERSION,
    ranking: 'MongoDB textScore descending; title weight 5, category and verified source-title weights 2, content weight 1; active memories only',
    queryCount,
    areas: [...new Set(projectMemoryEvaluation.map(query => query.area))],
    limit: 5,
    snippetChars: 360,
    hitAt5: { hits: queryCount - misses.length, rate: hitAt5 },
    expectedReferenceCoverage: { covered: coveredExpectedReferences, expected: queryCount, rate: coveredExpectedReferences / queryCount },
    returnedReferenceCoverage: { withSourceAndRevision: returnedReferenceCount, results: totalReturnedCount, rate: totalReturnedCount ? returnedReferenceCount / totalReturnedCount : 0 },
    contextBytes: {
      mean: Math.round(contextSizes.reduce((sum, value) => sum + value, 0) / contextSizes.length),
      max: Math.max(...contextSizes), budget: 128 * 1024
    },
    latencyMs: {
      mean: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
      p50: Number(percentile(latencies, 0.5).toFixed(2)), p95: Number(percentile(latencies, 0.95).toFixed(2))
    },
    resultsMean: Number((retrievedCounts.reduce((sum, value) => sum + value, 0) / retrievedCounts.length).toFixed(2)),
    misses,
    answerQualityEvaluated: false,
    externalProvider: 'none'
  };
  console.log(`PROJECT_MEMORY_EVALUATION ${JSON.stringify(report)}`);
  assert.ok(hitAt5 >= 0.8, `Hit@5 below 80%: ${JSON.stringify(misses)}`);
  assert.equal(coveredExpectedReferences, queryCount, `Some expected source references were not returned: ${JSON.stringify(misses)}`);
  assert.ok(contextSizes.every(size => size <= report.contextBytes.budget));
  assert.equal(returnedReferenceCount, totalReturnedCount);
});
