import type { ClientSession } from 'mongoose';
import { Task, TaskDependency } from '../models.js';
import { logger } from '../logger.js';

type Assert = (value: unknown, message: string, status?: number) => asserts value;

function sessionOptions(session?: ClientSession) {
  return session ? { session } : {};
}

function edgeOperations(projectId: string, taskId: string, dependencyIds: string[]) {
  const ids = [...new Set(dependencyIds)];
  return [
    { deleteMany: { filter: { projectId, taskId, dependencyId: { $nin: ids } } } },
    ...ids.map(dependencyId => ({
      updateOne: {
        filter: { projectId, taskId, dependencyId },
        update: { $setOnInsert: { _id: `${projectId}:${taskId}:${dependencyId}`, projectId, taskId, dependencyId } },
        upsert: true
      }
    }))
  ];
}

/** Keeps the normalized edge collection in sync while embedded dependencies remain the compatibility source. */
export async function synchronizeTaskDependencyEdges(projectId: string, taskId: string, dependencyIds: string[], session?: ClientSession) {
  await TaskDependency.bulkWrite(edgeOperations(projectId, taskId, dependencyIds) as any, { ...sessionOptions(session), ordered: true });
}

/** Validates only dependency ancestors reachable from the proposed edges and lazily backfills those edges. */
export async function validateTaskDependencyGraph(projectId: string, taskId: string, dependencyIds: string[], session: ClientSession, assert: Assert) {
  const startedAt = Date.now();
  const directIds = [...new Set<string>(dependencyIds ?? [])];
  assert(directIds.length === (dependencyIds ?? []).length, 'Duplicate dependency');
  assert(!directIds.includes(taskId), 'Task cannot depend on itself');

  const direct = directIds.length ? await Task.find({
    _id: { $in: directIds }, projectId, archived: false, status: { $ne: 'cancelada' }
  }).select('_id').session(session).lean() : [];
  assert(direct.length === directIds.length, 'Dependency is inactive, missing, or belongs to a different project');
  await synchronizeTaskDependencyEdges(projectId, taskId, directIds, session);

  const seen = new Set<string>();
  const queue = [...directIds];
  const enqueued = new Set(directIds);
  let queueIndex = 0;
  let visitedCount = 0;
  let edgeCount = 0;
  while (queueIndex < queue.length) {
    const batch: string[] = [];
    while (queueIndex < queue.length && batch.length < 500) {
      const id = queue[queueIndex++];
      if (!seen.has(id)) batch.push(id);
    }
    if (!batch.length) break;
    for (const id of batch) seen.add(id);

    const nodes = await Task.find({ _id: { $in: batch }, projectId }).select('_id dependencies').session(session).lean();
    visitedCount += nodes.length;
    assert(visitedCount <= 25000, 'Dependency graph is too large to validate in one operation', 409);
    if (nodes.length) {
      const writes = nodes.flatMap(node => edgeOperations(projectId, node._id!, node.dependencies ?? []));
      await TaskDependency.bulkWrite(writes as any, { session, ordered: true });
    }

    const edges = await TaskDependency.find({ projectId, taskId: { $in: batch } }).select('dependencyId').session(session).lean();
    edgeCount += edges.length;
    const next: string[] = [];
    for (const edge of edges) {
      assert(edge.dependencyId !== taskId, 'Dependency cycle detected');
      if (!seen.has(edge.dependencyId!) && !enqueued.has(edge.dependencyId!)) {
        next.push(edge.dependencyId!);
        enqueued.add(edge.dependencyId!);
      }
    }
    queue.push(...next);
  }

  logger.debug('dependency graph validation completed', {
    projectId, taskId, visitedNodes: visitedCount, traversedEdges: edgeCount, durationMs: Date.now() - startedAt
  });
}

/** Idempotently reconciles all legacy Task.dependencies arrays into indexed edge documents. */
export async function backfillTaskDependencyEdges(batchSize = 250) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Invalid dependency backfill batch size');
  let tasksProcessed = 0;
  let edgesProcessed = 0;
  let operations: any[] = [];
  const flush = async () => {
    if (!operations.length) return;
    await TaskDependency.bulkWrite(operations, { ordered: true });
    operations = [];
  };
  const cursor = Task.find({}).select('_id projectId dependencies').lean().cursor({ batchSize });
  for await (const task of cursor) {
    const dependencies = [...new Set(task.dependencies ?? [])];
    operations.push(...edgeOperations(task.projectId!, task._id!, dependencies));
    tasksProcessed += 1;
    edgesProcessed += dependencies.length;
    if (tasksProcessed % batchSize === 0) await flush();
  }
  await flush();
  const edgeCount = await TaskDependency.countDocuments({});
  return { tasksProcessed, edgesProcessed, edgeCount, edgeCountMatches: edgesProcessed === edgeCount };
}
