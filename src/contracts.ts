export type ContextMeta = {
  version: 1;
  maxBytes: number;
  payloadBytes: number;
  truncatedFields: string[];
};

export type TaskMessageDto = {
  _id: string;
  projectId: string;
  taskId: string;
  relatedTaskId?: string;
  executionId?: string;
  author: string;
  type: string;
  message: string;
  references: string[];
  createdAt: Date;
  conversationId?: string;
  replyTo?: string;
};

/** Body returned by list_task_messages; messageId lookups return one complete, task-scoped item. */
export type ListTaskMessagesDto = {
  items: TaskMessageDto[];
  events: unknown[];
  next: string | null;
  messageCursor: string | null;
  eventCursor?: string | null;
};

export type TaskContextDto = {
  contextMeta: ContextMeta;
  task: {
    _id: string;
    projectId: string;
    version: number;
    archived: boolean;
    featureId: string | null;
    name: string;
    instructions: string;
    acceptance: string[];
    acceptanceProgress: boolean[];
    acceptanceEvidence: Array<string | null>;
    priority: number;
    area: string;
    type: string;
    repositoryId: string;
    dependencies: string[];
    status: string;
    statusHistory: Array<{ status: string; startedAt: Date; endedAt: Date | null; durationMs: number }>;
    executionId: string | null;
    responsible: string | null;
    checked: boolean;
    leaseUntil?: Date | null;
    checkedBy: string | null;
    checkedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  project: ProjectContextDto;
  feature: { _id: string; version: number; name: string; objective: string; context: string; acceptance: string[] } | null;
  repository: { id: string; name: string; url: string; instructions: string } | null;
  memories: {
    items: Array<{ memoryId: string; title: string; category: string; revision: number; status: 'active'; rank: number; snippet: string; sources: Array<Record<string, unknown>> }>;
    hasMore: boolean;
    potentialConflicts: Array<Record<string, unknown>>;
    notice: string;
    loadFullContentTool: 'get_project_memory';
    searchTool: 'search_project_memories';
  };
  markdowns: { task: { items: Array<Record<string, unknown>>; next: string | null }; feature: { items: Array<Record<string, unknown>>; next: string | null } };
  messages: Array<{ _id: string; taskId: string; relatedTaskId?: string; author: string; authorType: 'human' | 'agent' | 'unknown'; clientName: string | null; type: string; message: string; references: string[]; createdAt: Date; conversationId?: string; replyTo?: string; /** Retrieve the full body with list_task_messages and this messageId. */ truncated?: boolean }>;
  dependencies: Array<{ _id: string; name: string; status: string; area: string; type: string; execution: { _id: string; status: string; result?: { summary?: string; evidence?: string[] } } | null }>;
  executions: Array<{ _id: string; status: string; startedAt: Date; endedAt?: Date; impediments?: string[]; result?: { summary?: string; evidence?: string[] } }>;
};

export type ProjectContextDto = {
  _id: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
};
