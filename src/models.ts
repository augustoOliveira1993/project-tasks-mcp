import mongoose, { Schema } from 'mongoose';
import { LEGACY_AREAS } from './area-catalog.js';

// Model definitions stay centralized; service modules depend on this persistence boundary.
const base = { _id: String, version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } };
const options = { timestamps: true, strict: true, versionKey: false } as const;
const git = new Schema({ canonicalRemoteUrl: String, rootCommit: String, boundAt: Date, boundBy: String }, { _id: false });
const repository = new Schema({ id: String, name: String, url: String, instructions: String, git }, { _id: false });

export const Project = mongoose.model('Project', new Schema({ ...base, eventSequence: { type: Number, default: 0 }, fence: { type: Number, default: 0 }, name: String, description: String, instructions: String,
  visibility: { type: String, default: 'public' }, accessTokenHash: String, members: { type: Map, of: String }, repositories: [repository], areas: { type: [String], default: () => [...LEGACY_AREAS] },
  importReceipt: { digest: String, importedAt: Date, importedBy: String } }, options));
Project.schema.index({ archived: 1, createdAt: 1, _id: 1 });
export const Feature = mongoose.model('Feature', new Schema({ ...base, projectId: { type: String, index: true }, name: String, objective: String, context: String, acceptance: [String] }, options));
export const Task = mongoose.model('Task', new Schema({ ...base, projectId: { type: String, index: true }, featureId: String, name: String,
  instructions: String, acceptance: [String], acceptanceProgress: { type: [Boolean], default: [] }, priority: Number, area: String, type: { type: String, default: 'feature' }, repositoryId: String, dependencies: [String],
  status: { type: String, default: 'pendente' }, executionId: String, responsible: String, leaseUntil: Date, checked: { type: Boolean, default: false }, checkedBy: String, checkedAt: Date }, options));
Task.schema.index({ projectId: 1, status: 1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, createdAt: 1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, status: 1, createdAt: 1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, updatedAt: -1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, priority: 1, updatedAt: -1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, checked: 1, status: 1 });
Task.schema.index({ projectId: 1, archived: 1, name: 1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, responsible: 1, _id: 1 });
Task.schema.index({ projectId: 1, archived: 1, name: 1, _id: 1 }, { name: 'task_project_name_pt', collation: { locale: 'pt', strength: 1 } });
Task.schema.index({ projectId: 1, archived: 1, name: 'text', responsible: 'text' });
Task.schema.index({ projectId: 1, featureId: 1, archived: 1, createdAt: 1, _id: 1 });
Task.schema.index({ projectId: 1, dependencies: 1, status: 1 });
Feature.schema.index({ projectId: 1, archived: 1, createdAt: 1, _id: 1 });

export const TaskDependency = mongoose.model('TaskDependency', new Schema({ _id: String, projectId: String, taskId: String, dependencyId: String }, { versionKey: false }));
TaskDependency.schema.index({ projectId: 1, taskId: 1, dependencyId: 1 }, { unique: true });
TaskDependency.schema.index({ projectId: 1, dependencyId: 1, taskId: 1 });

export const Execution = mongoose.model('Execution', new Schema({ _id: String, projectId: String, taskId: { type: String, index: true },
  credentialId: String, userId: String, agent: String, managedJobId: String, startedAt: Date, lastActivity: Date, endedAt: Date, status: String,
  progress: [String], impediments: [String], result: Schema.Types.Mixed }, options));
Execution.schema.index({ projectId: 1, taskId: 1, createdAt: 1, _id: 1 });
export const Event = mongoose.model('Event', new Schema({ _id: String, projectId: { type: String, index: true }, entityId: String,
  action: String, kind: String, toolName: String, summary: String, detail: String, conversationId: String, actor: Schema.Types.Mixed, git: Schema.Types.Mixed, author: String, origin: String, credentialId: String, at: Date, data: Schema.Types.Mixed }, { versionKey: false }));
Event.schema.index({ projectId: 1, at: 1, _id: 1 });
Event.schema.index({ at: -1, _id: -1 });
export const TaskMessage = mongoose.model('TaskMessage', new Schema({ _id: String, projectId: { type: String, index: true }, taskId: { type: String, index: true }, relatedTaskId: String, executionId: String, operationId: String, author: String, authorType: String, clientName: String, credentialId: String, conversationId: String, replyTo: String, correlationId: String, type: String, message: String, references: [String], createdAt: { type: Date, default: Date.now } }, { versionKey: false }));
TaskMessage.schema.index({ projectId: 1, taskId: 1, createdAt: 1, _id: 1 });
TaskMessage.schema.index({ projectId: 1, relatedTaskId: 1, createdAt: 1, _id: 1 });
TaskMessage.schema.index({ projectId: 1, taskId: 1, type: 1, createdAt: 1, _id: 1 });
TaskMessage.schema.index({ projectId: 1, replyTo: 1, type: 1, createdAt: 1 });
TaskMessage.schema.index({ projectId: 1, conversationId: 1, type: 1, createdAt: 1 });
const conversationTypeField = new Schema({ id: String, label: String, helpText: String, type: String, required: Boolean, options: [String] }, { _id: false, strict: true });
const conversationTypeCondition = new Schema({ fieldId: String, operator: String, value: String }, { _id: false, strict: true });
const conversationTypeStage = new Schema({ id: String, title: String, description: String, kind: String, required: Boolean,
  instruction: String, fields: [conversationTypeField], approvalLabel: String, condition: conversationTypeCondition }, { _id: false, strict: true });
export const ConversationType = mongoose.model('ConversationType', new Schema({
  ...base, projectId: { type: String, index: true }, name: String, nameKey: String, description: String,
  stages: { type: [conversationTypeStage], default: [] }
}, options));
ConversationType.schema.index({ projectId: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { archived: false } });
ConversationType.schema.index({ projectId: 1, archived: 1, createdAt: 1, _id: 1 });
export const Conversation = mongoose.model('Conversation', new Schema({
  ...base, projectId: { type: String, index: true }, createdBy: String, taskId: String,
  title: { type: String, default: 'Nova conversa' }, status: { type: String, default: 'open' }, lastMessageAt: Date,
  conversationTypeId: String, conversationTypeSnapshot: Schema.Types.Mixed
}, options));
Conversation.schema.index({ projectId: 1, createdAt: 1, _id: 1 });
Conversation.schema.index({ projectId: 1, taskId: 1, createdAt: 1, _id: 1 });
export const ConversationMessage = mongoose.model('ConversationMessage', new Schema({
  _id: String, projectId: String, conversationId: String, author: String, authorType: String, clientName: String,
  senderId: String, operationId: String, content: String, createdAt: { type: Date, default: Date.now }
}, { versionKey: false }));
ConversationMessage.schema.index({ projectId: 1, conversationId: 1, createdAt: 1, _id: 1 });
ConversationMessage.schema.index({ conversationId: 1, senderId: 1, operationId: 1 }, { unique: true });
export const ConversationRead = mongoose.model('ConversationRead', new Schema({
  projectId: String, userId: String, conversationId: String, lastReadCursor: String
}, options));
ConversationRead.schema.index({ projectId: 1, userId: 1, conversationId: 1 }, { unique: true });
const proposedTaskPatch = new Schema({ instructions: String, acceptance: [String] }, { _id: false, strict: true });
export const ActionProposal = mongoose.model('ActionProposal', new Schema({
  ...base, projectId: { type: String, index: true }, conversationId: String, taskId: String,
  expectedTaskVersion: Number, approvedTaskVersion: Number, title: String, summary: String,
  taskPatch: proposedTaskPatch, provider: String, status: { type: String, default: 'pending' },
  createdBy: String, approvedBy: String, approvedAt: Date, jobId: String
}, options));
ActionProposal.schema.index({ projectId: 1, conversationId: 1, createdAt: -1, _id: -1 });
ActionProposal.schema.index({ projectId: 1, taskId: 1, status: 1, createdAt: -1 });
export const DeliveryEvent = mongoose.model('DeliveryEvent', new Schema({ _id: String, projectId: String, sequence: Number, taskIds: [String], action: String, kind: String, toolName: String, summary: String, detail: String, conversationId: String, author: String, origin: String, credentialId: String, entityId: String, entityVersion: Number, at: Date }, { versionKey: false }));
DeliveryEvent.schema.index({ projectId: 1, sequence: 1 }, { unique: true });
DeliveryEvent.schema.index({ projectId: 1, taskIds: 1, sequence: 1 });
export const DeliveryRead = mongoose.model('DeliveryRead', new Schema({ projectId: String, userId: String, lastSequence: { type: Number, default: 0 } }, options));
DeliveryRead.schema.index({ projectId: 1, userId: 1 }, { unique: true });
export const TaskRead = mongoose.model('TaskRead', new Schema({ projectId: String, userId: String, taskId: String, lastSequence: { type: Number, default: 0 } }, options));
TaskRead.schema.index({ projectId: 1, userId: 1, taskId: 1 }, { unique: true });
TaskRead.schema.index({ projectId: 1, taskId: 1, userId: 1 });
export const TaskDiff = mongoose.model('TaskDiff', new Schema({ _id: String, projectId: { type: String, index: true }, taskId: { type: String, index: true }, repositoryId: String,
  baseCommit: String, commit: String, branch: String, files: [String], patch: String, patchSha256: String, truncated: Boolean, author: String, credentialId: String, agent: String }, options));
TaskDiff.schema.index({ projectId: 1, taskId: 1, createdAt: -1 });
TaskDiff.schema.index({ projectId: 1, taskId: 1, createdAt: 1, _id: 1 });
export const AutomationPolicy = mongoose.model('AutomationPolicy', new Schema({ _id: String, version: { type: Number, default: 0 }, enabled: { type: Boolean, default: false }, maxConcurrent: { type: Number, default: 10 }, routes: [{ repositoryId: String, area: String, provider: String, _id: false }] }, options));
export const Runner = mongoose.model('Runner', new Schema({ _id: String, credentialId: String, machineId: String, providers: [String], repositories: [String], maxConcurrent: Number, lastSeen: Date, fence: { type: Number, default: 0 } }, options));
Runner.schema.index({ credentialId: 1, machineId: 1 }, { unique: true });
export const AutomationJob = mongoose.model('AutomationJob', new Schema({ _id: String, projectId: String, taskId: String, version: { type: Number, default: 0 }, mode: { type: String, default: 'work' }, authorizationValid: { type: Boolean, default: true }, originJobId: String, preferredRunnerId: String, triggerMessageId: String, conversationId: String, conversationMessageCursor: String, turnInFlight: { type: Boolean, default: false }, fingerprint: String, repositoryId: String, provider: String, authorizedBy: String, status: String, runnerId: String, credentialId: String, reservationUntil: Date, executionId: String, providerSessionId: String, cwd: String, attempts: { type: Number, default: 0 }, turns: { type: Number, default: 0 }, startedAt: Date, lastCursor: String, deliveredMessageIds: [String], usage: Schema.Types.Mixed, error: String, request: Schema.Types.Mixed }, options));
AutomationJob.schema.index({ projectId: 1, status: 1, createdAt: 1 });
AutomationJob.schema.index({ runnerId: 1, status: 1 });
AutomationJob.schema.index({ taskId: 1, createdAt: -1 });
export const MarkdownDocument = mongoose.model('MarkdownDocument', new Schema({ ...base, projectId: { type: String, index: true }, targetKind: String, targetId: String, name: String, summary: String, revision: Number, author: String, size: Number, sha256: String }, options));
MarkdownDocument.schema.index({ projectId: 1, targetKind: 1, targetId: 1, name: 1 }, { unique: true });
export const MarkdownRevision = mongoose.model('MarkdownRevision', new Schema({ _id: String, projectId: { type: String, index: true }, documentId: { type: String, index: true }, revision: Number, summary: String, content: String, author: String, size: Number, sha256: String, createdAt: Date }, { versionKey: false }));
MarkdownRevision.schema.index({ documentId: 1, revision: 1 }, { unique: true });
export const Operation = mongoose.model('Operation', new Schema({ _id: String, projectId: String, fingerprint: String, result: Schema.Types.Mixed }, { versionKey: false }));
export const Credential = mongoose.model('Credential', new Schema({ _id: String, hash: { type: String, unique: true }, userId: String,
  scope: String, systemAdmin: Boolean, revoked: { type: Boolean, default: false }, fence: { type: Number, default: 0 } }, options));
export const Bootstrap = mongoose.model('Bootstrap', new Schema({ _id: String }, { versionKey: false }));
