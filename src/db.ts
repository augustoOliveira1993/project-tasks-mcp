import mongoose from 'mongoose';
import {
  ActionProposal, AutomationJob, AutomationPolicy, Bootstrap, Conversation, ConversationMessage, ConversationRead, ConversationType, Credential,
  DeliveryEvent, DeliveryRead, Event, Execution, Feature, MarkdownDocument, MarkdownRevision, Operation,
  Project, ProjectMemory, ProjectMemoryProposal, ProjectMemoryRevision, Runner, Task, TaskDependency, TaskDiff, TaskMessage, TaskRead,
  TASK_SEARCH_TEXT_INDEX_KEYS, TASK_SEARCH_TEXT_INDEX_OPTIONS
} from './models.js';

export * from './models.js';

type StoredTextIndex = {
  name?: string;
  key: Record<string, unknown>;
  weights?: Record<string, number>;
  default_language?: string;
  language_override?: string;
};

const legacyTaskTextIndexKeys = { projectId: 1, archived: 1, name: 'text', responsible: 'text' } as const;
const nameOnlyTaskTextIndexKeys = { name: 'text' } as const;

function textIndexWeights(index: StoredTextIndex) {
  return index.weights ?? Object.fromEntries(Object.entries(index.key).filter(([, value]) => value === 'text').map(([key]) => [key, 1]));
}

function textIndexPrefix(index: StoredTextIndex) {
  return Object.entries(index.key).filter(([key, value]) => key !== '_fts' && key !== '_ftsx' && value !== 'text');
}

function sameEntries(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>) {
  const sorted = (value: Record<string, unknown>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function hasKeys(index: StoredTextIndex, keys: Readonly<Record<string, unknown>>) {
  const expectedWeights = Object.fromEntries(Object.entries(keys).filter(([, value]) => value === 'text').map(([key]) => [key, 1]));
  const expectedPrefix = Object.fromEntries(Object.entries(keys).filter(([, value]) => value !== 'text'));
  return sameEntries(textIndexWeights(index), expectedWeights) && sameEntries(Object.fromEntries(textIndexPrefix(index)), expectedPrefix);
}

function isTaskTextIndex(index: StoredTextIndex) {
  return index.weights !== undefined || Object.values(index.key).includes('text');
}

function isKnownTaskTextIndex(index: StoredTextIndex) {
  return hasKeys(index, nameOnlyTaskTextIndexKeys) || hasKeys(index, legacyTaskTextIndexKeys) || hasKeys(index, TASK_SEARCH_TEXT_INDEX_KEYS);
}

function isExpandedTaskTextIndex(index: StoredTextIndex) {
  return hasKeys(index, TASK_SEARCH_TEXT_INDEX_KEYS) &&
    index.default_language === TASK_SEARCH_TEXT_INDEX_OPTIONS.default_language &&
    index.name === TASK_SEARCH_TEXT_INDEX_OPTIONS.name;
}

function restoreTextIndexOptions(index: StoredTextIndex) {
  return {
    ...(index.name ? { name: index.name } : {}),
    ...(index.default_language ? { default_language: index.default_language } : {}),
    ...(index.language_override ? { language_override: index.language_override } : {}),
    ...(index.weights ? { weights: index.weights } : {})
  };
}

function restoreTextIndexKeys(index: StoredTextIndex): Record<string, 1 | -1 | 'text'> {
  const prefixKeys = textIndexPrefix(index).map(([field, direction]): [string, 1 | -1] => {
    if (direction !== 1 && direction !== -1) throw new Error('Unsupported task text index prefix direction.');
    return [field, direction];
  });
  const textKeys = Object.keys(textIndexWeights(index)).map((field): [string, 'text'] => [field, 'text']);
  return Object.fromEntries([...prefixKeys, ...textKeys]);
}

export async function migrateTaskTextIndex(target: 'expanded' | 'legacy' = 'expanded') {
  const db = mongoose.connection.db!;
  const collectionName = Task.collection.collectionName;
  const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
  if (!exists) return;
  const collection = db.collection(collectionName);
  const indexes = await collection.listIndexes().toArray() as StoredTextIndex[];
  const textIndexes = indexes.filter(isTaskTextIndex);
  if (!textIndexes.length) {
    if (target === 'expanded') await collection.createIndex({ ...TASK_SEARCH_TEXT_INDEX_KEYS }, { ...TASK_SEARCH_TEXT_INDEX_OPTIONS });
    else await collection.createIndex(legacyTaskTextIndexKeys);
    return;
  }
  const targetIsCurrent = target === 'expanded'
    ? textIndexes.length === 1 && isExpandedTaskTextIndex(textIndexes[0])
    : textIndexes.length === 1 && hasKeys(textIndexes[0], legacyTaskTextIndexKeys) && (textIndexes[0].default_language ?? 'english') === 'english';
  if (targetIsCurrent) return;
  if (!textIndexes.every(isKnownTaskTextIndex)) throw new Error('Task collection has an unrecognized text index; refusing to replace it.');

  try {
    for (const index of textIndexes) if (index.name) await collection.dropIndex(index.name);
    if (target === 'expanded') await collection.createIndex({ ...TASK_SEARCH_TEXT_INDEX_KEYS }, { ...TASK_SEARCH_TEXT_INDEX_OPTIONS });
    else await collection.createIndex(legacyTaskTextIndexKeys);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const index of textIndexes) {
      try {
        await collection.createIndex(restoreTextIndexKeys(index), restoreTextIndexOptions(index));
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Task text index migration failed and rollback could not restore every previous index.');
    throw error;
  }
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

export async function migrateProjectMemoryScopes() {
  await ProjectMemory.updateMany({ scope: { $exists: false } }, { $set: { scope: 'project' } });
  await ProjectMemoryRevision.updateMany({ scope: { $exists: false } }, { $set: { scope: 'project' } });
  await ProjectMemoryProposal.updateMany({ scope: { $exists: false } }, { $set: { scope: 'project' } });
}

export async function connect(uri: string) {
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('MongoDB replica set required');
  // ProjectMemory disables automatic index creation so its legacy text index can
  // be migrated before Mongoose tries to create the schema's new text index.
  await ProjectMemory.init();
  await migrateTaskTextIndex();
  await migrateProjectMemoryTextIndex();
  await migrateProjectMemoryScopes();
  await ProjectMemory.createIndexes();
  await Promise.all([Project, Feature, Task, TaskDependency, Execution, Event, TaskMessage, Conversation, ConversationType, ConversationMessage, ConversationRead, ActionProposal, DeliveryEvent, DeliveryRead, TaskRead, TaskDiff, AutomationPolicy, Runner, AutomationJob, MarkdownDocument, MarkdownRevision, ProjectMemoryRevision, ProjectMemoryProposal, Operation, Credential, Bootstrap].map(model => model.init()));
}
