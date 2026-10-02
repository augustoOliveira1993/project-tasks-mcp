import { Event, Execution, Feature, MarkdownDocument, Project, Task, TaskMessage } from '../models.js';
import type { TaskContextDto } from '../contracts.js';
import { isKnownAiMcpClient } from './task-message-author.js';
import { logger } from '../logger.js';

export const TASK_CONTEXT_MAX_BYTES = 128 * 1024;

function text(value: unknown, maxLength: number, path: string, truncated: Set<string>) {
  if (typeof value !== 'string') return '';
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  truncated.add(path);
  return chars.slice(0, Math.max(0, maxLength - 1)).join('') + '…';
}

function contextBytes(context: TaskContextDto) {
  return Buffer.byteLength(JSON.stringify(context), 'utf8');
}

function fitContext(context: TaskContextDto, truncated: Set<string>) {
  const protectedKeys = new Set(['_id', 'projectId', 'featureId', 'repositoryId', 'taskId', 'executionId', 'status', 'type', 'area', 'createdAt', 'updatedAt', 'leaseUntil', 'checked', 'complete', 'priority', 'version', 'archived', 'references']);
  while (contextBytes(context) > TASK_CONTEXT_MAX_BYTES) {
    const candidates: Array<{ parent: Record<string, unknown>; key: string; value: string; path: string }> = [];
    const visit = (value: unknown, path: string) => {
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && !protectedKeys.has(key) && Array.from(child).length > 80) {
          candidates.push({ parent: value as Record<string, unknown>, key, value: child, path: `${path}.${key}` });
        } else visit(child, `${path}.${key}`);
      }
    };
    visit(context, 'context');
    candidates.sort((left, right) => right.value.length - left.value.length);
    const largest = candidates[0];
    if (largest) {
      const chars = Array.from(largest.value);
      largest.parent[largest.key] = chars.slice(0, Math.max(79, Math.floor(chars.length * 0.75) - 1)).join('') + '…';
      truncated.add(largest.path);
      continue;
    }
    const optionalArrays: Array<[string, unknown[]]> = [
      ['messages', context.messages], ['executions', context.executions],
      ['markdowns.task.items', context.markdowns.task.items], ['markdowns.feature.items', context.markdowns.feature.items]
    ];
    const removable = optionalArrays.find(([, items]) => items.length > 0);
    if (!removable) throw new Error('Required task context fields exceed the configured size limit');
    removable[1].pop();
    truncated.add(removable[0]);
  }
  context.contextMeta.truncatedFields = [...truncated].sort();
  context.contextMeta.payloadBytes = contextBytes(context);
  // The number of digits in payloadBytes can change the serialized size; converge before returning.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bytes = contextBytes(context);
    if (bytes === context.contextMeta.payloadBytes) break;
    context.contextMeta.payloadBytes = bytes;
  }
  return context;
}

function markdownItems(items: any[], more: boolean, truncated: Set<string>, path: string) {
  if (more) truncated.add(path);
  return {
    items: items.map(item => ({
      _id: item._id,
      targetKind: item.targetKind,
      targetId: item.targetId,
      name: text(item.name, 160, `${path}.name`, truncated),
      summary: text(item.summary, 240, `${path}.summary`, truncated),
      revision: item.revision,
      size: item.size,
      createdAt: item.createdAt
    })),
    next: more ? items.at(-1)?._id ?? null : null
  };
}

/** Builds the safe, bounded DTO returned to agents; full documents remain available via their dedicated tools. */
export async function getTaskContext(projectId: string, taskId: string, includeAdministrativeDetails = false): Promise<TaskContextDto | null> {
  const startedAt = Date.now();
  const [task, project] = await Promise.all([
    Task.findOne({ _id: taskId, projectId }).select('_id projectId version archived featureId name instructions acceptance acceptanceProgress priority area type repositoryId dependencies status executionId responsible leaseUntil checked checkedBy checkedAt createdAt updatedAt').lean(),
    Project.findById(projectId).select('_id version name description instructions').lean()
  ]);
  if (!task || !project) return null;

  const [feature, repositoryRecord, messages, dependencyTasks, executions, taskDocs, featureDocs] = await Promise.all([
    task.featureId ? Feature.findOne({ _id: task.featureId, projectId }).select('_id version name objective context acceptance').lean() : Promise.resolve(null),
    task.repositoryId ? Project.findOne({ _id: projectId, 'repositories.id': task.repositoryId }).select({ 'repositories.$': 1 }).lean() : Promise.resolve(null),
    TaskMessage.find({ projectId, $or: [{ taskId }, { relatedTaskId: taskId }] }).select('_id taskId relatedTaskId author authorType clientName type message references createdAt conversationId replyTo').sort({ createdAt: -1, _id: -1 }).limit(11).lean(),
    task.dependencies?.length ? Task.find({ _id: { $in: task.dependencies }, projectId }).select('_id name status area type executionId').lean() : Promise.resolve([]),
    Execution.find({ projectId, taskId }).select('_id status startedAt endedAt impediments result.summary result.evidence').sort({ startedAt: -1, _id: -1 }).limit(6).lean(),
    MarkdownDocument.find({ projectId, targetKind: 'task', targetId: taskId }).select('_id targetKind targetId name summary revision size createdAt').sort({ _id: 1 }).limit(11).lean(),
    task.featureId ? MarkdownDocument.find({ projectId, targetKind: 'feature', targetId: task.featureId }).select('_id targetKind targetId name summary revision size createdAt').sort({ _id: 1 }).limit(11).lean() : Promise.resolve([])
  ]);

  const messageEvents = messages.length ? await Event.find({ projectId, action: 'task_message', entityId: { $in: messages.map(message => message._id) } }).select('entityId actor').lean() : [];
  const eventClientNames = new Map(messageEvents.map(event => [event.entityId, typeof (event.actor as any)?.agent === 'string' ? (event.actor as any).agent.trim().slice(0, 100) : null]));
  const truncated = new Set<string>();
  const acceptance = (task.acceptance ?? []).map((item, index) => text(item, 240, `task.acceptance[${index}]`, truncated));
  const acceptanceProgress = Array.from({ length: acceptance.length }, (_value, index) => task.acceptanceProgress?.[index] === true);
  const acceptanceEvidence: Array<string | null> = Array.from({ length: acceptance.length }, () => null);
  const latestAcceptanceEvents = await Event.aggregate([
    { $match: { projectId, entityId: taskId, action: 'set_acceptance_criterion' } },
    { $project: { _id: 1, at: 1, 'data.criterionIndex': 1, 'data.complete': 1, 'data.evidence': 1 } },
    { $sort: { at: -1, _id: -1 } },
    { $group: { _id: '$data.criterionIndex', complete: { $first: '$data.complete' }, evidence: { $first: '$data.evidence' } } }
  ]);
  for (const event of latestAcceptanceEvents) {
    const index = event._id;
    if (Number.isInteger(index) && index >= 0 && index < acceptanceEvidence.length && acceptanceProgress[index] && event.complete === true && typeof event.evidence === 'string') {
      acceptanceEvidence[index] = text(event.evidence, 240, `task.acceptanceEvidence[${index}]`, truncated);
    }
  }

  const repository = repositoryRecord?.repositories?.[0] ?? null;
  const dependencyIds = new Set(task.dependencies ?? []);
  const orderedDependencies = [...dependencyIds].map(id => dependencyTasks.find(item => item._id === id)).filter(Boolean);
  const executionIds = orderedDependencies.flatMap(item => item?.executionId ? [item.executionId] : []);
  const dependencyExecutions: any[] = executionIds.length ? await Execution.find({ _id: { $in: executionIds } }).select('_id status result.summary result.evidence').lean() : [];
  const messageMore = messages.length > 10;
  const executionMore = executions.length > 5;
  const taskMarkdownMore = taskDocs.length > 10;
  const featureMarkdownMore = featureDocs.length > 10;
  if (messageMore) truncated.add('messages');
  if (executionMore) truncated.add('executions');
  if ((feature?.acceptance?.length ?? 0) > 20) truncated.add('feature.acceptance');
  const boundedMessages = messages.slice(0, 10).map((message, index) => {
    const boundedMessage = text(message.message, 1000, `messages[${index}].message`, truncated);
    const clientName = typeof message.clientName === 'string' && message.clientName.trim() ? text(message.clientName.trim(), 100, `messages[${index}].clientName`, truncated) : eventClientNames.get(message._id!) ?? null;
    const authorType = message.authorType === 'human' || message.authorType === 'agent'
      ? message.authorType
      : clientName ? isKnownAiMcpClient(clientName) ? 'agent' : 'unknown' : 'unknown';
    return {
      _id: message._id!, taskId: message.taskId!, relatedTaskId: message.relatedTaskId ?? undefined,
      author: text(message.author, 160, `messages[${index}].author`, truncated), authorType, clientName, type: message.type!,
      message: boundedMessage, references: (message.references ?? []).slice(0, 10).map((reference, refIndex) => text(reference, 160, `messages[${index}].references[${refIndex}]`, truncated)), createdAt: message.createdAt!,
      conversationId: message.conversationId ?? undefined, replyTo: message.replyTo ?? undefined,
      ...(boundedMessage !== message.message ? { truncated: true } : {})
    };
  });
  const context: TaskContextDto = {
    contextMeta: { version: 1, maxBytes: TASK_CONTEXT_MAX_BYTES, payloadBytes: 0, truncatedFields: [] },
    task: {
      _id: task._id!, projectId: task.projectId!, version: task.version ?? 0, archived: task.archived ?? false,
      featureId: task.featureId ?? null, name: text(task.name, 240, 'task.name', truncated),
      instructions: text(task.instructions, 5000, 'task.instructions', truncated), acceptance, acceptanceProgress,
      acceptanceEvidence, priority: task.priority ?? 0, area: task.area ?? 'outro', type: task.type ?? 'feature',
      repositoryId: task.repositoryId ?? '', dependencies: [...dependencyIds], status: task.status ?? 'pendente',
      executionId: task.executionId ?? null, responsible: task.responsible ? text(task.responsible, 160, 'task.responsible', truncated) : null,
      checked: task.checked ?? false,
      ...(includeAdministrativeDetails ? { leaseUntil: task.leaseUntil ?? null } : {}),
      checkedBy: task.checkedBy ? text(task.checkedBy, 160, 'task.checkedBy', truncated) : null,
      checkedAt: task.checkedAt ?? null,
      createdAt: task.createdAt!, updatedAt: task.updatedAt!
    },
    project: {
      _id: project._id!, version: project.version ?? 0, name: text(project.name, 240, 'project.name', truncated),
      description: text(project.description, 2000, 'project.description', truncated),
      instructions: text(project.instructions, 3000, 'project.instructions', truncated)
    },
    feature: feature ? {
      _id: feature._id!, version: feature.version ?? 0, name: text(feature.name, 240, 'feature.name', truncated),
      objective: text(feature.objective, 1500, 'feature.objective', truncated),
      context: text(feature.context, 1500, 'feature.context', truncated),
      acceptance: (feature.acceptance ?? []).slice(0, 20).map((item, index) => text(item, 240, `feature.acceptance[${index}]`, truncated))
    } : null,
    repository: repository ? {
      id: repository.id!, name: text(repository.name, 200, 'repository.name', truncated), url: repository.url!,
      instructions: text(repository.instructions, 2000, 'repository.instructions', truncated)
    } : null,
    markdowns: {
      task: markdownItems(taskDocs.slice(0, 10), taskMarkdownMore, truncated, 'markdowns.task'),
      feature: markdownItems(featureDocs.slice(0, 10), featureMarkdownMore, truncated, 'markdowns.feature')
    },
    messages: boundedMessages,
    dependencies: orderedDependencies.map(item => ({
      _id: item!._id!, name: text(item!.name, 200, `dependencies.${item!._id}.name`, truncated),
      status: item!.status!, area: item!.area ?? 'outro', type: item!.type ?? 'feature',
      execution: item!.executionId ? (() => {
        const execution = dependencyExecutions.find(candidate => candidate._id === item!.executionId);
        return execution ? {
          _id: execution._id!, status: execution.status!,
          ...(execution.result ? { result: {
            summary: text(execution.result.summary, 600, `dependencies.${item!._id}.execution.summary`, truncated),
            evidence: (Array.isArray(execution.result.evidence) ? execution.result.evidence : []).slice(0, 3).map((entry: unknown, index: number) => text(entry, 160, `dependencies.${item!._id}.execution.evidence[${index}]`, truncated))
          } } : {})
        } : null;
      })() : null
    })),
    executions: executions.slice(0, 5).map((execution, index) => {
      const impediments = (Array.isArray(execution.impediments) ? execution.impediments : [])
        .slice(-5)
        .map((item: unknown, impedimentIndex: number) => text(item, 1200, `executions[${index}].impediments[${impedimentIndex}]`, truncated))
        .filter(Boolean);
      return {
        _id: execution._id!, status: execution.status!, startedAt: execution.startedAt!, endedAt: execution.endedAt ?? undefined,
        ...(impediments.length ? { impediments } : {}),
        result: execution.result ? {
          summary: text(execution.result.summary, 1000, `executions[${index}].result.summary`, truncated),
          evidence: (Array.isArray(execution.result.evidence) ? execution.result.evidence : []).slice(0, 5).map((item: unknown, evidenceIndex: number) => text(item, 240, `executions[${index}].result.evidence[${evidenceIndex}]`, truncated))
        } : undefined
      };
    })
  };

  const result = fitContext(context, truncated);
  logger.debug('task context built', {
    projectId, taskId, payloadBytes: result.contextMeta.payloadBytes, maxBytes: result.contextMeta.maxBytes,
    messages: result.messages.length, dependencies: result.dependencies.length, executions: result.executions.length,
    durationMs: Date.now() - startedAt
  });
  return result;
}
