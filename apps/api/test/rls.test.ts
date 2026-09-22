/**
 * Row-level security is the second layer behind the auth middleware (spec
 * 2.12). These tests talk to Postgres directly as the API's role, so they fail
 * if a policy is wrong even when every handler is correct.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUser, withService } from '../src/db';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

let h: Harness;

const ENTRY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const FOOD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf1';
const CATALOG = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

beforeEach(async () => {
  await h.reset();
  await insertCatalogFood(h.pool, { id: CATALOG, name: 'Rice, cooked, NFS', energy: '129' });

  // Everything user A owns, written as user A through the API's role.
  await withUser(h.pool, USER_A, async (sql) => {
    await sql.query(
      `insert into log_entry (id, user_id, local_date, logged_at, tz_offset_min, meal_slot, entry_kind,
                              food_id, amount_value, amount_unit, grams, grams_provenance,
                              food_name_snapshot, nutrients_per_100g, updated_at)
       values ($1,$2,'2026-09-20',now(),0,'lunch','food',$3,'150','g','150','user','Rice','{"energy_kcal":"129"}',now())`,
      [ENTRY_A, USER_A, CATALOG],
    );
    await sql.query(
      `insert into food (id, kind, owner_user_id, name, source_release_id, quality_tier, updated_at)
       values ($1,'custom',$2,'A''s granola',$3,'user',now())`,
      [FOOD_A, USER_A, h.userReleaseId],
    );
    await sql.query(`insert into water_entry (id, user_id, local_date, logged_at, amount_ml, updated_at)
                     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',$1,'2026-09-20',now(),250,now())`, [USER_A]);
  });
});

describe('user B cannot read user A', () => {
  it('sees none of A’s entries, water or custom foods', async () => {
    await withUser(h.pool, USER_B, async (sql) => {
      expect((await sql.query('select * from log_entry')).rowCount).toBe(0);
      expect((await sql.query('select * from water_entry')).rowCount).toBe(0);
      expect((await sql.query(`select * from food where kind = 'custom'`)).rowCount).toBe(0);
    });
  });

  it('cannot reach a specific row of A’s by id', async () => {
    await withUser(h.pool, USER_B, async (sql) => {
      expect((await sql.query('select * from log_entry where id = $1', [ENTRY_A])).rowCount).toBe(0);
      expect((await sql.query('select * from food where id = $1', [FOOD_A])).rowCount).toBe(0);
    });
  });

  it('still sees the shared catalog', async () => {
    await withUser(h.pool, USER_B, async (sql) => {
      expect((await sql.query('select * from food where id = $1', [CATALOG])).rowCount).toBe(1);
      expect((await sql.query('select * from food_nutrient where food_id = $1', [CATALOG])).rowCount).toBe(1);
    });
  });

  it('cannot read the nutrients or portions of A’s custom food', async () => {
    await withUser(h.pool, USER_A, async (sql) => {
      await sql.query(`insert into food_nutrient (food_id, nutrient_code, amount_per_100g, derivation)
                       values ($1,'energy_kcal','450','reported')`, [FOOD_A]);
    });
    await withUser(h.pool, USER_B, async (sql) => {
      expect((await sql.query('select * from food_nutrient where food_id = $1', [FOOD_A])).rowCount).toBe(0);
    });
  });
});

describe('user B cannot write user A', () => {
  it('cannot update or delete A’s rows', async () => {
    await withUser(h.pool, USER_B, async (sql) => {
      expect((await sql.query(`update log_entry set note = 'tampered' where id = $1`, [ENTRY_A])).rowCount).toBe(0);
      expect((await sql.query('delete from log_entry where id = $1', [ENTRY_A])).rowCount).toBe(0);
      expect((await sql.query(`update food set name = 'stolen' where id = $1`, [FOOD_A])).rowCount).toBe(0);
    });
    await withUser(h.pool, USER_A, async (sql) => {
      const { rows } = await sql.query('select note from log_entry where id = $1', [ENTRY_A]);
      expect(rows[0].note).toBeNull();
    });
  });

  it('cannot insert a row belonging to A', async () => {
    await expect(
      withUser(h.pool, USER_B, async (sql) => {
        await sql.query(
          `insert into log_entry (id, user_id, local_date, logged_at, tz_offset_min, meal_slot, entry_kind,
                                  amount_value, amount_unit, grams_provenance, food_name_snapshot,
                                  nutrients_absolute, updated_at)
           values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',$1,'2026-09-20',now(),0,'lunch','quick_add',
                   '100','kcal','user','Planted','{"energy_kcal":"100"}',now())`,
          [USER_A],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot write into the shared catalog', async () => {
    await expect(
      withUser(h.pool, USER_B, async (sql) => {
        await sql.query(
          `insert into food (id, kind, owner_user_id, name, source_release_id, quality_tier)
           values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1','generic',null,'Fake catalog food',$1,'lab')`,
          [h.userReleaseId],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('the API role cannot bypass policies', () => {
  it('is neither superuser nor the table owner', async () => {
    await withService(h.pool, async (sql) => {
      const { rows } = await sql.query(
        `select rolsuper, rolbypassrls from pg_roles where rolname = 'app_api'`,
      );
      expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    });
  });

  it('sees nothing at all when no user is set', async () => {
    const client = await h.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role app_api');
      expect((await client.query('select * from log_entry')).rowCount).toBe(0);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('has row level security enabled on every user table', async () => {
    await withService(h.pool, async (sql) => {
      const { rows } = await sql.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class
         where relname in ('log_entry','water_entry','water_preset','goal_profile','user_settings',
                           'idempotency_key','sync_watermark','food','food_nutrient','food_portion')`,
      );
      expect(rows).toHaveLength(10);
      for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true);
    });
  });
});

describe('the API surface respects the same boundary', () => {
  it('does not return A’s data to B through sync pull', async () => {
    const res = await h.request(USER_B, '/v1/sync/pull?cursor=0');
    expect(res.status).toBe(200);
    expect((await json<{ changes: unknown[] }>(res)).changes).toEqual([]);
  });

  it('does not let B fetch A’s custom food by id', async () => {
    expect((await h.request(USER_B, `/v1/foods/${FOOD_A}`)).status).toBe(404);
    expect((await h.request(USER_A, `/v1/foods/${FOOD_A}`)).status).toBe(200);
  });

  it('does not surface A’s custom food in B’s search', async () => {
    const { results } = await json<{ results: unknown[] }>(await h.request(USER_B, '/v1/foods/search?q=granola'));
    expect(results).toEqual([]);
  });
});
