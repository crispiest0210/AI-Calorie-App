/**
 * Export and account deletion (F14) at the API boundary: the export carries
 * only the caller's rows and is safe to open in a spreadsheet, and deleting an
 * account leaves every other user's data alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUser } from '../src/db';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

let h: Harness;

const CATALOG = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const ENTRY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ENTRY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

interface ExportDoc {
  userId: string;
  logEntries: { id: string }[];
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

  it('quotes CSV fields that contain commas, quotes or newlines', async () => {
    await addEntry(USER_A, ENTRY_A, 'Rice, cooked "NFS"', 'line one\nline two');

    const doc = await json<ExportDoc>(await h.request(USER_A, '/v1/me/export'));

    expect(doc.csv.logEntries).toContain('"Rice, cooked ""NFS"""');
    expect(doc.csv.logEntries).toContain('"line one\nline two"');
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
});
