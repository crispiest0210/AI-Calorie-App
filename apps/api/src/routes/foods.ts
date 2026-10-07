/**
 * Catalog reads (spec 4.2). Search is Postgres full-text plus trigram, ranked
 * the same way the device ranks its bundled catalog so results do not reorder
 * when the app switches between the two.
 */
import type { FoodDetailResponse, FoodSearchResult } from '@nt/core';
import { ApiError } from '../errors';
import type { Sql } from '../db';

export const MAX_SEARCH_LIMIT = 25;

/** Matches the device: a single letter is not a query worth ranking. */
export const MIN_SEARCH_LENGTH = 2;

const CITATIONS: Record<string, (ref: string) => string> = {
  fdc: (ref) => `https://fdc.nal.usda.gov/food-details/${ref}/nutrients`,
  off: (ref) => `https://world.openfoodfacts.org/product/${ref}`,
};

export async function search(sql: Sql, query: string, limit = MAX_SEARCH_LIMIT): Promise<FoodSearchResult[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_SEARCH_LENGTH) return [];
  const capped = Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT);

  const { rows } = await sql.query(
    `with matched as (
       select f.id, f.name, f.brand, f.kind, f.quality_tier,
              lower(trim(f.name)) as norm,
              case when position(',' in f.name) > 0
                   then lower(trim(substr(f.name, 1, position(',' in f.name) - 1)))
                   else lower(trim(f.name)) end as head,
              case f.quality_tier
                   when 'user' then 0 when 'lab' then 1 when 'survey' then 2
                   when 'label' then 3 when 'crowd' then 4 else 5 end as tier_rank,
              similarity(lower(f.name), $1) as sim
       from food f
       where f.deleted_at is null and f.superseded_by is null
         and (f.search_tsv @@ plainto_tsquery('simple', $1) or lower(f.name) like $2)
     ),
     deduped as (
       select *, row_number() over (
         partition by case when kind in ('custom','recipe') then id::text else norm end
         order by tier_rank, sim desc
       ) as duplicate_rank
       from matched
     ),
     ranked as (
       select id, name, brand, kind, quality_tier
       from deduped
       where duplicate_rank = 1
       order by
         case kind when 'custom' then 0 when 'recipe' then 1 else 2 end,
         case when head = $1 then 0
              when head like $2 then 1
              when lower(name) like $2 then 2
              else 3 end,
         case when upper(name) like '%, NFS' then 0 else 1 end,
         length(name) asc, tier_rank asc, sim desc
       limit $3
     )
     -- Energy is read only for the rows that survived the limit.
     select ranked.*, (
       select amount_per_100g from food_nutrient n
       where n.food_id = ranked.id and n.nutrient_code = 'energy_kcal'
     ) as energy
     from ranked`,
    [needle, `${needle}%`, capped],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    brand: r.brand,
    kind: r.kind,
    qualityTier: r.quality_tier,
    energyPer100g: r.energy === null || r.energy === undefined ? null : String(r.energy),
  }));
}

export async function detail(sql: Sql, id: string): Promise<FoodDetailResponse> {
  const { rows } = await sql.query(
    `select f.*, r.provider, r.dataset, r.version
     from food f join source_release r on r.id = f.source_release_id
     where f.id = $1 and f.deleted_at is null`,
    [id],
  );
  const food = rows[0];
  if (food === undefined) throw new ApiError('not_found', 'no such food');

  const nutrients = await sql.query(`select nutrient_code, amount_per_100g from food_nutrient where food_id = $1`, [id]);
  const portions = await sql.query(
    `select id, label, gram_weight, source from food_portion where food_id = $1 order by position`,
    [id],
  );

  const map: Record<string, string> = {};
  for (const n of nutrients.rows) map[n.nutrient_code] = String(n.amount_per_100g);

  return {
    id: food.id,
    name: food.name,
    brand: food.brand,
    kind: food.kind,
    qualityTier: food.quality_tier,
    energyPer100g: map.energy_kcal ?? null,
    gtin: food.gtin,
    densityGPerMl: food.density_g_per_ml === null ? null : String(food.density_g_per_ml),
    nutrientsPer100g: map,
    portions: portions.rows.map((p) => ({ id: p.id, label: p.label, gramWeight: String(p.gram_weight), source: p.source })),
    source: {
      provider: food.provider,
      dataset: food.dataset,
      version: food.version,
      sourceRef: food.source_ref,
      citationUrl: food.source_ref === null ? null : (CITATIONS[food.provider]?.(food.source_ref) ?? null),
    },
  };
}

/** Barcodes are normalized to 14 digits so UPC-A and EAN-13 compare equal. */
export function normalizeGtin(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 14) return null;
  return digits.padStart(14, '0');
}

export interface BarcodeLookup {
  /** Looks the product up upstream when it is not already cached. */
  fetchUpstream?: (gtin: string) => Promise<FoodDetailResponse | null>;
}

/**
 * Returns null when no product exists, rather than throwing: the caller's
 * transaction has to commit for the negative cache entry to survive, and an
 * exception here would roll it back and re-ask the upstream on every scan.
 */
export async function lookupBarcode(sql: Sql, rawGtin: string, options: BarcodeLookup = {}): Promise<FoodDetailResponse | null> {
  const gtin = normalizeGtin(rawGtin);
  if (gtin === null) throw new ApiError('validation_failed', 'not a barcode');

  const cached = await sql.query<{ food_id: string | null; not_found: boolean }>(
    'select food_id, not_found from barcode_cache where gtin = $1',
    [gtin],
  );
  if (cached.rows[0]?.not_found === true) return null;
  if (cached.rows[0]?.food_id != null) return detail(sql, cached.rows[0].food_id);

  const local = await sql.query<{ id: string }>(
    `select id from food where gtin = $1 and deleted_at is null and superseded_by is null limit 1`,
    [gtin],
  );
  if (local.rows[0] !== undefined) {
    await sql.query(
      `insert into barcode_cache (gtin, food_id, provider) values ($1,$2,'fdc')
       on conflict (gtin) do update set food_id = excluded.food_id`,
      [gtin, local.rows[0].id],
    );
    return detail(sql, local.rows[0].id);
  }

  const upstream = options.fetchUpstream === undefined ? null : await options.fetchUpstream(gtin);
  if (upstream === null) {
    // Remember the miss too: OFF rate-limits hard and an unknown barcode is
    // otherwise re-fetched on every scan (review R14).
    await sql.query(
      `insert into barcode_cache (gtin, provider, not_found) values ($1,'off',true)
       on conflict (gtin) do update set not_found = true, looked_up = now()`,
      [gtin],
    );
    return null;
  }
  return upstream;
}
