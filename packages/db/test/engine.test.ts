import { describe, expect, it, vi } from 'vitest';
import type { PullResponse, PushRequest, PushResponse } from '@nt/core';
import * as outbox from '../src/repositories/outbox';
import * as water from '../src/repositories/water';
import * as settings from '../src/repositories/settings';
import { CURSOR_KEY, pull, pullCursor, push, sync } from '../src/sync/engine';
import { SyncError, type Transport } from '../src/sync/transport';
import { RELEASE_ID, freshDb } from './helpers';

const options = { userSourceReleaseId: RELEASE_ID };

function fakeTransport(overrides: Partial<Transport> = {}): Transport & { push: ReturnType<typeof vi.fn>; pull: ReturnType<typeof vi.fn> } {
  return {
    push: vi.fn(async (request: PushRequest): Promise<PushResponse> => ({
      assigned: request.changes.map((c, i) => ({ table: c.table, id: c.row.id, serverRev: i + 1 })),
      cursor: 0,
    })),
    pull: vi.fn(async (): Promise<PullResponse> => ({ changes: [], nextCursor: 0, hasMore: false })),
    ...overrides,
  } as never;
}

describe('pullCursor', () => {
  it('starts at zero and ignores a corrupt stored value', () => {
    const { db } = freshDb();
    expect(pullCursor(db)).toBe(0);
    settings.setSetting(db, CURSOR_KEY, 'garbage');
    expect(pullCursor(db)).toBe(0);
    settings.setSetting(db, CURSOR_KEY, '-4');
    expect(pullCursor(db)).toBe(0);
    settings.setSetting(db, CURSOR_KEY, '42');
    expect(pullCursor(db)).toBe(42);
  });
});

describe('push', () => {
  it('sends a row edited many times once, then clears the outbox', async () => {
    const { db } = freshDb();
    const id = water.addWater(db, 250);
    water.addWater(db, 500);
    expect(outbox.pendingCount(db)).toBe(2);

    const transport = fakeTransport();
    expect(await push(db, transport)).toBe(2);
    expect(transport.push).toHaveBeenCalledTimes(1);
    const [request] = transport.push.mock.calls[0] as [PushRequest, string];
    expect(request.changes.map((c) => c.row.id)).toContain(id);
    expect(outbox.pendingCount(db)).toBe(0);
  });

  it('does nothing when the outbox is empty', async () => {
    const { db } = freshDb();
    const transport = fakeTransport();
    expect(await push(db, transport)).toBe(0);
    expect(transport.push).not.toHaveBeenCalled();
  });

  it('keeps the queue and reuses the idempotency key after a failed push', async () => {
    const { db } = freshDb();
    water.addWater(db, 250);
    const failing = fakeTransport({
      push: vi.fn(async () => {
        throw new SyncError('offline', 'down');
      }),
    });
    await expect(push(db, failing)).rejects.toMatchObject({ kind: 'offline' });
    expect(outbox.pendingCount(db)).toBe(1);

    const retry = fakeTransport();
    await push(db, retry);
    expect(retry.push.mock.calls[0]?.[1]).toBe(failing.push.mock.calls[0]?.[1]);

    water.addWater(db, 100);
    const next = fakeTransport();
    await push(db, next);
    expect(next.push.mock.calls[0]?.[1]).not.toBe(failing.push.mock.calls[0]?.[1]);
  });
});

describe('pull', () => {
  it('pages until the server has no more and stores the cursor', async () => {
    const { db } = freshDb();
    const pages: PullResponse[] = [
      { changes: [], nextCursor: 5, hasMore: true },
      { changes: [], nextCursor: 9, hasMore: false },
    ];
    const transport = fakeTransport({ pull: vi.fn(async () => pages.shift()!) });
    expect(await pull(db, transport, options)).toEqual({ pulled: 0, cursor: 9, reset: false });
    expect(transport.pull.mock.calls.map((c: unknown[]) => c[0])).toEqual([0, 5]);
    expect(pullCursor(db)).toBe(9);
  });

  it('stops at maxPages even if the server keeps saying there is more', async () => {
    const { db } = freshDb();
    const transport = fakeTransport({ pull: vi.fn(async () => ({ changes: [], nextCursor: 1, hasMore: true })) });
    await pull(db, transport, { ...options, maxPages: 3 });
    expect(transport.pull).toHaveBeenCalledTimes(3);
  });

  it('starts over from zero when the cursor has expired', async () => {
    const { db } = freshDb();
    settings.setSetting(db, CURSOR_KEY, '12');
    let first = true;
    const transport = fakeTransport({
      pull: vi.fn(async () => {
        if (first) {
          first = false;
          throw new SyncError('cursor_expired', 'purged', 410);
        }
        return { changes: [], nextCursor: 3, hasMore: false };
      }),
    });
    expect(await pull(db, transport, options)).toEqual({ pulled: 0, cursor: 3, reset: true });
    expect(transport.pull.mock.calls.map((c: unknown[]) => c[0])).toEqual([12, 0]);
  });

  it('rethrows an expired cursor when already at zero, and other errors', async () => {
    const { db } = freshDb();
    const expired = fakeTransport({ pull: vi.fn(async () => { throw new SyncError('cursor_expired', 'x', 410); }) });
    await expect(pull(db, expired, options)).rejects.toMatchObject({ kind: 'cursor_expired' });
    const offline = fakeTransport({ pull: vi.fn(async () => { throw new SyncError('offline', 'x'); }) });
    await expect(pull(db, offline, options)).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('sync', () => {
  it('pushes before it pulls and reports both counts', async () => {
    const { db } = freshDb();
    water.addWater(db, 250);
    const order: string[] = [];
    const transport = fakeTransport({
      push: vi.fn(async (request: PushRequest) => {
        order.push('push');
        return { assigned: request.changes.map((c) => ({ table: c.table, id: c.row.id, serverRev: 1 })), cursor: 1 };
      }),
      pull: vi.fn(async () => {
        order.push('pull');
        return { changes: [], nextCursor: 2, hasMore: false };
      }),
    });
    expect(await sync(db, transport, options)).toEqual({ pushed: 1, pulled: 0, cursor: 2, reset: false });
    expect(order).toEqual(['push', 'pull']);
  });
});
