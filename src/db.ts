import mongoose, { Schema } from 'mongoose';

// String UUIDs are also the externally visible identifiers. No history TTL or delete API.
const base = { _id: String, version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } };
const options = { timestamps: true, strict: true, versionKey: false } as const;
const repository = new Schema({ id: String, name: String, url: String, instructions: String }, { _id: false });
export const Project = mongoose.model('Project', new Schema({ ...base, fence: { type: Number, default: 0 }, name: String, description: String, instructions: String,
  members: { type: Map, of: String }, repositories: [repository] }, options));
export const Feature = mongoose.model('Feature', new Schema({ ...base, projectId: { type: String, index: true }, name: String, objective: String, context: String, acceptance: [String] }, options));
export const Task = mongoose.model('Task', new Schema({ ...base, projectId: { type: String, index: true }, featureId: String, name: String,
  instructions: String, acceptance: [String], priority: Number, area: String, type: { type: String, default: 'feature' }, repositoryId: String, dependencies: [String],
  status: { type: String, default: 'pendente' }, executionId: String, responsible: String, leaseUntil: Date }, options));
Task.schema.index({ projectId: 1, status: 1, _id: 1 });
export const Execution = mongoose.model('Execution', new Schema({ _id: String, projectId: String, taskId: { type: String, index: true },
  credentialId: String, userId: String, agent: String, startedAt: Date, lastActivity: Date, endedAt: Date, status: String,
  progress: [String], impediments: [String], result: Schema.Types.Mixed }, options));
export const Event = mongoose.model('Event', new Schema({ _id: String, projectId: { type: String, index: true }, entityId: String,
  action: String, author: String, credentialId: String, at: Date, data: Schema.Types.Mixed }, { versionKey: false }));
Event.schema.index({ projectId: 1, at: 1, _id: 1 });
export const TaskMessage = mongoose.model('TaskMessage', new Schema({ _id: String, projectId: { type: String, index: true }, taskId: { type: String, index: true }, relatedTaskId: String, executionId: String, operationId: String, author: String, type: String, message: String, references: [String], createdAt: { type: Date, default: Date.now } }, { versionKey: false }));
TaskMessage.schema.index({ projectId: 1, taskId: 1, createdAt: 1, _id: 1 });
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
  await Promise.all([Project, Feature, Task, Execution, Event, TaskMessage, MarkdownDocument, MarkdownRevision, Operation, Credential, Bootstrap].map(model => model.init()));
}
