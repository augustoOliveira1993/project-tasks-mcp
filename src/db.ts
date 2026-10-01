import mongoose from 'mongoose';
import {
  ActionProposal, AutomationJob, AutomationPolicy, Bootstrap, Conversation, ConversationMessage, Credential,
  DeliveryEvent, DeliveryRead, Event, Execution, Feature, MarkdownDocument, MarkdownRevision, Operation,
  Project, Runner, Task, TaskDependency, TaskDiff, TaskMessage, TaskRead
} from './models.js';

export * from './models.js';

export async function connect(uri: string) {
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('MongoDB replica set required');
  await Promise.all([Project, Feature, Task, TaskDependency, Execution, Event, TaskMessage, Conversation, ConversationMessage, ActionProposal, DeliveryEvent, DeliveryRead, TaskRead, TaskDiff, AutomationPolicy, Runner, AutomationJob, MarkdownDocument, MarkdownRevision, Operation, Credential, Bootstrap].map(model => model.init()));
}
