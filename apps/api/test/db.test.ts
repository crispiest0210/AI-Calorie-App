import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withService, withUser } from '../src/db';
import { remember, replay } from '../src/idempotency';
import { startHarness, USER_A, USER_B, type Harness } from './harness';

describe('withUser', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  it('declares the caller and runs as the non-owner role inside the transaction', async () => {
    const seen = await withUser(h.pool, USER_A, async (sql) => {
      const { rows } = await sql.query<{ uid: string; role: string }>(
        `select current_setting('app.user_id') as uid, current_user as role`,
      );
      return rows[0];
    });
    expect(seen).toEqual({ uid: USER_A, role: 'app_api' });
  });

  it('does not leak one caller\'s identity to the next use of the same pooled connection', async () => {
    await withUser(h.pool, USER_A, async () => undefined);
    const after = await withUser(h.pool, USER_B, async (sql) => {
      const { rows } = await sql.query<{ uid: string }>(`select current_setting('app.user_id') as uid`);
      return rows[0]?.uid;
    });
    expect(after).toBe(USER_B);
    const bare = await withService(h.pool, async (sql) => {
      const { rows } = await sql.query<{ uid: string | null }>(`select current_setting('app.user_id', true) as uid`);
      return rows[0]?.uid;
    });
    expect(bare === null || bare === '').toBe(true);
  });

  it('rolls back everything and rethrows when the work fails', async () => {
    await expect(
      withUser(h.pool, USER_A, async (sql) => {
        await remember(sql, USER_A, 'rolled-back', { ok: 1 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withUser(h.pool, USER_A, (sql) => replay(sql, USER_A, 'rolled-back'))).toBeNull();
  });

  it('releases the connection after success and after failure', async () => {
    const before = h.pool.totalCount;
    await withUser(h.pool, USER_A, async () => undefined);
    await withUser(h.pool, USER_A, async () => {
      throw new Error('x');
    }).catch(() => undefined);
    expect(h.pool.waitingCount).toBe(0);
    expect(h.pool.idleCount).toBe(h.pool.totalCount);
    expect(h.pool.totalCount).toBeGreaterThanOrEqual(before);
  });
});

describe('type parsers', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  it('returns numeric as an exact string and int8 as a number', async () => {
    const { rows } = await withService(h.pool, (sql) =>
      sql.query<{ n: unknown; big: unknown }>(`select 0.1::numeric + 0.2::numeric as n, 42::int8 as big`),
    );
    expect(rows[0]).toEqual({ n: '0.3', big: 42 });
  });
});
