import mongoose from 'mongoose';
import {
  ActionProposal, AutomationJob, AutomationPolicy, Bootstrap, Conversation, ConversationMessage, ConversationRead, ConversationType, Credential,
  DeliveryEvent, DeliveryRead, Event, Execution, Feature, MarkdownDocument, MarkdownRevision, Operation,
  Project, Runner, Task, TaskDependency, TaskDiff, TaskMessage, TaskRead
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

export async function connect(uri: string) {
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('MongoDB replica set required');
  await migrateLegacyTaskTextIndex();
  await Promise.all([Project, Feature, Task, TaskDependency, Execution, Event, TaskMessage, Conversation, ConversationType, ConversationMessage, ConversationRead, ActionProposal, DeliveryEvent, DeliveryRead, TaskRead, TaskDiff, AutomationPolicy, Runner, AutomationJob, MarkdownDocument, MarkdownRevision, Operation, Credential, Bootstrap].map(model => model.init()));
}
