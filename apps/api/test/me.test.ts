/**
 * Export and account deletion (F14). Deletion must be fresh-token only and
 * must never touch another user's rows; export must carry only the caller's.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUser } from '../src/db';
import { REAUTH_WINDOW_SECONDS } from '../src/routes/me';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

let h: Harness;

const CATALOG = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const FOOD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf1';

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

async function seedUser(userId: string, entryId: string, note: string): Promise<void> {
  await withUser(h.pool, userId, async (sql) => {
    await sql.query(
      `insert into log_entry (id, user_id, local_date, logged_at, tz_offset_min, meal_slot, entry_kind,
                              food_id, amount_value, amount_unit, grams, grams_provenance,
                              food_name_snapshot, nutrients_per_100g, note, updated_at)
       values ($1,$2,'2026-09-20',now(),0,'lunch','food',$3,'150','g','150','user',
               'Rice, "sticky"','{"energy_kcal":"129"}',$4,now())`,
      [entryId, userId, CATALOG, note],
    );
  });
}

beforeEach(async () => {
  await h.reset();
  await insertCatalogFood(h.pool, { id: CATALOG, name: 'Rice, cooked, NFS', energy: '129' });
  await seedUser(USER_A, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'line one\nline two');
  await seedUser(USER_B, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'b only');
  await withUser(h.pool, USER_A, (sql) =>
    sql.query(
      `insert into food (id, kind, owner_user_id, name, source_release_id, quality_tier, updated_at)
       values ($1,'custom',$2,'A granola',$3,'user',now())`,
      [FOOD_A, USER_A, h.userReleaseId],
    ),
  );
});

describe('GET /v1/me/export', () => {
  it('returns only the caller’s data, with CSV quoting for commas, quotes and newlines', async () => {
    const response = await h.request(USER_A, '/v1/me/export');
    expect(response.status).toBe(200);
    const doc = await json<{
      userId: string;
      logEntries: { note: string }[];
      customFoods: { name: string }[];
      csv: { logEntries: string };
    }>(response);

    expect(doc.userId).toBe(USER_A);
    expect(doc.logEntries).toHaveLength(1);
    expect(doc.customFoods.map((f) => f.name)).toEqual(['A granola']);
    expect(doc.csv.logEntries).not.toContain('b only');
    expect(doc.csv.logEntries).toContain('"Rice, ""sticky"""');
    expect(doc.csv.logEntries).toContain('"line one\nline two"');
  });
});

describe('DELETE /v1/me', () => {
  it('refuses a token older than the re-auth window and deletes nothing', async () => {
    const stale = Math.floor(Date.now() / 1000) - REAUTH_WINDOW_SECONDS - 60;
    const token = await h.tokenFor(USER_A, stale);
    const response = await h.app.request('/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(401);
    await withUser(h.pool, USER_A, async (sql) => {
      expect((await sql.query('select 1 from log_entry')).rowCount).toBe(1);
    });
  });

  it('removes the caller’s rows and leaves other users’ rows alone', async () => {
    const response = await h.request(USER_A, '/v1/me', { method: 'DELETE' });
    expect(response.status).toBe(204);

    await withUser(h.pool, USER_A, async (sql) => {
      expect((await sql.query('select 1 from log_entry')).rowCount).toBe(0);
      expect((await sql.query('select 1 from food where owner_user_id = $1', [USER_A])).rowCount).toBe(0);
    });
    await withUser(h.pool, USER_B, async (sql) => {
      expect((await sql.query('select 1 from log_entry')).rowCount).toBe(1);
    });
  });
});
