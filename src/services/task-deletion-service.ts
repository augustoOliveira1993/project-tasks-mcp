import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import {
  AutomationJob,
  ActionProposal,
  Conversation,
  DeliveryEvent,
  Event,
  Execution,
  MarkdownDocument,
  MarkdownRevision,
  Operation,
  Project,
  Task,
  TaskDependency,
  TaskDiff,
  TaskMessage,
  TaskRead
} from '../db.js';

type AuditActor = { id: string; userId: string };

export class TaskDeletionConflict extends Error {
  readonly status = 409;
}

const countRemoved = (result: { deletedCount?: number }) => result.deletedCount ?? 0;

/** Deletes one task and its owned records inside the caller's transaction. */
export async function deleteTaskCascade(projectId: string, taskId: string, actor: AuditActor, session: ClientSession) {
  const project = await Project.findOneAndUpdate(
    { _id: projectId },
    { $inc: { fence: 1 } },
    { returnDocument: 'after', session }
  ).lean();
  if (!project) return null;

  const task = await Task.findOne({ _id: taskId, projectId }).select('_id status executionId').session(session).lean();
  if (!task) return null;

  const activeJobs = await AutomationJob.exists({
    projectId,
    taskId,
    $or: [{ status: { $in: ['reserved', 'running', 'waiting_human'] } }, { turnInFlight: true }]
  }).session(session);
  const activeExecution = await Execution.exists({
    status: 'em_execucao',
    $or: [{ projectId, taskId }, ...(task.executionId ? [{ _id: task.executionId }] : [])]
  }).session(session);
  if (task.status === 'em_execucao' || activeExecution || activeJobs) {
    throw new TaskDeletionConflict('Task has an active execution or runner');
  }

  const dependents = await Task.find({ projectId, _id: { $ne: taskId }, dependencies: taskId }).select('_id').session(session).lean();
  const dependentIds = dependents.map(dependent => dependent._id);
  if (dependentIds.length) {
    const activeDependentJobs = await AutomationJob.exists({
      projectId,
      taskId: { $in: dependentIds },
      $or: [{ status: { $in: ['reserved', 'running', 'waiting_human'] } }, { turnInFlight: true }]
    }).session(session);
    const activeDependentExecution = await Execution.exists({ projectId, taskId: { $in: dependentIds }, status: 'em_execucao' }).session(session);
    const executingDependent = await Task.exists({ _id: { $in: dependentIds }, status: 'em_execucao' }).session(session);
    if (activeDependentJobs || activeDependentExecution || executingDependent) {
      throw new TaskDeletionConflict('Task has an active dependent execution or runner');
    }
  }

  const [messages, documents, diffs, jobs, executions] = await Promise.all([
    TaskMessage.find({ projectId, $or: [{ taskId }, { relatedTaskId: taskId }] }).select('_id operationId credentialId').session(session).lean(),
    MarkdownDocument.find({ projectId, targetKind: 'task', targetId: taskId }).select('_id').session(session).lean(),
    TaskDiff.find({ projectId, taskId }).select('_id').session(session).lean(),
    AutomationJob.find({ projectId, taskId }).select('_id').session(session).lean(),
    Execution.find({ projectId, taskId }).select('_id').session(session).lean()
  ]);
  const messageIds = messages.map(message => message._id);
  const documentIds = documents.map(document => document._id);
  const diffIds = diffs.map(diff => diff._id);
  const jobIds = jobs.map(job => job._id);
  const executionIds = [...new Set([...executions.map(execution => execution._id), ...(task.executionId ? [task.executionId] : [])])];
  const taskEventFilter = {
    projectId,
    $or: [
      { entityId: taskId },
      { entityId: { $in: [...documentIds, ...diffIds, ...jobIds, ...messageIds, ...executionIds] } },
      { 'data.taskId': taskId },
      { 'data.relatedTaskId': taskId },
      { 'data.targetId': taskId },
      { 'data.task._id': taskId }
    ]
  };
  const taskEvents = await Event.find(taskEventFilter).select('_id operationId credentialId data').session(session).lean();
  const eventIds = taskEvents.map(event => event._id);
  const relatedEntityIds = [...new Set([taskId, ...documentIds, ...diffIds, ...jobIds, ...messageIds, ...executionIds, ...eventIds])];
  const operationKeys = new Set<string>();
  for (const event of taskEvents) {
    const operationId = event.data?.operationId;
    if (event.credentialId && typeof operationId === 'string') operationKeys.add(`${event.credentialId}:${operationId}`);
  }
  for (const message of messages) {
    if (message.credentialId && message.operationId) operationKeys.add(`${message.credentialId}:${message.operationId}`);
  }

  const removed: Record<string, number> = {};
  const remove = async (name: string, promise: Promise<{ deletedCount?: number }>) => { removed[name] = countRemoved(await promise); };

  await remove('taskMessages', TaskMessage.deleteMany({ projectId, $or: [{ taskId }, { relatedTaskId: taskId }] }, { session }));
  await remove('taskReads', TaskRead.deleteMany({ projectId, taskId }, { session }));
  await remove('markdownRevisions', MarkdownRevision.deleteMany({ projectId, documentId: { $in: documentIds } }, { session }));
  await remove('markdownDocuments', MarkdownDocument.deleteMany({ projectId, targetKind: 'task', targetId: taskId }, { session }));
  await remove('taskDiffs', TaskDiff.deleteMany({ projectId, taskId }, { session }));
  await remove('executions', Execution.deleteMany({ $or: [{ projectId, taskId }, ...(task.executionId ? [{ _id: task.executionId }] : [])] }, { session }));
  await remove('automationJobs', AutomationJob.deleteMany({ projectId, taskId }, { session }));
  await remove('events', Event.deleteMany(taskEventFilter, { session }));
  await remove('deliveryEvents', DeliveryEvent.deleteMany({ projectId, _id: { $in: eventIds } }, { session }));
  await DeliveryEvent.updateMany({ projectId, taskIds: taskId }, { $pull: { taskIds: taskId } }, { session });

  const operationFilter: Record<string, unknown> = { $or: [
    { _id: { $in: [...operationKeys] } },
    { projectId, 'result._id': { $in: relatedEntityIds } },
    { projectId, 'result.taskId': taskId },
    { projectId, 'result.relatedTaskId': taskId },
    { projectId, 'result.task._id': taskId },
    { projectId, 'result.tasks._id': taskId }
  ] };
  await remove('taskOperations', Operation.deleteMany(operationFilter, { session }));

  const siblingUpdate = await Task.updateMany(
    { projectId, _id: { $ne: taskId }, dependencies: taskId },
    { $pull: { dependencies: taskId }, $inc: { version: 1 } },
    { session }
  );
  removed.dependencyReferences = siblingUpdate.modifiedCount ?? 0;
  const staleProposals = await ActionProposal.updateMany({ projectId, taskId, status: 'pending' }, { $set: { status: 'stale' }, $inc: { version: 1 } }, { session });
  removed.staleActionProposals = staleProposals.modifiedCount ?? 0;
  const unlinkedConversations = await Conversation.updateMany({ projectId, taskId }, { $unset: { taskId: 1 }, $inc: { version: 1 } }, { session });
  removed.unlinkedConversations = unlinkedConversations.modifiedCount ?? 0;
  await TaskDependency.deleteMany({ projectId, $or: [{ taskId }, { dependencyId: taskId }] }, { session });
  removed.tasks = countRemoved(await Task.deleteOne({ _id: taskId, projectId }, { session }));

  const at = new Date();
  const auditId = randomUUID();
  await Event.create([{
    _id: auditId,
    projectId,
    entityId: taskId,
    action: 'hard_delete_task',
    kind: 'task.deleted',
    summary: 'Tarefa excluída definitivamente',
    actor: { userId: actor.userId, credentialId: actor.id },
    author: actor.userId,
    credentialId: actor.id,
    at,
    data: { removed }
  }], { session });
  const updatedProject = await Project.findByIdAndUpdate(projectId, { $inc: { eventSequence: 1 } }, { returnDocument: 'after', session }).select('eventSequence').lean();
  if (updatedProject) {
    await DeliveryEvent.create([{
      _id: auditId,
      projectId,
      sequence: updatedProject.eventSequence,
      taskIds: [],
      action: 'hard_delete_task',
      kind: 'task.deleted',
      summary: 'Tarefa excluída definitivamente',
      author: actor.userId,
      credentialId: actor.id,
      entityId: taskId,
      at
    }], { session });
  }

  return { deleted: true, projectId, taskId, removed };
}
