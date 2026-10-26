import { describe, expect, it } from 'vitest';
import { clear, clearFor, enqueue, pending, pendingCount } from '../src/repositories/outbox';
import { freshDb } from './helpers';

describe('outbox', () => {
  it('lists pending rows in enqueue order with the given timestamp', () => {
    const { db } = freshDb();
    enqueue(db, 'log_entry', 'b', 'upsert', 10);
    enqueue(db, 'water_entry', 'a', 'delete', 20);
    expect(pending(db).map((r) => [r.tableName, r.rowId, r.op, r.createdAt])).toEqual([
      ['log_entry', 'b', 'upsert', 10],
      ['water_entry', 'a', 'delete', 20],
    ]);
  });

  it('counts pending rows and caps a page at the limit', () => {
    const { db } = freshDb();
    expect(pendingCount(db)).toBe(0);
    for (const id of ['a', 'b', 'c']) enqueue(db, 'food', id, 'upsert');
    expect(pendingCount(db)).toBe(3);
    expect(pending(db, 2).map((r) => r.rowId)).toEqual(['a', 'b']);
  });

  it('clears only the given sequence numbers and ignores an empty list', () => {
    const { db } = freshDb();
    for (const id of ['a', 'b', 'c']) enqueue(db, 'food', id, 'upsert');
    const rows = pending(db);
    clear(db, []);
    expect(pendingCount(db)).toBe(3);
    clear(db, [rows[0]!.seq, rows[2]!.seq]);
    expect(pending(db).map((r) => r.rowId)).toEqual(['b']);
  });

  it('clears every queued op for one row without touching the same id in another table', () => {
    const { db } = freshDb();
    enqueue(db, 'log_entry', 'x', 'upsert');
    enqueue(db, 'log_entry', 'x', 'delete');
    enqueue(db, 'log_entry', 'y', 'upsert');
    enqueue(db, 'water_entry', 'x', 'upsert');
    clearFor(db, 'log_entry', 'x');
    expect(pending(db).map((r) => [r.tableName, r.rowId])).toEqual([
      ['log_entry', 'y'],
      ['water_entry', 'x'],
    ]);
  });
});
