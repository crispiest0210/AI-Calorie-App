/**
 * Sync (spec 2.10, 4.2). Push assigns each row the next global revision; pull
 * returns everything above the caller's cursor in that same total order.
 *
 * Conflicts are row-level last-writer-wins by *server arrival order*: whichever
 * push lands second wins. Single-user data is mostly append-only, and field
 * level merging was cut for that reason (review R6).
 */
import type { PullResponse, PushRequest, PushResponse, SyncRow, SyncedTable } from '@nt/core';
import { MAX_PUSH_ROWS, SYNCED_TABLES } from '@nt/core';
import { ApiError } from '../errors';
import type { Sql } from '../db';

export const PULL_PAGE_SIZE = 200;

/** `updated_at` travels as epoch milliseconds and is stored as a timestamp. */
const toTimestamp = (ms: number | null): Date | null => (ms === null ? null : new Date(ms));

async function upsertLogEntry(sql: Sql, userId: string, row: Extract<SyncRow, { table: 'log_entry' }>['row']): Promise<number> {
  const { rows } = await sql.query<{ server_rev: number }>(
    `insert into log_entry (
       id, user_id, local_date, logged_at, tz_offset_min, meal_slot, entry_kind, food_id,
       amount_value, amount_unit, portion_id, grams, grams_provenance, food_name_snapshot,
       source_release_id, nutrients_per_100g, nutrients_absolute, note,
       server_rev, updated_at, deleted_at)
     values ($1,$2,$3,to_timestamp($4/1000.0),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             nextval('server_rev_seq'),$19,$20)
     on conflict (id) do update set
       local_date = excluded.local_date, logged_at = excluded.logged_at,
       tz_offset_min = excluded.tz_offset_min, meal_slot = excluded.meal_slot,
       entry_kind = excluded.entry_kind, food_id = excluded.food_id,
       amount_value = excluded.amount_value, amount_unit = excluded.amount_unit,
       portion_id = excluded.portion_id, grams = excluded.grams,
       grams_provenance = excluded.grams_provenance,
       food_name_snapshot = excluded.food_name_snapshot,
       source_release_id = excluded.source_release_id,
       nutrients_per_100g = excluded.nutrients_per_100g,
       nutrients_absolute = excluded.nutrients_absolute, note = excluded.note,
       server_rev = nextval('server_rev_seq'),
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     returning server_rev`,
    [
      row.id, userId, row.localDate, row.loggedAt, row.tzOffsetMin, row.mealSlot, row.entryKind, row.foodId,
      row.amountValue, row.amountUnit, row.portionId, row.grams, row.gramsProvenance, row.foodNameSnapshot,
      row.sourceReleaseId, row.nutrientsPer100g, row.nutrientsAbsolute, row.note,
      toTimestamp(row.updatedAt), toTimestamp(row.deletedAt),
    ],
  );
  return rows[0]!.server_rev;
}

async function upsertWaterEntry(sql: Sql, userId: string, row: Extract<SyncRow, { table: 'water_entry' }>['row']): Promise<number> {
  const { rows } = await sql.query<{ server_rev: number }>(
    `insert into water_entry (id, user_id, local_date, logged_at, amount_ml, server_rev, updated_at, deleted_at)
     values ($1,$2,$3,to_timestamp($4/1000.0),$5,nextval('server_rev_seq'),$6,$7)
     on conflict (id) do update set
       local_date = excluded.local_date, logged_at = excluded.logged_at,
       amount_ml = excluded.amount_ml, server_rev = nextval('server_rev_seq'),
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     returning server_rev`,
    [row.id, userId, row.localDate, row.loggedAt, row.amountMl, toTimestamp(row.updatedAt), toTimestamp(row.deletedAt)],
  );
  return rows[0]!.server_rev;
}

async function upsertWaterPreset(sql: Sql, userId: string, row: Extract<SyncRow, { table: 'water_preset' }>['row']): Promise<number> {
  const { rows } = await sql.query<{ server_rev: number }>(
    `insert into water_preset (id, user_id, label, amount_ml, position, server_rev, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,nextval('server_rev_seq'),$6,$7)
     on conflict (id) do update set
       label = excluded.label, amount_ml = excluded.amount_ml, position = excluded.position,
       server_rev = nextval('server_rev_seq'), updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at
     returning server_rev`,
    [row.id, userId, row.label, row.amountMl, row.position, toTimestamp(row.updatedAt), toTimestamp(row.deletedAt)],
  );
  return rows[0]!.server_rev;
}

async function upsertGoalProfile(sql: Sql, userId: string, row: Extract<SyncRow, { table: 'goal_profile' }>['row']): Promise<number> {
  const { rows } = await sql.query<{ server_rev: number }>(
    `insert into goal_profile (id, user_id, effective_from, water_target_ml, targets, server_rev, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,nextval('server_rev_seq'),$6,$7)
     on conflict (id) do update set
       effective_from = excluded.effective_from, water_target_ml = excluded.water_target_ml,
       targets = excluded.targets, server_rev = nextval('server_rev_seq'),
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     returning server_rev`,
    [row.id, userId, row.effectiveFrom, row.waterTargetMl, JSON.stringify(row.targets), toTimestamp(row.updatedAt), toTimestamp(row.deletedAt)],
  );
  return rows[0]!.server_rev;
}

/**
 * A custom food arrives with its nutrients and portions and is written in one
 * statement set, so another device never sees a food with no nutrients (R3).
 */
async function upsertFood(sql: Sql, userId: string, row: Extract<SyncRow, { table: 'food' }>['row']): Promise<number> {
  const release = await sql.query<{ id: string }>(
    `select id from source_release where provider = 'user' limit 1`,
  );
  if (release.rows.length === 0) throw new ApiError('server_error', 'no user source_release configured');

  const { rows } = await sql.query<{ server_rev: number }>(
    `insert into food (id, kind, owner_user_id, name, brand, gtin, source_release_id, source_ref,
                       quality_tier, density_g_per_ml, server_rev, updated_at, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,nextval('server_rev_seq'),$11,$12)
     on conflict (id) do update set
       kind = excluded.kind, name = excluded.name, brand = excluded.brand, gtin = excluded.gtin,
       source_ref = excluded.source_ref, quality_tier = excluded.quality_tier,
       density_g_per_ml = excluded.density_g_per_ml, server_rev = nextval('server_rev_seq'),
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     returning server_rev`,
    [row.id, row.kind, userId, row.name, row.brand, row.gtin, release.rows[0]!.id, row.sourceRef,
     row.qualityTier, row.densityGPerMl, toTimestamp(row.updatedAt), toTimestamp(row.deletedAt)],
  );

  await sql.query('delete from food_nutrient where food_id = $1', [row.id]);
  for (const nutrient of row.nutrients) {
    await sql.query(
      `insert into food_nutrient (food_id, nutrient_code, amount_per_100g, derivation) values ($1,$2,$3,$4)`,
      [row.id, nutrient.nutrientCode, nutrient.amountPer100g, nutrient.derivation],
    );
  }
  await sql.query('delete from food_portion where food_id = $1', [row.id]);
  for (const portion of row.portions) {
    await sql.query(
      `insert into food_portion (id, food_id, label, gram_weight, source, position) values ($1,$2,$3,$4,$5,$6)`,
      [portion.id, row.id, portion.label, portion.gramWeight, portion.source, portion.position],
    );
  }

  if (row.recipe != null) {
    await sql.query(
      `insert into recipe_meta (food_id, total_cooked_grams, servings) values ($1,$2,$3)
       on conflict (food_id) do update set
         total_cooked_grams = excluded.total_cooked_grams, servings = excluded.servings`,
      [row.id, row.recipe.totalCookedGrams, row.recipe.servings],
    );
    await sql.query('delete from recipe_ingredient where recipe_food_id = $1', [row.id]);
    for (const ingredient of row.recipe.ingredients) {
      await sql.query(
        `insert into recipe_ingredient (id, recipe_food_id, ingredient_food_id, grams, position)
         values ($1,$2,$3,$4,$5)`,
        [ingredient.id, row.id, ingredient.ingredientFoodId, ingredient.grams, ingredient.position],
      );
    }
  }
  return rows[0]!.server_rev;
}

export async function push(sql: Sql, userId: string, request: PushRequest): Promise<PushResponse> {
  if (request.changes.length > MAX_PUSH_ROWS) {
    throw new ApiError('validation_failed', `at most ${MAX_PUSH_ROWS} rows per push`);
  }
  const assigned: PushResponse['assigned'] = [];
  for (const change of request.changes) {
    const serverRev =
      change.table === 'log_entry' ? await upsertLogEntry(sql, userId, change.row)
      : change.table === 'water_entry' ? await upsertWaterEntry(sql, userId, change.row)
      : change.table === 'water_preset' ? await upsertWaterPreset(sql, userId, change.row)
      : change.table === 'goal_profile' ? await upsertGoalProfile(sql, userId, change.row)
      : await upsertFood(sql, userId, change.row);
    assigned.push({ table: change.table, id: change.row.id, serverRev });
  }
  const cursor = assigned.reduce((max, a) => Math.max(max, a.serverRev), 0);
  return { assigned, cursor };
}

const epochMs = (value: Date | null): number | null => (value === null ? null : value.getTime());

/** Row ids above the cursor, across every synced table, in revision order. */
async function changedIds(sql: Sql, userId: string, cursor: number, limit: number) {
  const union = SYNCED_TABLES.map((table) =>
    table === 'food'
      ? `select 'food' as table_name, id, server_rev from food where owner_user_id = $1 and server_rev > $2`
      : `select '${table}' as table_name, id, server_rev from ${table} where user_id = $1 and server_rev > $2`,
  ).join(' union all ');

  const { rows } = await sql.query<{ table_name: SyncedTable; id: string; server_rev: number }>(
    `${union} order by server_rev asc limit $3`,
    [userId, cursor, limit + 1],
  );
  return rows;
}

export async function pull(sql: Sql, userId: string, cursor: number, pageSize = PULL_PAGE_SIZE): Promise<PullResponse> {
  const watermark = await sql.query<{ purged_below_rev: number }>(
    'select purged_below_rev from sync_watermark where user_id = $1',
    [userId],
  );
  // A device offline longer than the tombstone window cannot be caught up
  // incrementally, because the deletions it missed are gone (2.10).
  if (cursor > 0 && (watermark.rows[0]?.purged_below_rev ?? 0) > cursor) {
    throw new ApiError('sync_cursor_expired', 'cursor predates the tombstone window; re-pull from zero');
  }

  const ids = await changedIds(sql, userId, cursor, pageSize);
  const hasMore = ids.length > pageSize;
  const page = ids.slice(0, pageSize);

  const changes: PullResponse['changes'] = [];
  for (const { table_name: table, id } of page) {
    const row = await readRow(sql, table, id);
    if (row !== null) changes.push(row);
  }

  return {
    changes,
    nextCursor: page.length === 0 ? cursor : page[page.length - 1]!.server_rev,
    hasMore,
  };
}

async function readRow(sql: Sql, table: SyncedTable, id: string): Promise<(SyncRow & { serverRev: number }) | null> {
  if (table === 'log_entry') {
    const { rows } = await sql.query(`select * from log_entry where id = $1`, [id]);
    const r = rows[0];
    if (r === undefined) return null;
    return {
      table: 'log_entry',
      serverRev: r.server_rev,
      row: {
        id: r.id,
        localDate: typeof r.local_date === 'string' ? r.local_date : r.local_date.toISOString().slice(0, 10),
        loggedAt: r.logged_at.getTime(),
        tzOffsetMin: r.tz_offset_min,
        mealSlot: r.meal_slot,
        entryKind: r.entry_kind,
        foodId: r.food_id,
        amountValue: String(r.amount_value),
        amountUnit: r.amount_unit,
        portionId: r.portion_id,
        grams: r.grams === null ? null : String(r.grams),
        gramsProvenance: r.grams_provenance,
        foodNameSnapshot: r.food_name_snapshot,
        sourceReleaseId: r.source_release_id,
        nutrientsPer100g: r.nutrients_per_100g,
        nutrientsAbsolute: r.nutrients_absolute,
        note: r.note,
        updatedAt: r.updated_at.getTime(),
        deletedAt: epochMs(r.deleted_at),
      },
    };
  }
  if (table === 'water_entry') {
    const { rows } = await sql.query(`select * from water_entry where id = $1`, [id]);
    const r = rows[0];
    if (r === undefined) return null;
    return {
      table: 'water_entry',
      serverRev: r.server_rev,
      row: {
        id: r.id,
        localDate: typeof r.local_date === 'string' ? r.local_date : r.local_date.toISOString().slice(0, 10),
        loggedAt: r.logged_at.getTime(),
        amountMl: r.amount_ml,
        updatedAt: r.updated_at.getTime(),
        deletedAt: epochMs(r.deleted_at),
      },
    };
  }
  if (table === 'water_preset') {
    const { rows } = await sql.query(`select * from water_preset where id = $1`, [id]);
    const r = rows[0];
    if (r === undefined) return null;
    return {
      table: 'water_preset',
      serverRev: r.server_rev,
      row: {
        id: r.id,
        label: r.label,
        amountMl: r.amount_ml,
        position: r.position,
        updatedAt: r.updated_at.getTime(),
        deletedAt: epochMs(r.deleted_at),
      },
    };
  }
  if (table === 'goal_profile') {
    const { rows } = await sql.query(`select * from goal_profile where id = $1`, [id]);
    const r = rows[0];
    if (r === undefined) return null;
    return {
      table: 'goal_profile',
      serverRev: r.server_rev,
      row: {
        id: r.id,
        effectiveFrom: typeof r.effective_from === 'string' ? r.effective_from : r.effective_from.toISOString().slice(0, 10),
        waterTargetMl: r.water_target_ml,
        targets: r.targets,
        updatedAt: r.updated_at.getTime(),
        deletedAt: epochMs(r.deleted_at),
      },
    };
  }
  const { rows } = await sql.query(`select * from food where id = $1`, [id]);
  const r = rows[0];
  if (r === undefined) return null;
  const nutrients = await sql.query(`select nutrient_code, amount_per_100g, derivation from food_nutrient where food_id = $1`, [id]);
  const portions = await sql.query(`select id, label, gram_weight, source, position from food_portion where food_id = $1 order by position`, [id]);
  const meta = await sql.query(`select total_cooked_grams, servings from recipe_meta where food_id = $1`, [id]);
  const ingredients = await sql.query(
    `select id, ingredient_food_id, grams, position from recipe_ingredient where recipe_food_id = $1 order by position`,
    [id],
  );
  return {
    table: 'food',
    serverRev: r.server_rev,
    row: {
      id: r.id,
      kind: r.kind,
      name: r.name,
      brand: r.brand,
      gtin: r.gtin,
      qualityTier: r.quality_tier,
      sourceRef: r.source_ref,
      densityGPerMl: r.density_g_per_ml === null ? null : String(r.density_g_per_ml),
      nutrients: nutrients.rows.map((n) => ({
        nutrientCode: n.nutrient_code,
        amountPer100g: String(n.amount_per_100g),
        derivation: n.derivation,
      })),
      portions: portions.rows.map((p) => ({
        id: p.id,
        label: p.label,
        gramWeight: String(p.gram_weight),
        source: p.source,
        position: p.position,
      })),
      recipe:
        meta.rows[0] === undefined
          ? null
          : {
              servings: String(meta.rows[0].servings),
              totalCookedGrams: meta.rows[0].total_cooked_grams === null ? null : String(meta.rows[0].total_cooked_grams),
              ingredients: ingredients.rows.map((i) => ({
                id: i.id,
                ingredientFoodId: i.ingredient_food_id,
                grams: String(i.grams),
                position: i.position,
              })),
            },
      updatedAt: r.updated_at.getTime(),
      deletedAt: epochMs(r.deleted_at),
    },
  };
}
