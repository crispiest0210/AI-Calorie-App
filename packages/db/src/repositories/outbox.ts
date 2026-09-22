/**
 * Every user-data write records itself here in the *same transaction* as the
 * row it describes (spec 2.10). Phase 1 never drains the queue — it exists so
 * that nothing logged offline today is invisible to sync when it arrives.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { outbox } from '../schema';
import type { Writer } from '../db';

export const SYNCED_TABLES = ['log_entry', 'water_entry', 'water_preset', 'goal_profile', 'goal_target', 'food', 'recipe_ingredient'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export function enqueue(tx: Writer, tableName: SyncedTable, rowId: string, op: 'upsert' | 'delete', now = Date.now()): void {
  tx.insert(outbox).values({ tableName, rowId, op, createdAt: now }).run();
}

export function pending(db: Writer, limit = 200) {
  return db.select().from(outbox).orderBy(asc(outbox.seq)).limit(limit).all();
}

export function pendingCount(db: Writer): number {
  return db.select().from(outbox).all().length;
}

export function clear(db: Writer, seqs: readonly number[]): void {
  if (seqs.length === 0) return;
  db.delete(outbox).where(inArray(outbox.seq, [...seqs])).run();
}

export function clearFor(db: Writer, tableName: SyncedTable, rowId: string): void {
  db.delete(outbox).where(and(eq(outbox.tableName, tableName), eq(outbox.rowId, rowId))).run();
}
