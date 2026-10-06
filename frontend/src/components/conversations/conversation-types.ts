export type Conversation = { _id: string; projectId: string; taskId: string | null; title: string; status: string; version: number; updatedAt?: string; lastMessageAt?: string | null; unread?: { count: number; cursor: string | null } };
export type Message = { _id: string; author: string; authorType: 'human' | 'agent'; clientName?: string | null; content: string; createdAt: string };
export type Proposal = {
  _id: string; taskId: string; expectedTaskVersion: number; title: string; summary: string;
  taskPatch: { instructions?: string; acceptance?: string[] }; status: string; version: number; stale: boolean;
  jobId?: string | null; createdBy?: string; createdAt?: string; approvedBy?: string | null; approvedAt?: string | null;
};
export type ConversationJob = { _id: string; status: string; failed: boolean; permissionTitle: string | null };
export type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  next?: string | null;
  proposals: Proposal[];
  task: { _id: string; version: number; status: string; name: string; area?: string; featureId?: string | null } | null;
  jobs: ConversationJob[];
};
export type ConversationPage = { items: Conversation[]; next?: string | null };
export type TaskOption = { _id: string; name: string; status: string; area?: string; featureId?: string | null };
export type Feature = { _id: string; name: string };
export type TaskActivity = {
  task: { _id: string; version: number; status: string; acceptance: string[]; acceptanceProgress: boolean[]; acceptanceEvidence: Array<string | null> };
  messages: Array<{ _id: string; type: string; author: string; authorType: 'human' | 'agent' | 'unknown'; clientName: string | null; message: string; createdAt: string }>;
  executions: Array<{ _id: string; status: string; startedAt: string; result?: { summary?: string; evidence?: string[] } }>;
};
