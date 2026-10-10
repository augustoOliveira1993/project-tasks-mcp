import mongoose from 'mongoose';
import {
  ActionProposal, AutomationJob, AutomationPolicy, Bootstrap, Conversation, ConversationMessage, ConversationRead, ConversationType, Credential,
  DeliveryEvent, DeliveryRead, Event, Execution, Feature, MarkdownDocument, MarkdownRevision, Operation,
  Project, ProjectMemory, ProjectMemoryProposal, ProjectMemoryRevision, Runner, Task, TaskDependency, TaskDiff, TaskMessage, TaskRead
} from './models.js';

export * from './models.js';

async function migrateLegacyTaskTextIndex() {
  const db = mongoose.connection.db!;
  const collectionName = Task.collection.collectionName;
  const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
  if (!exists) return;
  const collection = db.collection(collectionName);
  const indexes = await collection.listIndexes().toArray();
  const legacyIndex = indexes.find(index => {
    const weights = (index as typeof index & { weights?: Record<string, number> }).weights;
    return index.name === 'name_text' && weights !== undefined && Object.keys(weights).length === 1 && weights.name === 1;
  });
  if (legacyIndex?.name) await collection.dropIndex(legacyIndex.name);
}

async function migrateProjectMemoryTextIndex() {
  const db = mongoose.connection.db!;
  const collectionName = ProjectMemory.collection.collectionName;
  const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
  if (!exists) return;
  const collection = db.collection(collectionName);
  const indexes = await collection.listIndexes().toArray();
  const current = indexes.find(index => index.name === 'project_memory_text');
  if (!current) return;

  const weights = (current as typeof current & { weights?: Record<string, number> }).weights ?? {};
  const expectedWeights = { title: 5, category: 2, 'sources.title': 2, content: 1 };
  const sameWeights = Object.keys(expectedWeights).length === Object.keys(weights).length &&
    Object.entries(expectedWeights).every(([field, weight]) => weights[field] === weight);
  if (!sameWeights || current.default_language !== 'portuguese') await collection.dropIndex(current.name!);
}

export async function connect(uri: string) {
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('MongoDB replica set required');
  // ProjectMemory disables automatic index creation so its legacy text index can
  // be migrated before Mongoose tries to create the schema's new text index.
  await ProjectMemory.init();
  await migrateLegacyTaskTextIndex();
  await migrateProjectMemoryTextIndex();
  await ProjectMemory.createIndexes();
  await Promise.all([Project, Feature, Task, TaskDependency, Execution, Event, TaskMessage, Conversation, ConversationType, ConversationMessage, ConversationRead, ActionProposal, DeliveryEvent, DeliveryRead, TaskRead, TaskDiff, AutomationPolicy, Runner, AutomationJob, MarkdownDocument, MarkdownRevision, ProjectMemoryRevision, ProjectMemoryProposal, Operation, Credential, Bootstrap].map(model => model.init()));
}
