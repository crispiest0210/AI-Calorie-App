/**
 * The sync loop (spec 2.10): drain the outbox, then pull everything above the
 * cursor. Push runs first so our own pending edits are already on the server
 * before the server's view is applied over the top — otherwise an unpushed
 * local change would be clobbered by its own older copy.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { MAX_PUSH_ROWS, uuidv7, type SyncRow, type SyncedTable } from '@nt/core';
import { food, goalProfile, logEntry, outbox, waterEntry, waterPreset } from '../schema';
import type { Db, Writer } from '../db';
import { getSetting, setSetting } from '../repositories/settings';
import { serializeRow } from './serialize';
import { applyRow, type ApplyContext } from './apply';
import { SyncError, type Transport } from './transport';

export const CURSOR_KEY = 'sync.pull_cursor';
const IDEMPOTENCY_KEY = 'sync.push_idempotency_key';

export interface SyncResult {
  pushed: number;
  pulled: number;
  cursor: number;
  /** True when the server asked us to start over (tombstones were purged). */
  reset: boolean;
}

export function pullCursor(db: Db): number {
  const raw = getSetting(db, CURSOR_KEY);
  const value = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function setPullCursor(db: Db, cursor: number): void {
  setSetting(db, CURSOR_KEY, String(cursor));
}

/**
 * Sends pending rows. The idempotency key is kept until the push succeeds, so
 * a retry after a dropped connection replays rather than double-applies (4.1).
 */
export async function push(db: Db, transport: Transport): Promise<number> {
  let pushed = 0;

  for (;;) {
    const queued = db.select().from(outbox).orderBy(asc(outbox.seq)).limit(MAX_PUSH_ROWS).all();
    if (queued.length === 0) return pushed;

    // One payload per row: a row edited three times offline is sent once, in
    // its current state, because that is all the server needs.
    const seen = new Set<string>();
    const changes: SyncRow[] = [];
    const sentSeqs = queued.map((record) => record.seq);
    for (const record of queued) {
      const key = `${record.tableName}:${record.rowId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = serializeRow(db, record.tableName as SyncedTable, record.rowId);
      if (row !== null) changes.push(row);
    }

    // Everything queued has since been hard-deleted or is not syncable.
    if (changes.length === 0) {
      db.delete(outbox).where(inArray(outbox.seq, sentSeqs)).run();
      continue;
    }

    // The key is stored before the request and cleared only after it succeeds,
    // so a retry after a dropped connection replays the stored response rather
    // than applying the batch twice (spec 4.1).
    const idempotencyKey = getSetting(db, IDEMPOTENCY_KEY) || uuidv7();
    setSetting(db, IDEMPOTENCY_KEY, idempotencyKey);

    const response = await transport.push({ changes }, idempotencyKey);

    db.transaction((tx) => {
      tx.delete(outbox).where(inArray(outbox.seq, sentSeqs)).run();
      for (const assigned of response.assigned) applyServerRev(tx, assigned);
    });
    setSetting(db, IDEMPOTENCY_KEY, '');
    pushed += response.assigned.length;
  }
}

/** Records the revision the server gave a row we just pushed. */
function applyServerRev(tx: Writer, assigned: { table: SyncedTable; id: string; serverRev: number }): void {
  const table =
    assigned.table === 'log_entry' ? logEntry
    : assigned.table === 'water_entry' ? waterEntry
    : assigned.table === 'water_preset' ? waterPreset
    : assigned.table === 'goal_profile' ? goalProfile
    : food;
  tx.update(table).set({ serverRev: assigned.serverRev }).where(eq(table.id, assigned.id)).run();
}

export interface SyncOptions extends ApplyContext {
  /** Pages until the server says there is nothing left. */
  maxPages?: number;
}

export async function pull(db: Db, transport: Transport, options: SyncOptions): Promise<{ pulled: number; cursor: number; reset: boolean }> {
  let cursor = pullCursor(db);
  let pulled = 0;
  let reset = false;
  const maxPages = options.maxPages ?? 50;

  for (let page = 0; page < maxPages; page += 1) {
    let response;
    try {
      response = await transport.pull(cursor);
    } catch (error) {
      // The device was offline longer than the tombstone window, so the
      // deletions it missed no longer exist to be replayed: start over (2.10).
      if (error instanceof SyncError && error.kind === 'cursor_expired' && cursor !== 0) {
        cursor = 0;
        reset = true;
        continue;
      }
      throw error;
    }

    db.transaction((tx) => {
      for (const change of response.changes) applyRow(tx, change, options);
    });
    pulled += response.changes.length;
    cursor = response.nextCursor;
    setPullCursor(db, cursor);
    if (!response.hasMore) break;
  }

  return { pulled, cursor, reset };
}

export async function sync(db: Db, transport: Transport, options: SyncOptions): Promise<SyncResult> {
  const pushed = await push(db, transport);
  const pulledResult = await pull(db, transport, options);
  return { pushed, ...pulledResult };
}
