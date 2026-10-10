import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Execution, MarkdownDocument, MarkdownRevision, ProjectMemory, ProjectMemoryProposal, Task, TaskDiff } from '../src/db.js';
import { Service, authenticate, bootstrap, type Actor } from '../src/service.js';

let repl: MongoMemoryReplSet;
let service: Service;
let human: Actor;
let owner: Actor;
let outsider: Actor;
const op = () => randomUUID();

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connect(repl.getUri('project-memory'));
  service = new Service();
  const humanToken = await bootstrap('memory-owner');
  human = await authenticate(humanToken, 'human');
  async function issue(userId: string) {
    const token = randomBytes(32).toString('hex');
    await service.admin(human, { action: 'issue', operationId: op(), userId, scope: 'agent', token });
    return authenticate(token, 'agent');
  }
  owner = await issue('memory-owner');
  outsider = await issue('memory-outsider');
});

after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

async function createProject(name: string) {
  const repositoryId = op();
  const project = await service.call(owner, 'create_project', { operationId: op(), data: {
    name, description: 'Memory test', instructions: 'Focused test fixture',
    repositories: [{ id: repositoryId, name: 'repo', url: 'https://example.com/repo.git', instructions: '' }]
  } });
  const feature = await service.call(owner, 'create_feature', { operationId: op(), projectId: project._id, data: {
    name: 'Feature source', objective: 'Test provenance', context: 'Fixture', acceptance: ['Source is addressable']
  } });
  const task = await service.call(owner, 'create_task', { operationId: op(), projectId: project._id, data: {
    name: 'Task source', instructions: 'A task that grounds memory', acceptance: ['Exists'], priority: 1,
    area: 'backend', repositoryId, featureId: feature._id, dependencies: []
  } });
  return { project, feature, task };
}

async function completeTask(projectId: string, taskId: string) {
  const executionId = op();
  const now = new Date();
  await Execution.create([{ _id: executionId, projectId, taskId, status: 'approve', startedAt: now, endedAt: now }]);
  await Task.updateOne({ _id: taskId, projectId }, { $set: { status: 'concluida', executionId }, $inc: { version: 1 } });
  return executionId;
}

test('memory proposals require completed evidence and human review, preserve provenance, and reject stale/conflicting versions', async () => {
  const first = await createProject('Memory proposal project');
  const other = await createProject('Foreign memory proposal project');
  const executionId = await completeTask(first.project._id, first.task._id);
  const foreignExecutionId = await completeTask(other.project._id, other.task._id);
  const diffId = op();
  await TaskDiff.create([{ _id: diffId, projectId: first.project._id, taskId: first.task._id, repositoryId: first.task.repositoryId,
    baseCommit: 'a'.repeat(40), commit: 'b'.repeat(40), branch: 'codex/memory', files: ['src/example.ts'], truncated: false }]);
  const foreignDiffId = op();
  await TaskDiff.create([{ _id: foreignDiffId, projectId: other.project._id, taskId: other.task._id, repositoryId: other.task.repositoryId,
    baseCommit: 'c'.repeat(40), commit: 'd'.repeat(40), branch: 'codex/foreign', files: ['src/foreign.ts'], truncated: false }]);

  const createArgs = {
    operationId: op(), projectId: first.project._id, taskId: first.task._id, executionId,
    data: { title: 'Approved memory proposal', category: 'convention', content: 'Keep changes scoped and cite verified sources.', sources: [{ kind: 'diff', id: diffId }] }
  };
  const proposal = await service.call(owner, 'create_project_memory_proposal', createArgs);
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.sources.length, 3);
  assert.deepEqual(proposal.sources.map((source: any) => source.kind), ['task', 'execution', 'diff']);
  assert.equal((await service.call(owner, 'create_project_memory_proposal', createArgs))._id, proposal._id);
  assert.equal((await service.call(owner, 'list_project_memory_proposals', { projectId: first.project._id, status: 'pending', limit: 10 })).items.length, 1);
  assert.equal((await service.call(owner, 'get_project_memory_proposal', { projectId: first.project._id, proposalId: proposal._id })).content, createArgs.data.content);
  assert.equal((await service.call(owner, 'list_project_memories', { projectId: first.project._id, limit: 10 })).items.length, 0);
  await assert.rejects(service.call(outsider, 'approve_project_memory_proposal', {
    operationId: op(), projectId: first.project._id, proposalId: proposal._id, version: proposal.version
  }), /human reviewer required/i);
  await assert.rejects(service.call(owner, 'create_project_memory_proposal', {
    ...createArgs, operationId: op(), data: { ...createArgs.data, content: 'API_KEY=do-not-store' }
  }), /appears to contain a secret/i);
  await assert.rejects(service.call(owner, 'create_project_memory_proposal', {
    ...createArgs, operationId: op(), data: { ...createArgs.data, sources: [{ kind: 'diff', id: foreignDiffId }] }
  }), /must belong to its completed task/i);
  await assert.rejects(service.call(owner, 'create_project_memory_proposal', {
    ...createArgs, operationId: op(), data: { ...createArgs.data, sources: [{ kind: 'document', id: op(), revision: 1 }] }
  }), /source document not found/i);
  await assert.rejects(service.call(owner, 'create_project_memory_proposal', {
    ...createArgs, operationId: op(), taskId: other.task._id, executionId: foreignExecutionId
  }), /not found|same project|completed task/i);

  const approveArgs = { operationId: op(), projectId: first.project._id, proposalId: proposal._id, version: proposal.version };
  const approved = await service.call(human, 'approve_project_memory_proposal', approveArgs);
  assert.equal(approved.proposal.status, 'approved');
  assert.equal(approved.proposal.memoryId, approved.memory._id);
  assert.equal(approved.memory.revision, 1);
  assert.deepEqual(approved.memory.sources.map((source: any) => source.id), proposal.sources.map((source: any) => source.id));
  const approvedRetry = await service.call(human, 'approve_project_memory_proposal', approveArgs);
  assert.equal(approvedRetry.memory._id, approved.memory._id);
  assert.equal(await ProjectMemory.countDocuments({ projectId: first.project._id }), 1);
  assert.equal(await ProjectMemoryProposal.countDocuments({ projectId: first.project._id, status: 'approved' }), 1);

  const docId = op();
  await MarkdownDocument.create([{ _id: docId, projectId: first.project._id, targetKind: 'task', targetId: first.task._id, name: 'Review.md', revision: 1, summary: 'Evidence', size: 4, sha256: '0'.repeat(64) }]);
  await MarkdownRevision.create([{ _id: op(), projectId: first.project._id, documentId: docId, revision: 1, summary: 'Evidence', content: 'Fact', size: 4, sha256: '0'.repeat(64), createdAt: new Date() }]);
  const rejectedProposal = await service.call(owner, 'create_project_memory_proposal', {
    ...createArgs, operationId: op(), data: { title: 'Rejected memory proposal', category: 'decision', content: 'Discard this unsupported idea.', sources: [{ kind: 'document', id: docId, revision: 1 }] }
  });
  const rejected = await service.call(human, 'reject_project_memory_proposal', {
    operationId: op(), projectId: first.project._id, proposalId: rejectedProposal._id, version: rejectedProposal.version, reason: 'A pessoa revisora não encontrou confirmação suficiente.'
  });
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.rejectionReason, /confirmação suficiente/i);
  const proposalPage = await service.call(owner, 'list_project_memory_proposals', { projectId: first.project._id, limit: 1 });
  assert.equal(proposalPage.items.length, 1);
  assert.ok(proposalPage.next);
  const proposalPage2 = await service.call(owner, 'list_project_memory_proposals', { projectId: first.project._id, after: proposalPage.next, limit: 1 });
  assert.equal(proposalPage2.items.length, 1);
  await assert.rejects(service.call(human, 'reject_project_memory_proposal', {
    operationId: op(), projectId: first.project._id, proposalId: rejectedProposal._id, version: rejectedProposal.version, reason: 'Retry stale'
  }), /no longer pending|version conflict/i);

  const conflict = await createProject('Memory conflict proposal project');
  const conflictExecution = await completeTask(conflict.project._id, conflict.task._id);
  const existing = await service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: conflict.project._id,
    data: { title: 'Existing decision', category: 'decision', content: 'Earlier verified decision.', sources: [{ kind: 'task', id: conflict.task._id }] }
  });
  const conflictProposal = await service.call(owner, 'create_project_memory_proposal', {
    operationId: op(), projectId: conflict.project._id, taskId: conflict.task._id, executionId: conflictExecution,
    data: { title: 'Existing decision', category: 'decision', content: 'Newer proposal with stronger evidence.', sources: [] }
  });
  await assert.rejects(service.call(human, 'approve_project_memory_proposal', {
    operationId: op(), projectId: conflict.project._id, proposalId: conflictProposal._id, version: conflictProposal.version
  }), /potential active-memory conflict/i);
  const explicitTarget = await service.call(human, 'retarget_project_memory_proposal', {
    operationId: op(), projectId: conflict.project._id, proposalId: conflictProposal._id, version: conflictProposal.version,
    targetMemoryId: existing._id, expectedMemoryVersion: existing.version
  });
  await service.call(owner, 'update_project_memory', {
    operationId: op(), projectId: conflict.project._id, memoryId: existing._id, version: existing.version,
    data: { title: existing.title, category: existing.category, content: 'Concurrent newer memory revision.', sources: [{ kind: 'task', id: conflict.task._id }] }
  });
  await assert.rejects(service.call(human, 'approve_project_memory_proposal', {
    operationId: op(), projectId: conflict.project._id, proposalId: conflictProposal._id, version: explicitTarget.version
  }), /version conflict/i);
  const retargeted = await service.call(human, 'retarget_project_memory_proposal', {
    operationId: op(), projectId: conflict.project._id, proposalId: conflictProposal._id, version: explicitTarget.version,
    targetMemoryId: existing._id, expectedMemoryVersion: existing.version + 1
  });
  const updated = await service.call(human, 'approve_project_memory_proposal', {
    operationId: op(), projectId: conflict.project._id, proposalId: conflictProposal._id, version: retargeted.version
  });
  assert.equal(updated.memory._id, existing._id);
  assert.equal(updated.memory.revision, 3);
  assert.equal((await service.call(owner, 'get_project_memory', { projectId: conflict.project._id, memoryId: existing._id, revision: 1 })).content, 'Earlier verified decision.');
});

test('project memories validate same-project sources, preserve revisions, paginate, and enforce access', async () => {
  const first = await createProject('Memory owner project');
  const other = await createProject('Other project');
  const source = { kind: 'task', id: first.task._id, revision: first.task.version };
  const createArgs = {
    operationId: op(), projectId: first.project._id,
    data: { title: 'Frontend convention', category: 'convention', content: 'Keep Markdown concise and cite the source.', sources: [source] }
  };
  const memory = await service.call(owner, 'create_project_memory', createArgs);
  const retry = await service.call(owner, 'create_project_memory', createArgs);
  assert.equal(retry._id, memory._id);
  assert.equal(memory.revision, 1);
  assert.equal(memory.sources[0].title, first.task.name);
  assert.equal(memory.sources[0].revision, first.task.version);
  assert.equal(memory.sources[0].area, first.task.area);
  assert.equal(memory.sources[0].featureId, first.feature._id);

  const foreignMemory = await service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: other.project._id,
    data: { title: 'Quartz foreign memory', category: 'decision', content: 'Unique cross-project isolation marker.', sources: [{ kind: 'task', id: other.task._id }] }
  });
  const projectScopedSearch = await service.call(owner, 'search_project_memories', {
    projectId: first.project._id, query: 'quartz foreign isolation marker', limit: 10
  });
  assert.ok(projectScopedSearch.items.every((item: any) => item.memoryId !== foreignMemory._id));

  await assert.rejects(service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: first.project._id,
    data: { title: 'Cross-project source', category: 'decision', content: 'Must be rejected.', sources: [{ kind: 'task', id: other.task._id }] }
  }), /source task not found/i);
  await assert.rejects(service.call(outsider, 'list_project_memories', { projectId: first.project._id, limit: 10 }), /Project access denied/i);

  const second = await service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: first.project._id,
    data: { title: 'Architecture note', category: 'architecture', content: 'Project architecture follows a versioned model.', sources: [{ kind: 'feature', id: first.feature._id }] }
  });

  const concurrent = await Promise.allSettled([
    service.call(owner, 'update_project_memory', {
      operationId: op(), projectId: first.project._id, memoryId: second._id, version: second.version,
      data: { title: second.title, category: second.category, content: 'Concurrent revision A.', sources: [{ kind: 'feature', id: first.feature._id }] }
    }),
    service.call(owner, 'update_project_memory', {
      operationId: op(), projectId: first.project._id, memoryId: second._id, version: second.version,
      data: { title: second.title, category: second.category, content: 'Concurrent revision B.', sources: [{ kind: 'feature', id: first.feature._id }] }
    })
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
  assert.match(String((concurrent.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /version conflict/i);
  const concurrentlyUpdated = await service.call(owner, 'get_project_memory', { projectId: first.project._id, memoryId: second._id });
  assert.ok(['Concurrent revision A.', 'Concurrent revision B.'].includes(concurrentlyUpdated.content));

  const overlap = await service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: first.project._id,
    data: { title: 'Architecture counterpoint', category: 'architecture', content: 'An alternative architecture note.', sources: [{ kind: 'feature', id: first.feature._id }] }
  });
  const longMemory = await service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: first.project._id,
    data: { title: 'Source details', category: 'convention', content: 'Markdown source details. '.repeat(80), sources: [source] }
  });
  const ranked = await service.call(owner, 'search_project_memories', {
    projectId: first.project._id, query: 'architecture note', featureId: first.feature._id, limit: 10
  });
  assert.equal(ranked.items[0].memoryId, second._id);
  assert.ok(ranked.items.some((item: any) => item.memoryId === second._id));
  assert.ok(ranked.items.some((item: any) => item.memoryId === overlap._id));
  assert.ok(ranked.items.every((item: any) => item.status === 'active' && item.revision > 0 && item.sources.length > 0 && !('content' in item)));
  assert.ok(ranked.potentialConflicts.length > 0);
  assert.match(ranked.notice, /não é probabilidade/i);
  const areaSearch = await service.call(owner, 'search_project_memories', {
    projectId: first.project._id, query: 'markdown source', taskId: first.task._id, area: first.task.area, limit: 10
  });
  assert.ok(areaSearch.items.some((item: any) => item.memoryId === memory._id));
  assert.ok(areaSearch.items.some((item: any) => item.memoryId === longMemory._id));
  assert.ok(areaSearch.items.every((item: any) => item.snippet.length <= 480 && !('content' in item)));
  await service.call(owner, 'update_project_memory', {
    operationId: op(), projectId: first.project._id, memoryId: overlap._id, version: overlap.version,
    data: { title: overlap.title, category: overlap.category, content: overlap.content, sources: [{ kind: 'feature', id: first.feature._id }], status: 'superseded' }
  });
  const activeOnly = await service.call(owner, 'search_project_memories', {
    projectId: first.project._id, query: 'architecture note', featureId: first.feature._id, limit: 10
  });
  assert.ok(activeOnly.items.every((item: any) => item.memoryId !== overlap._id));
  assert.match(activeOnly.notice, /não é probabilidade/i);
  const noMatch = await service.call(owner, 'search_project_memories', {
    projectId: first.project._id, query: 'unfindable_zebra_knowledge', limit: 5
  });
  assert.equal(noMatch.items.length, 0);
  assert.match(noMatch.notice, /não prova que o conhecimento não exista/i);
  for (let index = 0; index < 3; index += 1) await service.call(owner, 'create_project_memory', {
    operationId: op(), projectId: first.project._id,
    data: { title: `Source convention ${index}`, category: 'convention', content: `Source convention detail ${index}.`, sources: [source] }
  });
  await assert.rejects(service.call(owner, 'search_project_memories', {
    projectId: first.project._id, query: 'architecture', limit: 21
  }));
  const taskContext = await service.call(owner, 'get_task_context', { projectId: first.project._id, taskId: first.task._id });
  assert.ok(taskContext.memories.items.length > 0);
  assert.ok(taskContext.memories.items.every((item: any) => item.snippet.length <= 360));
  assert.equal(taskContext.memories.hasMore, true);
  assert.ok(taskContext.contextMeta.truncatedFields.includes('memories'));
  assert.equal(taskContext.memories.searchTool, 'search_project_memories');
  assert.equal(taskContext.memories.loadFullContentTool, 'get_project_memory');
  assert.ok(taskContext.contextMeta.payloadBytes <= taskContext.contextMeta.maxBytes);

  const firstPage = await service.call(owner, 'list_project_memories', { projectId: first.project._id, limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.equal('content' in firstPage.items[0], false);
  assert.ok(firstPage.next);
  const secondPage = await service.call(owner, 'list_project_memories', { projectId: first.project._id, after: firstPage.next, limit: 1 });
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(secondPage.items[0]._id, firstPage.items[0]._id);

  const search = await service.call(owner, 'list_project_memories', { projectId: first.project._id, search: 'architecture', limit: 10 });
  assert.ok(search.items.some((item: any) => item._id === second._id));
  const revisionOne = await service.call(owner, 'get_project_memory', { projectId: first.project._id, memoryId: memory._id, revision: 1 });
  assert.equal(revisionOne.content, 'Keep Markdown concise and cite the source.');

  const updateArgs = {
    operationId: op(), projectId: first.project._id, memoryId: memory._id, version: memory.version,
    data: { title: memory.title, category: memory.category, content: 'Keep Markdown concise, cite sources, and preserve provenance.', sources: [source] }
  };
  const updated = await service.call(owner, 'update_project_memory', updateArgs);
  assert.equal(updated.revision, 2);
  assert.equal((await service.call(owner, 'get_project_memory', { projectId: first.project._id, memoryId: memory._id })).content, updateArgs.data.content);
  assert.equal((await service.call(owner, 'update_project_memory', updateArgs)).revision, 2);
  await assert.rejects(service.call(owner, 'update_project_memory', {
    ...updateArgs, operationId: op(), data: { ...updateArgs.data, content: 'Stale overwrite' }
  }), /version conflict/i);
  await assert.rejects(service.call(owner, 'create_project_memory', {
    ...createArgs, data: { ...createArgs.data, content: 'A different retry with the same operation ID' }
  }), /Operation ID reused/i);

  const archived = await service.call(owner, 'archive_project_memory', {
    operationId: op(), projectId: first.project._id, memoryId: memory._id, version: updated.version
  });
  assert.equal(archived.archived, true);
  assert.equal(archived.revision, 3);
  const remaining = await service.call(owner, 'list_project_memories', { projectId: first.project._id, limit: 10 });
  assert.ok(remaining.items.every((item: any) => item._id !== memory._id));
});
