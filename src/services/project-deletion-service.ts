import type { ClientSession } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  AutomationJob,
  AutomationPolicy,
  ActionProposal,
  Conversation,
  ConversationMessage,
  DeliveryEvent,
  DeliveryRead,
  Event,
  Execution,
  Feature,
  MarkdownDocument,
  MarkdownRevision,
  Operation,
  Project,
  Runner,
  Task,
  TaskDependency,
  TaskDiff,
  TaskMessage,
  TaskRead
} from '../db.js';

type AuditActor = { id: string; userId: string; origin?: string };

export class ProjectDeletionConflict extends Error {
  readonly status = 409;
}

const countAffected = (result: { deletedCount?: number; modifiedCount?: number }) => result.deletedCount ?? result.modifiedCount ?? 0;

export async function deleteProjectCascade(projectId: string, actor: AuditActor, session: ClientSession) {
  const project = await Project.findOneAndUpdate(
    { _id: projectId },
    { $inc: { fence: 1 } },
    { returnDocument: 'after', session }
  ).lean();
  if (!project) return null;

  const featureIds = await Feature.find({ projectId }).select('_id').session(session).lean();
  const tasks = await Task.find({ projectId }).select('_id status executionId').session(session).lean();
  const markdownDocuments = await MarkdownDocument.find({ projectId }).select('_id').session(session).lean();
  const executions = await Execution.find({ projectId }).select('_id').session(session).lean();
  const taskIds = tasks.map(task => task._id);

  // Do not tear down a project while an external runner/provider still has
  // work in flight. The project fence above serializes this preflight with new
  // project-scoped mutations and reservations.
  const activeExecution = await Execution.exists({
    $or: [{ projectId }, { taskId: { $in: taskIds } }],
    status: 'em_execucao'
  }).session(session);
  const activeJob = await AutomationJob.exists({
    $and: [
      { $or: [{ projectId }, { taskId: { $in: taskIds } }] },
      { $or: [{ status: { $in: ['reserved', 'running', 'waiting_human'] } }, { turnInFlight: true }] }
    ]
  }).session(session);
  if (tasks.some(task => task.status === 'em_execucao') || activeExecution || activeJob) {
    throw new ProjectDeletionConflict('Project has an active execution or runner');
  }

  const executionIds = new Set([...executions.map(execution => execution._id), ...tasks.map(task => task.executionId).filter(Boolean)]);
  const featureIdValues = featureIds.map(feature => feature._id);
  const documentIds = markdownDocuments.map(document => document._id);
  const repositoryIds = [...new Set((project.repositories ?? []).map(repository => repository.id).filter((id): id is string => !!id))];

  // Repository IDs can be referenced by a shared runner. Preserve capabilities
  // that another surviving project still uses.
  const otherProjects = repositoryIds.length
    ? await Project.find({ _id: { $ne: projectId }, 'repositories.id': { $in: repositoryIds } }).select('repositories.id').session(session).lean()
    : [];
  const sharedRepositoryIds = new Set(otherProjects.flatMap(other => (other.repositories ?? []).map(repository => repository.id).filter((id): id is string => !!id)));
  const repositoryIdsToRemove = repositoryIds.filter(id => !sharedRepositoryIds.has(id));

  const removed: Record<string, number> = {};
  const remove = async (name: string, promise: Promise<{ deletedCount?: number; modifiedCount?: number }>) => { removed[name] = countAffected(await promise); };

  await remove('features', Feature.deleteMany({ projectId }, { session }));
  await remove('tasks', Task.deleteMany({ projectId }, { session }));
  await remove('taskDependencies', TaskDependency.deleteMany({ projectId }, { session }));
  await remove('executions', Execution.deleteMany({ $or: [{ projectId }, { taskId: { $in: taskIds } }, { _id: { $in: [...executionIds] } }] }, { session }));
  await remove('events', Event.deleteMany({ projectId }, { session }));
  await remove('taskMessages', TaskMessage.deleteMany({ $or: [{ projectId }, { taskId: { $in: taskIds } }, { relatedTaskId: { $in: taskIds } }] }, { session }));
  await remove('conversations', Conversation.deleteMany({ projectId }, { session }));
  await remove('conversationMessages', ConversationMessage.deleteMany({ projectId }, { session }));
  await remove('actionProposals', ActionProposal.deleteMany({ projectId }, { session }));
  await remove('deliveryEvents', DeliveryEvent.deleteMany({ projectId }, { session }));
  await remove('deliveryReads', DeliveryRead.deleteMany({ projectId }, { session }));
  await remove('taskReads', TaskRead.deleteMany({ projectId }, { session }));
  await remove('taskDiffs', TaskDiff.deleteMany({ $or: [{ projectId }, { taskId: { $in: taskIds } }] }, { session }));
  await remove('automationJobs', AutomationJob.deleteMany({ $or: [{ projectId }, { taskId: { $in: taskIds } }] }, { session }));
  await remove('markdownDocuments', MarkdownDocument.deleteMany({ $or: [{ projectId }, { targetId: { $in: [...taskIds, ...featureIdValues] } }] }, { session }));
  await remove('markdownRevisions', MarkdownRevision.deleteMany({ $or: [{ projectId }, { documentId: { $in: documentIds } }] }, { session }));
  await remove('projectOperations', Operation.deleteMany({ $or: [
      { projectId },
      { 'result._id': projectId },
      { 'result.projectId': projectId },
      { 'result.project._id': projectId },
      { 'result.tasks.projectId': projectId }
  ] }, { session }));
  await remove('automationPolicies', AutomationPolicy.deleteMany({ _id: projectId }, { session }));
  if (repositoryIdsToRemove.length) {
    await remove('runnerRepositoryLinks', Runner.updateMany({ repositories: { $in: repositoryIdsToRemove } }, { $pullAll: { repositories: repositoryIdsToRemove } }, { session }));
  }

  removed.projects = countAffected(await Project.deleteOne({ _id: projectId }, { session }));

  // Keep a small, global audit event outside the deleted project's event scope.
  // No token, document content, task text, or other project data is retained.
  await Event.create([{
    _id: randomUUID(),
    entityId: projectId,
    action: 'hard_delete_project',
    kind: 'project.deleted',
    summary: 'Projeto excluído definitivamente',
    actor: { userId: actor.userId, credentialId: actor.id },
    author: actor.userId,
    origin: actor.origin ?? 'Origem não identificada',
    credentialId: actor.id,
    at: new Date(),
    data: { removed }
  }], { session });

  return { deleted: true, projectId, removed };
}
