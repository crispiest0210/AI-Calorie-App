/**
 * Phase 2 exit criterion: "two devices show identical totals after offline
 * edits on both".
 *
 * Two real SQLite clients, each with its own outbox and cursor, talk to the
 * real API over an in-process transport backed by real Postgres. Nothing here
 * is mocked except the socket.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NUTRIENT_CODES,
  NUTRIENT_DEFS,
  dayTotals,
  localDateOf,
  pullResponse,
  pushResponse,
  totalOf,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@nt/core';
import {
  applyPragmas,
  entries as entriesRepo,
  foods as foodsRepo,
  goals as goalsRepo,
  outboxRepo,
  readDay,
  runMigrations,
  schema,
  sync as syncClient,
  water as waterRepo,
  type Db,
  type RawSqlite,
} from '@nt/db';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

interface ExportDoc {
  logEntries: Record<string, unknown>[];
  waterEntries: unknown[];
  goalProfiles: unknown[];
  csv: { logEntries: string };
}

let h: Harness;

const RICE = { energy_kcal: '129', protein_g: '2.7', carb_g: '28', fat_g: '0.3', fiber_g: '0.4', sodium_mg: '1' };
const CHICKEN = { energy_kcal: '165', protein_g: '31', carb_g: '0', fat_g: '3.6', fiber_g: '0', sodium_mg: '74' };
const RICE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const CHICKEN_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const USER_RELEASE = '00000000-0000-4000-8000-000000000001';
// The device's own catalog release. The server stores it as an opaque
// reference, because the bundled catalog is versioned separately from the
// server's copy and the point is to record which release a snapshot came from.
const FDC_RELEASE = '00000000-0000-4000-8000-000000000002';

/** A device: its own SQLite file, its own outbox, its own pull cursor. */
function newDevice(): Db {
  const sqlite = new Database(':memory:');
  const raw: RawSqlite = {
    execute: (s) => {
      sqlite.exec(s);
    },
    select: (s) => sqlite.prepare(s).all() as never[],
  };
  applyPragmas(raw);
  runMigrations(raw);
  const db = drizzle(sqlite, { schema }) as unknown as Db;

  // The catalog ships with the app, so both devices already have these.
  for (const code of NUTRIENT_CODES) {
    const def = NUTRIENT_DEFS[code];
    db.insert(schema.nutrientDef)
      .values({ code, displayName: def.displayName, unit: def.unit, fdcNutrientIds: JSON.stringify(def.fdcNutrientIds), sortOrder: def.sortOrder })
      .run();
  }
  db.insert(schema.sourceRelease)
    .values([
      { id: USER_RELEASE, provider: 'user', dataset: 'custom', version: '1', importedAt: 0, isActive: 1 },
      { id: FDC_RELEASE, provider: 'fdc', dataset: 'test', version: '1', importedAt: 0, isActive: 1 },
    ])
    .run();
  for (const [id, name, nutrients] of [
    [RICE_ID, 'Rice, cooked, NFS', RICE],
    [CHICKEN_ID, 'Chicken breast, roasted', CHICKEN],
  ] as const) {
    db.insert(schema.food)
      .values({ id, kind: 'generic', name, brand: null, gtin: null, sourceReleaseId: FDC_RELEASE, sourceRef: id, qualityTier: 'lab', densityGPerMl: null })
      .run();
    for (const [code, amount] of Object.entries(nutrients)) {
      db.insert(schema.foodNutrient).values({ foodId: id, nutrientCode: code, amountPer100g: amount, derivation: 'reported' }).run();
    }
  }
  return db;
}

/** Talks to the Hono app directly: real routing, real Postgres, no socket. */
function transportFor(userId: string): syncClient.Transport {
  return {
    async push(request: PushRequest, idempotencyKey: string): Promise<PushResponse> {
      const res = await h.request(userId, '/v1/sync/push', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'idempotency-key': idempotencyKey },
      });
      if (!res.ok) throw new syncClient.SyncError('server', `push failed: ${res.status} ${await res.text()}`);
      return pushResponse.parse(await json<unknown>(res));
    },
    async pull(cursor: number): Promise<PullResponse> {
      const res = await h.request(userId, `/v1/sync/pull?cursor=${cursor}`);
      if (res.status === 410) throw new syncClient.SyncError('cursor_expired', 'cursor expired');
      if (!res.ok) throw new syncClient.SyncError('server', `pull failed: ${res.status}`);
      return pullResponse.parse(await json<unknown>(res));
    },
  };
}

const syncDevice = (db: Db, userId: string) =>
  syncClient.sync(db, transportFor(userId), { userSourceReleaseId: USER_RELEASE });

const logFood = (db: Db, foodId: string, name: string, grams: string, nutrients: Record<string, string>, at?: Date) =>
  entriesRepo.logFood(db, {
    foodId,
    foodName: name,
    sourceReleaseId: FDC_RELEASE,
    mealSlot: 'lunch',
    amountValue: grams,
    amountUnit: 'g',
    grams,
    gramsProvenance: 'user',
    nutrientsPer100g: nutrients,
    ...(at ? { at } : {}),
  });

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.reset();
  await insertCatalogFood(h.pool, { id: RICE_ID, name: 'Rice, cooked, NFS', energy: '129' });
  await insertCatalogFood(h.pool, { id: CHICKEN_ID, name: 'Chicken breast, roasted', energy: '165' });
});

describe('two devices', () => {
  it('converge on identical totals after both edit offline', async () => {
    const phone = newDevice();
    const tablet = newDevice();
    const today = localDateOf();

    // Both devices log while offline, neither having seen the other.
    logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    waterRepo.addWater(phone, 250);
    logFood(tablet, CHICKEN_ID, 'Chicken breast, roasted', '200', CHICKEN);
    waterRepo.addWater(tablet, 500);

    expect(totalOf(readDay(phone, today).totals.total, 'energy_kcal')).toBe('193.5');
    expect(totalOf(readDay(tablet, today).totals.total, 'energy_kcal')).toBe('330');

    // They come online one after the other, then each syncs once more.
    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);
    await syncDevice(phone, USER_A);

    const onPhone = readDay(phone, today);
    const onTablet = readDay(tablet, today);

    expect(totalOf(onPhone.totals.total, 'energy_kcal')).toBe('523.5');
    expect(onPhone.totals.total.values).toEqual(onTablet.totals.total.values);
    expect(onPhone.entries.map((e) => e.id).sort()).toEqual(onTablet.entries.map((e) => e.id).sort());
    expect(onPhone.water.consumedMl).toBe(750);
    expect(onTablet.water.consumedMl).toBe(750);
    expect(outboxRepo.pendingCount(phone)).toBe(0);
    expect(outboxRepo.pendingCount(tablet)).toBe(0);
  });

  it('propagates a deletion as a tombstone, not a resurrection', async () => {
    const phone = newDevice();
    const tablet = newDevice();
    const today = localDateOf();

    const entryId = logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);
    expect(readDay(tablet, today).entries).toHaveLength(1);

    entriesRepo.deleteEntry(phone, entryId);
    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);

    expect(readDay(tablet, today).entries).toHaveLength(0);
    // A day with nothing in it is zero, not unknown.
    expect(totalOf(readDay(tablet, today).totals.total, 'energy_kcal')).toBe('0');

    // Syncing again must not bring it back.
    await syncDevice(tablet, USER_A);
    await syncDevice(phone, USER_A);
    expect(readDay(tablet, today).entries).toHaveLength(0);
  });

  it('resolves a conflicting edit by server arrival order', async () => {
    const phone = newDevice();
    const tablet = newDevice();
    const today = localDateOf();

    const entryId = logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);

    // Both edit the same row while offline; the tablet's push lands second.
    entriesRepo.updateEntry(phone, entryId, { grams: '100', amountValue: '100' });
    entriesRepo.updateEntry(tablet, entryId, { grams: '300', amountValue: '300' });
    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);
    await syncDevice(phone, USER_A);

    const phoneDay = readDay(phone, today);
    const tabletDay = readDay(tablet, today);
    expect(phoneDay.entries[0]!.grams).toBe('300');
    expect(phoneDay.totals.total.values).toEqual(tabletDay.totals.total.values);
  });

  it('carries a custom food across with its nutrients and portions intact', async () => {
    const phone = newDevice();
    const tablet = newDevice();

    const foodId = foodsRepo.createCustomFood(
      phone,
      {
        kind: 'custom',
        name: 'My granola',
        brand: 'Homemade',
        gtin: null,
        qualityTier: 'user',
        sourceRef: 'user',
        densityGPerMl: null,
        category: null,
        nutrients: [
          { code: 'energy_kcal', amountPer100g: '450', derivation: 'reported' },
          { code: 'protein_g', amountPer100g: '12.5', derivation: 'reported' },
        ],
        portions: [{ label: '1 bowl (60 g)', gramWeight: '60', source: 'user' }],
      },
      { sourceReleaseId: USER_RELEASE, synced: true },
    );

    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);

    const arrived = foodsRepo.foodDetail(tablet, foodId);
    expect(arrived).not.toBeNull();
    expect(arrived!.nutrientsPer100g).toEqual({ energy_kcal: '450', protein_g: '12.5' });
    expect(arrived!.portions).toEqual([{ id: expect.any(String), label: '1 bowl (60 g)', gramWeight: '60', source: 'user' }]);
    expect(arrived!.qualityTier).toBe('user');
  });

  it('carries dated goal profiles so a past day keeps its targets', async () => {
    const phone = newDevice();
    const tablet = newDevice();

    goalsRepo.saveGoals(
      phone,
      {
        waterTargetMl: 2500,
        targets: [
          { nutrientCode: 'energy_kcal', kind: 'target', value: '2100', valueLow: null, valueHigh: null, basis: 'absolute' },
          { nutrientCode: 'protein_g', kind: 'target', value: '25', valueLow: null, valueHigh: null, basis: 'pct_energy' },
        ],
        effectiveFrom: '2026-01-01',
      },
    );

    await syncDevice(phone, USER_A);
    await syncDevice(tablet, USER_A);

    const goals = goalsRepo.goalsForDate(tablet, '2026-06-01');
    expect(goals).not.toBeNull();
    expect(goals!.waterTargetMl).toBe(2500);
    expect(goals!.targets).toHaveLength(2);
    expect(goals!.targets.find((t) => t.nutrientCode === 'protein_g')!.basis).toBe('pct_energy');
  });

  it('keeps one user’s rows out of another user’s device', async () => {
    const mine = newDevice();
    const theirs = newDevice();

    logFood(mine, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    await syncDevice(mine, USER_A);
    await syncDevice(theirs, USER_B);

    expect(readDay(theirs, localDateOf()).entries).toHaveLength(0);
  });

  it('is unchanged by a repeated push, because the batch is idempotent', async () => {
    const phone = newDevice();
    logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);

    const transport = transportFor(USER_A);
    const changes = [syncClient.serializeRow(phone, 'log_entry', readDay(phone, localDateOf()).entries[0]!.id)!];
    const first = await transport.push({ changes }, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    const second = await transport.push({ changes }, 'ffffffff-ffff-4fff-8fff-ffffffffffff');

    expect(second.assigned).toEqual(first.assigned);
    const { rows } = await h.pool.query('select count(*)::int as n from log_entry');
    expect(rows[0].n).toBe(1);
  });

  it('re-pulls from zero when the cursor predates the tombstone purge', async () => {
    const phone = newDevice();
    logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    await syncDevice(phone, USER_A);
    expect(syncClient.pullCursor(phone)).toBeGreaterThan(0);

    // The purge job ran while this device was away.
    await h.pool.query(
      `insert into sync_watermark (user_id, purged_below_rev) values ($1, $2)
       on conflict (user_id) do update set purged_below_rev = excluded.purged_below_rev`,
      [USER_A, 9_999_999],
    );

    const result = await syncDevice(phone, USER_A);
    expect(result.reset).toBe(true);
    expect(readDay(phone, localDateOf()).entries).toHaveLength(1);
  });
});

describe('export', () => {
  it('round-trips a day of logging', async () => {
    const phone = newDevice();
    const today = localDateOf();
    logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    waterRepo.addWater(phone, 250);
    goalsRepo.saveGoals(phone, {
      waterTargetMl: 2500,
      targets: [{ nutrientCode: 'energy_kcal', kind: 'target', value: '2100', valueLow: null, valueHigh: null, basis: 'absolute' }],
      effectiveFrom: today,
    });
    await syncDevice(phone, USER_A);

    const res = await h.request(USER_A, '/v1/me/export');
    expect(res.status).toBe(200);
    const doc = await json<ExportDoc>(res);

    expect(doc.logEntries).toHaveLength(1);
    expect(doc.waterEntries).toHaveLength(1);
    expect(doc.goalProfiles).toHaveLength(1);
    expect(doc.csv.logEntries).toContain('Rice, cooked, NFS');

    // The exported numbers reproduce the totals the app showed.
    const exported = doc.logEntries.map((row) => ({
      id: row.id as string,
      mealSlot: row.meal_slot as never,
      entryKind: row.entry_kind as never,
      grams: String(row.grams),
      nutrientsPer100g: row.nutrients_per_100g as never,
      nutrientsAbsolute: row.nutrients_absolute as never,
    }));
    expect(totalOf(dayTotals(exported).total, 'energy_kcal')).toBe(
      totalOf(readDay(phone, today).totals.total, 'energy_kcal'),
    );
  });

  it('refuses account deletion on a stale token, then deletes everything', async () => {
    const phone = newDevice();
    logFood(phone, RICE_ID, 'Rice, cooked, NFS', '150', RICE);
    await syncDevice(phone, USER_A);

    const staleToken = await h.tokenFor(USER_A, Math.floor(Date.now() / 1000) - 3600);
    const refused = await h.app.request('/v1/me', { method: 'DELETE', headers: { authorization: `Bearer ${staleToken}` } });
    expect(refused.status).toBe(401);
    expect((await h.pool.query('select count(*)::int as n from log_entry')).rows[0].n).toBe(1);

    const accepted = await h.request(USER_A, '/v1/me', { method: 'DELETE' });
    expect(accepted.status).toBe(204);
    expect((await h.pool.query('select count(*)::int as n from log_entry')).rows[0].n).toBe(0);
  });
});
