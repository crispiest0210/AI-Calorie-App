import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withService, withUser } from '../src/db';
import { remember, replay } from '../src/idempotency';
import { startHarness, USER_A, USER_B, type Harness } from './harness';

describe('idempotency store', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });
  beforeEach(async () => {
    await h.reset();
  });

  it('replays the stored response for the same user and key', async () => {
    await withUser(h.pool, USER_A, (sql) => remember(sql, USER_A, 'k1', { ok: 1 }));
    expect(await withUser(h.pool, USER_A, (sql) => replay(sql, USER_A, 'k1'))).toEqual({ ok: 1 });
  });

  it('returns null for an unknown key, and ignores a missing or empty key', async () => {
    await withUser(h.pool, USER_A, async (sql) => {
      expect(await replay(sql, USER_A, 'nope')).toBeNull();
      expect(await replay(sql, USER_A, undefined)).toBeNull();
      expect(await replay(sql, USER_A, '')).toBeNull();
      await remember(sql, USER_A, undefined, { ok: 1 });
      await remember(sql, USER_A, '', { ok: 1 });
    });
    await withService(h.pool, async (sql) => {
      const { rows } = await sql.query('select count(*)::int as n from idempotency_key');
      expect(rows[0].n).toBe(0);
    });
  });

  it('does not replay one user\'s response to another user', async () => {
    await withUser(h.pool, USER_A, (sql) => remember(sql, USER_A, 'shared', { owner: 'a' }));
    expect(await withUser(h.pool, USER_B, (sql) => replay(sql, USER_B, 'shared'))).toBeNull();
  });

  it('stops replaying after the 24 hour window', async () => {
    await withUser(h.pool, USER_A, (sql) => remember(sql, USER_A, 'old', { ok: 1 }));
    await withService(h.pool, (sql) =>
      sql.query(`update idempotency_key set created_at = now() - interval '25 hours' where key = 'old'`),
    );
    expect(await withUser(h.pool, USER_A, (sql) => replay(sql, USER_A, 'old'))).toBeNull();
  });

  it('overwrites the response and restarts the window when a key is remembered again', async () => {
    await withUser(h.pool, USER_A, (sql) => remember(sql, USER_A, 'k', { v: 1 }));
    await withService(h.pool, (sql) =>
      sql.query(`update idempotency_key set created_at = now() - interval '25 hours' where key = 'k'`),
    );
    await withUser(h.pool, USER_A, (sql) => remember(sql, USER_A, 'k', { v: 2 }));
    expect(await withUser(h.pool, USER_A, (sql) => replay(sql, USER_A, 'k'))).toEqual({ v: 2 });
  });
});
