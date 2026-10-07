/**
 * Catalog reads and custom-food writes. Search runs against the bundled FTS5
 * index so it works with no network (F8) and stays under the 100 ms budget.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  FEATURED_MEAL_CATEGORIES,
  uuidv7,
  type CanonicalFood,
  type NutrientMap,
  type Portion,
  type QualityTier,
  type FoodKind,
} from '@nt/core';
import { food, foodNutrient, foodPortion } from '../schema';
import type { Db, Writer } from '../db';
import { enqueue } from './outbox';

export interface FoodSummary {
  id: string;
  name: string;
  brand: string | null;
  kind: FoodKind;
  qualityTier: QualityTier;
  energyPer100g: string | null;
  category?: string | null;
}

export interface FoodDetail extends FoodSummary {
  gtin: string | null;
  sourceRef: string | null;
  sourceReleaseId: string;
  densityGPerMl: string | null;
  nutrientsPer100g: NutrientMap;
  /** How each value came to be, for the provenance sheet. */
  derivations: Partial<Record<keyof NutrientMap, string>>;
  portions: Portion[];
}

/**
 * A single letter matches thousands of foods, costs an order of magnitude more
 * to rank, and tells us almost nothing about what the person wants. Two is
 * where a query starts to mean something.
 */
export const MIN_SEARCH_LENGTH = 2;

/**
 * FTS5 treats punctuation and words like NEAR as operators, so the user's text
 * is reduced to bare tokens. Every token is a prefix match, because a search
 * field that only completes the last word ("chick bre") finds nothing.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  if (tokens.join('').length < MIN_SEARCH_LENGTH) return null;
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}

const ENERGY = sql<string | null>`(
  select fn.amount_per_100g from food_nutrient fn
  where fn.food_id = food.id and fn.nutrient_code = 'energy_kcal'
)`;

/**
 * Ranking, in order of what actually helps someone typing a food name:
 *
 *  1. the user's own foods and recipes
 *  2. an exact match on the *head* of the name — USDA names lead with the food
 *     and append qualifiers after commas, so "rice" should match
 *     "Rice, cooked, NFS" ahead of "Rice noodles, cooked"
 *  3. USDA's own "NFS" (not further specified) records, which are their marker
 *     for the plain, unqualified version of a food
 *  4. shorter names, i.e. fewer qualifiers piled on
 *  5. data quality, then FTS relevance
 *
 * Near-identical records are collapsed first: the same food often appears in
 * both Foundation and FNDDS with the same name and near-identical values, and
 * showing both side by side with nothing to tell them apart is just confusing.
 * The higher-quality tier survives.
 */
export function searchFoods(db: Db, query: string, limit = 30): FoodSummary[] {
  const match = toFtsQuery(query);
  if (match === null) return [];
  const needle = query.trim().toLowerCase();

  return db.all<FoodSummary>(sql`
    with matched as (
      select food.id, food.name, food.brand, food.kind,
             food.quality_tier as "qualityTier",
             lower(trim(food.name)) as norm,
             case when instr(food.name, ',') > 0
                  then lower(trim(substr(food.name, 1, instr(food.name, ',') - 1)))
                  else lower(trim(food.name)) end as head,
             case food.quality_tier
                  when 'user' then 0 when 'lab' then 1 when 'survey' then 2
                  when 'label' then 3 when 'crowd' then 4 else 5 end as tier_rank,
             bm25(food_fts, 10.0, 1.0) as relevance
      from food_fts
      join food on food.id = food_fts.food_id
      where food_fts match ${match}
        and food.deleted_at is null
        and food.superseded_by is null
    ),
    deduped as (
      select *, row_number() over (
        -- A custom food is never collapsed into a catalog one: it is its own
        -- partition, so the user always sees what they created.
        partition by case when kind in ('custom', 'recipe') then id else norm end
        order by tier_rank, relevance
      ) as duplicate_rank
      from matched
    ),
    ranked as (
      select id, name, brand, kind, "qualityTier"
      from deduped
      where duplicate_rank = 1
      order by
        case kind when 'custom' then 0 when 'recipe' then 1 else 2 end,
        case when head = ${needle} then 0
             when head like ${needle + '%'} then 1
             when lower(name) like ${needle + '%'} then 2
             else 3 end,
        case when upper(name) like '%, NFS' then 0 else 1 end,
        length(name) asc,
        tier_rank asc,
        relevance asc
      limit ${limit}
    )
    -- Energy is read only for the rows that survived the limit. Doing it in
    -- the match set instead costs one subquery per candidate, which is what
    -- pushed a broad query past the 100 ms budget in 2.13.
    select ranked.*, (
      select amount_per_100g from food_nutrient fn
      where fn.food_id = ranked.id and fn.nutrient_code = 'energy_kcal'
    ) as "energyPer100g"
    from ranked
  `);
}

/** Foods logged most recently — the first tab of the Log sheet (F2). */
export function recentFoods(db: Db, limit = 20): FoodSummary[] {
  return db.all<FoodSummary>(sql`
    select food.id, food.name, food.brand, food.kind, food.quality_tier as "qualityTier",
           ${ENERGY} as "energyPer100g"
    from food
    join (
      select food_id, max(logged_at) as last_at
      from log_entry
      where deleted_at is null and food_id is not null
      group by food_id
    ) recent on recent.food_id = food.id
    where food.deleted_at is null
    order by recent.last_at desc
    limit ${limit}
  `);
}

/** Foods logged most often in the window — the Frequent tab. */
export function frequentFoods(db: Db, sinceMs: number, limit = 20): FoodSummary[] {
  return db.all<FoodSummary>(sql`
    select food.id, food.name, food.brand, food.kind, food.quality_tier as "qualityTier",
           ${ENERGY} as "energyPer100g"
    from food
    join (
      select food_id, count(*) as uses
      from log_entry
      where deleted_at is null and food_id is not null and logged_at >= ${sinceMs}
      group by food_id
    ) freq on freq.food_id = food.id
    where food.deleted_at is null
    order by freq.uses desc, food.name asc
    limit ${limit}
  `);
}

export function myFoods(db: Db, limit = 50): FoodSummary[] {
  return db.all<FoodSummary>(sql`
    select food.id, food.name, food.brand, food.kind, food.quality_tier as "qualityTier",
           ${ENERGY} as "energyPer100g"
    from food
    where food.deleted_at is null and food.kind in ('custom','recipe')
    order by food.name asc
    limit ${limit}
  `);
}

export interface FoodCategory {
  category: string;
  count: number;
  featured: boolean;
}

/**
 * Categories to browse when looking for a meal rather than an ingredient.
 * Featured ones lead; everything else follows by how much it holds, so the
 * long tail stays reachable without being in the way.
 */
export function mealCategories(db: Db, limit = 60): FoodCategory[] {
  const rows = db.all<{ category: string; count: number }>(sql`
    select category, count(*) as count
    from food
    where category is not null and deleted_at is null and superseded_by is null
    group by category
    having count(*) >= 3
    order by count desc
  `);

  const byName = new Map(rows.map((row) => [row.category, row.count]));
  const featured: FoodCategory[] = [];
  for (const name of FEATURED_MEAL_CATEGORIES) {
    const count = byName.get(name);
    if (count === undefined) continue;
    featured.push({ category: name, count, featured: true });
    byName.delete(name);
  }

  const rest = [...byName.entries()]
    .map(([category, count]) => ({ category, count, featured: false }))
    .sort((a, b) => b.count - a.count);

  return [...featured, ...rest].slice(0, limit);
}

export function foodsInCategory(db: Db, category: string, limit = 60): FoodSummary[] {
  return db.all<FoodSummary>(sql`
    select food.id, food.name, food.brand, food.kind, food.quality_tier as "qualityTier",
           food.category, ${ENERGY} as "energyPer100g"
    from food
    where food.category = ${category}
      and food.deleted_at is null
      and food.superseded_by is null
    order by
      case when upper(food.name) like '%, NFS' then 0 else 1 end,
      length(food.name) asc,
      food.name asc
    limit ${limit}
  `);
}

export function foodDetail(db: Db, id: string): FoodDetail | null {
  const row = db.select().from(food).where(and(eq(food.id, id), isNull(food.deletedAt))).get();
  if (!row) return null;
  const nutrients = db.select().from(foodNutrient).where(eq(foodNutrient.foodId, id)).all();
  const portions = db.select().from(foodPortion).where(eq(foodPortion.foodId, id)).orderBy(foodPortion.position).all();
  const map: NutrientMap = {};
  const derivations: Partial<Record<keyof NutrientMap, string>> = {};
  for (const n of nutrients) {
    map[n.nutrientCode as keyof NutrientMap] = n.amountPer100g;
    derivations[n.nutrientCode as keyof NutrientMap] = n.derivation;
  }
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    kind: row.kind as FoodKind,
    qualityTier: row.qualityTier as QualityTier,
    category: row.category,
    gtin: row.gtin,
    sourceRef: row.sourceRef,
    sourceReleaseId: row.sourceReleaseId,
    densityGPerMl: row.densityGPerMl,
    energyPer100g: map.energy_kcal ?? null,
    nutrientsPer100g: map,
    derivations,
    portions: portions.map((p) => ({ id: p.id, label: p.label, gramWeight: p.gramWeight, source: p.source as Portion['source'] })),
  };
}

export interface InsertFoodOptions {
  id?: string;
  sourceReleaseId: string;
  ownerUserId?: string | null;
  now?: number;
  /** Custom foods and recipes sync as one aggregate; catalog rows never sync. */
  synced?: boolean;
  /**
   * Supplies portion ids. The catalog builder passes a content-derived factory
   * so a rebuild from the same fixtures produces the same file byte for byte.
   */
  portionId?: (index: number) => string;
}

/** Writes a canonical food with its nutrients and portions in one transaction. */
export function insertFood(tx: Writer, canonical: CanonicalFood, options: InsertFoodOptions): string {
  const now = options.now ?? Date.now();
  const id = options.id ?? uuidv7(now);
  const synced = options.synced ?? (canonical.kind === 'custom' || canonical.kind === 'recipe');

  tx.insert(food)
    .values({
      id,
      kind: canonical.kind,
      ownerUserId: options.ownerUserId ?? null,
      name: canonical.name,
      brand: canonical.brand,
      gtin: canonical.gtin,
      sourceReleaseId: options.sourceReleaseId,
      sourceRef: canonical.sourceRef,
      qualityTier: canonical.qualityTier,
      densityGPerMl: canonical.densityGPerMl,
      category: canonical.category,
      supersededBy: null,
      serverRev: null,
      updatedAt: synced ? now : null,
      deletedAt: null,
    })
    .run();

  for (const nutrient of canonical.nutrients) {
    tx.insert(foodNutrient)
      .values({ foodId: id, nutrientCode: nutrient.code, amountPer100g: nutrient.amountPer100g, derivation: nutrient.derivation })
      .run();
  }
  canonical.portions.forEach((portion, position) => {
    tx.insert(foodPortion)
      .values({
        id: options.portionId?.(position) ?? uuidv7(now + position),
        foodId: id,
        label: portion.label,
        gramWeight: portion.gramWeight,
        source: portion.source,
        position,
      })
      .run();
  });

  if (synced) enqueue(tx, 'food', id, 'upsert', now);
  return id;
}

export function createCustomFood(db: Db, canonical: CanonicalFood, options: InsertFoodOptions): string {
  return db.transaction((tx) => insertFood(tx, canonical, options));
}

export function softDeleteFood(db: Db, id: string, now = Date.now()): void {
  db.transaction((tx) => {
    tx.update(food).set({ deletedAt: now, updatedAt: now }).where(eq(food.id, id)).run();
    enqueue(tx, 'food', id, 'delete', now);
  });
}

/** The most recent amount used for a food, so a recent can be re-logged in one tap. */
export function lastAmountFor(db: Db, foodId: string): { amountValue: string; amountUnit: string; portionId: string | null; grams: string | null } | null {
  return (
    db.get<{ amountValue: string; amountUnit: string; portionId: string | null; grams: string | null }>(sql`
      select amount_value as "amountValue", amount_unit as "amountUnit", portion_id as "portionId", grams
      from log_entry
      where food_id = ${foodId} and deleted_at is null
      order by logged_at desc
      limit 1
    `) ?? null
  );
}

export interface SourceReleaseRow {
  id: string;
  provider: string;
  dataset: string | null;
  version: string | null;
  releasedOn: string | null;
}

/** The release a food's values came from, for the provenance sheet. */
export function sourceRelease(db: Db, id: string): SourceReleaseRow | null {
  return (
    db.get<SourceReleaseRow>(sql`
      select id, provider, dataset, version, released_on as "releasedOn"
      from source_release where id = ${id}
    `) ?? null
  );
}

export function activeSourceRelease(db: Db, provider = 'fdc'): string | null {
  const row = db.get<{ id: string }>(sql`select id from source_release where provider = ${provider} and is_active = 1 limit 1`);
  return row?.id ?? null;
}

export { desc };
