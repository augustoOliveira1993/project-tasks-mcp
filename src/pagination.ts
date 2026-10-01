import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';

type CursorPayload = { v: 1; scope: string; date: string; id: string };
type PageResult<T> = { items: T[]; next: string | null };

export class PageCursorError extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scopeFor = (model: Model<any>, filter: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify([model.collection.collectionName, filter])).digest('hex');

function encode(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decode(value: string, scope: string): CursorPayload {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.scope !== scope || typeof payload.id !== 'string' || !uuid.test(payload.id) || !Number.isFinite(Date.parse(payload.date))) throw new Error();
    return payload;
  } catch {
    throw new PageCursorError('Invalid page cursor or filter mismatch');
  }
}

/** Uses timestamp keyset paging for new clients and preserves UUID cursors from older clients. */
export async function pageByDate<T>(model: Model<any>, filter: Record<string, unknown>, after: string | undefined, limit: number, dateField: 'createdAt' | 'at', legacyIdOrder = true, direction: 1 | -1 = 1): Promise<PageResult<T>> {
  const scope = scopeFor(model, { filter, dateField, direction });
  const legacy = !!after && uuid.test(after);
  const operator = direction === 1 ? '$gt' : '$lt';
  let query: Record<string, unknown> = filter;
  let sort: Record<string, 1 | -1> = { [dateField]: direction, _id: direction };
  if (after && legacy) {
    const previous = await model.findOne({ ...filter, _id: after }).select(`_id ${dateField}`).lean();
    if (!previous) throw new PageCursorError('Invalid page cursor');
    if (legacyIdOrder) {
      query = { $and: [filter, { _id: { [operator]: after } }] };
      sort = { _id: direction };
    } else {
      const date = new Date((previous as any)[dateField]);
      query = { $and: [filter, { $or: [{ [dateField]: { [operator]: date } }, { [dateField]: date, _id: { [operator]: after } }] }] };
    }
  } else if (after) {
    const cursor = decode(after, scope);
    const date = new Date(cursor.date);
    query = { $and: [filter, { $or: [{ [dateField]: { [operator]: date } }, { [dateField]: date, _id: { [operator]: cursor.id } }] }] };
  }

  const rows = await model.find(query).sort(sort).limit(limit + 1).lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  const last = rows.at(-1) as any;
  const next = !more || !last ? null : legacy && legacyIdOrder
    ? String(last._id)
    : encode({ v: 1, scope, date: new Date(last[dateField]).toISOString(), id: String(last._id) });
  return { items: rows as T[], next };
}

export async function pageByCreatedAt<T>(model: Model<any>, filter: Record<string, unknown>, after: string | undefined, limit: number): Promise<PageResult<T>> {
  return pageByDate<T>(model, filter, after, limit, 'createdAt');
}

export async function pageLatestByCreatedAt<T>(model: Model<any>, filter: Record<string, unknown>, before: string | undefined, limit: number): Promise<PageResult<T>> {
  return pageByDate<T>(model, filter, before, limit, 'createdAt', false, -1);
}
