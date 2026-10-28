/**
 * Export and account deletion (F14) at the API boundary: the export carries
 * only the caller's rows and is safe to open in a spreadsheet, and deleting an
 * account leaves every other user's data alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUser } from '../src/db';
import { REAUTH_WINDOW_SECONDS } from '../src/routes/me';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

let h: Harness;

const CATALOG = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const ENTRY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ENTRY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

interface ExportDoc {
  userId: string;
  logEntries: { id: string }[];
  userSettings: { user_id: string; units: string }[];
  csv: { logEntries: string };
}

async function addEntry(userId: string, id: string, foodName: string, note: string | null): Promise<void> {
  await withUser(h.pool, userId, async (sql) => {
    await sql.query(
      `insert into log_entry (id, user_id, local_date, logged_at, tz_offset_min, meal_slot, entry_kind,
                              food_id, amount_value, amount_unit, grams, grams_provenance,
                              food_name_snapshot, nutrients_per_100g, note, updated_at)
       values ($1,$2,'2026-09-20',now(),0,'lunch','food',$3,'150','g','150','user',$4,'{"energy_kcal":"129"}',$5,now())`,
      [id, userId, CATALOG, foodName, note],
    );
  });
}

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

beforeEach(async () => {
  await h.reset();
  await insertCatalogFood(h.pool, { id: CATALOG, name: 'Rice, cooked, NFS', energy: '129' });
});

describe('GET /v1/me/export', () => {
  it('contains only the caller’s rows', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice', null);
    await addEntry(USER_B, ENTRY_B, 'Pasta', null);

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.userId).toBe(USER_A);
    expect(doc.logEntries.map((row) => row.id)).toEqual([ENTRY_A]);
    expect(doc.csv.logEntries).not.toContain('Pasta');
  });

  it('includes the caller’s settings but not another user’s', async () => {
    for (const [user, units] of [[USER_A, 'imperial'], [USER_B, 'metric']] as const) {
      await withUser(h.pool, user, (sql) => sql.query('insert into user_settings (user_id, units) values ($1, $2)', [user, units]));
    }

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.userSettings.map((row) => [row.user_id, row.units])).toEqual([[USER_A, 'imperial']]);
  });

  it('quotes CSV fields that contain commas, quotes or newlines', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice, cooked "NFS"', 'line one\nline two');

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.csv.logEntries).toContain('"Rice, cooked ""NFS"""');
    expect(doc.csv.logEntries).toContain('"line one\nline two"');
  });

  it('quotes CSV fields that contain a carriage return', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice', 'line one\rline two');

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.csv.logEntries).toContain('"line one\rline two"');
  });
});

describe('GET /v1/me/export deleted entries', () => {
  it('keeps a soft-deleted entry in the JSON but not in the CSV', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice', null);
    await addEntry(USER_A, ENTRY_B, 'Pasta', null);
    await withUser(h.pool, USER_A, (sql) => sql.query('update log_entry set deleted_at = now() where id = $1', [ENTRY_B]));

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.logEntries.map((row) => row.id).sort()).toEqual([ENTRY_A, ENTRY_B].sort());
    expect(doc.csv.logEntries).toContain('Rice');
    expect(doc.csv.logEntries).not.toContain('Pasta');
  });
});

describe('GET /v1/me/export CSV formula safety', () => {
  it('prefixes user text that a spreadsheet would run as a formula', async () => {
    await addEntry(USER_A, ENTRY_A, '=HYPERLINK("http://x")', '@SUM(A1)');

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.csv.logEntries).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(doc.csv.logEntries).toContain(`'@SUM(A1)`);
  });
});

describe('DELETE /v1/me', () => {
  it('removes the caller’s data and leaves other users’ untouched', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice', null);
    await addEntry(USER_B, ENTRY_B, 'Pasta', null);

    const res = await h.request(USER_A, '/v1/me', { method: 'DELETE' });
    expect(res.status).toBe(204);

    const remaining = await h.pool.query('select id from log_entry');
    expect(remaining.rows.map((row) => row.id)).toEqual([ENTRY_B]);
  });

  it('also clears settings, so a deleted account leaves nothing in the export', async () => {
    await withUser(h.pool, USER_A, (sql) => sql.query('insert into user_settings (user_id, units) values ($1, $2)', [USER_A, 'imperial']));
    await withUser(h.pool, USER_B, (sql) => sql.query('insert into user_settings (user_id, units) values ($1, $2)', [USER_B, 'metric']));

    await h.request(USER_A, '/v1/me', { method: 'DELETE' });

    const remaining = await h.pool.query('select user_id from user_settings');
    expect(remaining.rows.map((row) => row.user_id)).toEqual([USER_B]);
  });

  it('refuses a token older than the re-auth window and deletes nothing', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice', null);
    const staleIat = Math.floor(Date.now() / 1000) - REAUTH_WINDOW_SECONDS - 60;
    const token = await h.tokenFor(USER_A, staleIat);

    const res = await h.app.request('/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });

    expect(res.status).toBe(401);
    const remaining = await h.pool.query('select id from log_entry');
    expect(remaining.rows.map((row) => row.id)).toEqual([ENTRY_A]);
  });
});
