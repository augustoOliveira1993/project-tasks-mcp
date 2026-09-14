import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { DeliveryEvent, Project } from './db.js';

export type EventFilter = { projectId: string; taskIds?: string[]; actions?: string[] };
const fingerprint = (f: EventFilter) => createHash('sha256').update(JSON.stringify([f.projectId, [...new Set(f.taskIds ?? [])].sort(), [...new Set(f.actions ?? [])].sort()])).digest('hex');
export function eventCursor(filter: EventFilter, sequence: number) {
  return Buffer.from(JSON.stringify({ v: 1, scope: fingerprint(filter), sequence })).toString('base64url');
}
export function cursorSequence(cursor: string, filter: EventFilter) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (value.v !== 1 || value.scope !== fingerprint(filter) || !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error();
    return value.sequence as number;
  } catch { throw new Error('Invalid event cursor or filter mismatch'); }
}

// Change streams only wake readers. Durable sequence queries are authoritative.
export class EventHub {
  private stream: ReturnType<typeof DeliveryEvent.watch> | undefined;
  private listeners = new Set<(event?: any) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  get closed() { return this.stopped; }
  start() {
    if (this.stream) return;
    this.stopped = false;
    mongoose.connection.once('disconnected', this.disconnected);
    this.stream = DeliveryEvent.watch([{ $match: { operationType: 'insert' } }]);
    this.stream.on('change', change => { if ('fullDocument' in change) this.wake(change.fullDocument); });
    this.stream.on('error', () => {
      const stream = this.stream; this.stream = undefined;
      void stream?.close().catch(() => undefined);
      this.wake();
      mongoose.connection.removeListener('disconnected', this.disconnected);
      if (!this.stopped && mongoose.connection.readyState === 1) { this.timer = setTimeout(() => this.start(), 1000); this.timer.unref(); }
    });
  }
  private disconnected = () => { void this.close().catch(() => undefined); };
  on(listener: (event?: any) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private wake(event?: any) { for (const listener of this.listeners) listener(event); }
  wait(filter: EventFilter, timeout: number) {
    let dispose = () => {}; let cancel = () => {};
    const promise = new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); dispose(); resolve(); };
      const timer = setTimeout(done, timeout);
      cancel = done;
      dispose = this.on(event => { if (!event || event.projectId === filter.projectId && (!filter.taskIds?.length || event.taskIds.some((id: string) => filter.taskIds!.includes(id))) && (!filter.actions?.length || filter.actions.includes(event.action))) done(); });
    });
    return { promise, cancel };
  }
  async close() { this.stopped = true; clearTimeout(this.timer); mongoose.connection.removeListener('disconnected', this.disconnected); this.wake(); this.listeners.clear(); await this.stream?.close(); this.stream = undefined; }
}

export async function readEvents(filter: EventFilter, cursor: string | undefined, limit: number, latest = false) {
  const project = await Project.findById(filter.projectId).select('eventSequence').lean();
  const head = project?.eventSequence ?? 0;
  const after = cursor ? cursorSequence(cursor, filter) : latest ? head : 0;
  if (after > head) throw new Error('Event cursor is ahead of project');
  const rows = await DeliveryEvent.find({ projectId: filter.projectId, sequence: { $gt: after, $lte: head }, ...(filter.taskIds?.length ? { taskIds: { $in: filter.taskIds } } : {}), ...(filter.actions?.length ? { action: { $in: filter.actions } } : {}) }).sort({ sequence: 1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, cursor: eventCursor(filter, hasMore ? rows.at(-1)!.sequence! : head), hasMore };
}
