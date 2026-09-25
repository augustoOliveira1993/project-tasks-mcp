import mongoose, { Schema } from 'mongoose';

// String UUIDs are also the externally visible identifiers. No history TTL or delete API.
const base = { _id: String, version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } };
const options = { timestamps: true, strict: true, versionKey: false } as const;
const git = new Schema({ canonicalRemoteUrl: String, rootCommit: String, boundAt: Date, boundBy: String }, { _id: false });
const repository = new Schema({ id: String, name: String, url: String, instructions: String, git }, { _id: false });
export const Project = mongoose.model('Project', new Schema({ ...base, eventSequence: { type: Number, default: 0 }, fence: { type: Number, default: 0 }, name: String, description: String, instructions: String,
  visibility: { type: String, default: 'public' }, accessTokenHash: String, members: { type: Map, of: String }, repositories: [repository] }, options));
export const Feature = mongoose.model('Feature', new Schema({ ...base, projectId: { type: String, index: true }, name: String, objective: String, context: String, acceptance: [String] }, options));
export const Task = mongoose.model('Task', new Schema({ ...base, projectId: { type: String, index: true }, featureId: String, name: String,
  instructions: String, acceptance: [String], priority: Number, area: String, type: { type: String, default: 'feature' }, repositoryId: String, dependencies: [String],
  status: { type: String, default: 'pendente' }, executionId: String, responsible: String, leaseUntil: Date, checked: { type: Boolean, default: false }, checkedBy: String, checkedAt: Date }, options));
Task.schema.index({ projectId: 1, status: 1, _id: 1 });
export const Execution = mongoose.model('Execution', new Schema({ _id: String, projectId: String, taskId: { type: String, index: true },
  credentialId: String, userId: String, agent: String, managedJobId: String, startedAt: Date, lastActivity: Date, endedAt: Date, status: String,
  progress: [String], impediments: [String], result: Schema.Types.Mixed }, options));
export const Event = mongoose.model('Event', new Schema({ _id: String, projectId: { type: String, index: true }, entityId: String,
  action: String, kind: String, summary: String, actor: Schema.Types.Mixed, git: Schema.Types.Mixed, author: String, credentialId: String, at: Date, data: Schema.Types.Mixed }, { versionKey: false }));
Event.schema.index({ projectId: 1, at: 1, _id: 1 });
export const TaskMessage = mongoose.model('TaskMessage', new Schema({ _id: String, projectId: { type: String, index: true }, taskId: { type: String, index: true }, relatedTaskId: String, executionId: String, operationId: String, author: String, credentialId: String, conversationId: String, replyTo: String, correlationId: String, type: String, message: String, references: [String], createdAt: { type: Date, default: Date.now } }, { versionKey: false }));
TaskMessage.schema.index({ projectId: 1, taskId: 1, createdAt: 1, _id: 1 });
TaskMessage.schema.index({ projectId: 1, relatedTaskId: 1, createdAt: 1, _id: 1 });
export const DeliveryEvent = mongoose.model('DeliveryEvent', new Schema({ _id: String, projectId: String, sequence: Number, taskIds: [String], action: String, kind: String, summary: String, author: String, credentialId: String, entityId: String, entityVersion: Number, at: Date }, { versionKey: false }));
DeliveryEvent.schema.index({ projectId: 1, sequence: 1 }, { unique: true });
DeliveryEvent.schema.index({ projectId: 1, taskIds: 1, sequence: 1 });
export const DeliveryRead = mongoose.model('DeliveryRead', new Schema({ projectId: String, userId: String, lastSequence: { type: Number, default: 0 } }, options));
DeliveryRead.schema.index({ projectId: 1, userId: 1 }, { unique: true });
export const TaskDiff = mongoose.model('TaskDiff', new Schema({ _id: String, projectId: { type: String, index: true }, taskId: { type: String, index: true }, repositoryId: String,
  baseCommit: String, commit: String, branch: String, files: [String], patch: String, patchSha256: String, truncated: Boolean, author: String, credentialId: String, agent: String }, options));
TaskDiff.schema.index({ projectId: 1, taskId: 1, createdAt: -1 });
export const AutomationPolicy = mongoose.model('AutomationPolicy', new Schema({ _id: String, version: { type: Number, default: 0 }, enabled: { type: Boolean, default: false }, maxConcurrent: { type: Number, default: 10 }, routes: [{ repositoryId: String, area: String, provider: String, _id: false }] }, options));
export const Runner = mongoose.model('Runner', new Schema({ _id: String, credentialId: String, machineId: String, providers: [String], repositories: [String], maxConcurrent: Number, lastSeen: Date, fence: { type: Number, default: 0 } }, options));
Runner.schema.index({ credentialId: 1, machineId: 1 }, { unique: true });
export const AutomationJob = mongoose.model('AutomationJob', new Schema({ _id: String, projectId: String, taskId: String, version: { type: Number, default: 0 }, mode: { type: String, default: 'work' }, authorizationValid: { type: Boolean, default: true }, originJobId: String, preferredRunnerId: String, triggerMessageId: String, conversationId: String, turnInFlight: { type: Boolean, default: false }, fingerprint: String, repositoryId: String, provider: String, authorizedBy: String, status: String, runnerId: String, credentialId: String, reservationUntil: Date, executionId: String, providerSessionId: String, cwd: String, attempts: { type: Number, default: 0 }, turns: { type: Number, default: 0 }, startedAt: Date, lastCursor: String, deliveredMessageIds: [String], usage: Schema.Types.Mixed, error: String, request: Schema.Types.Mixed }, options));
AutomationJob.schema.index({ projectId: 1, status: 1, createdAt: 1 });
AutomationJob.schema.index({ runnerId: 1, status: 1 });
AutomationJob.schema.index({ taskId: 1, createdAt: -1 });
export const MarkdownDocument = mongoose.model('MarkdownDocument', new Schema({ ...base, projectId: { type: String, index: true }, targetKind: String, targetId: String, name: String, summary: String, revision: Number, author: String, size: Number, sha256: String }, options));
MarkdownDocument.schema.index({ projectId: 1, targetKind: 1, targetId: 1, name: 1 }, { unique: true });
export const MarkdownRevision = mongoose.model('MarkdownRevision', new Schema({ _id: String, projectId: { type: String, index: true }, documentId: { type: String, index: true }, revision: Number, summary: String, content: String, author: String, size: Number, sha256: String, createdAt: Date }, { versionKey: false }));
MarkdownRevision.schema.index({ documentId: 1, revision: 1 }, { unique: true });
export const Operation = mongoose.model('Operation', new Schema({ _id: String, fingerprint: String, result: Schema.Types.Mixed }, { versionKey: false }));
export const Credential = mongoose.model('Credential', new Schema({ _id: String, hash: { type: String, unique: true }, userId: String,
  scope: String, systemAdmin: Boolean, revoked: { type: Boolean, default: false }, fence: { type: Number, default: 0 } }, options));
export const Bootstrap = mongoose.model('Bootstrap', new Schema({ _id: String }, { versionKey: false }));
export async function connect(uri: string) {
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('MongoDB replica set required');
  await Promise.all([Project, Feature, Task, Execution, Event, TaskMessage, DeliveryEvent, DeliveryRead, TaskDiff, AutomationPolicy, Runner, AutomationJob, MarkdownDocument, MarkdownRevision, Operation, Credential, Bootstrap].map(model => model.init()));
}
