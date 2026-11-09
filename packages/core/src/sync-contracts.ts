/**
 * The wire contract between the app and the API (spec 4.1, 2.10). Both sides
 * import these schemas, so a change on one side that the other has not seen is
 * a type error rather than a runtime surprise.
 *
 * Custom foods and recipes travel as *aggregates* — a food carries its
 * nutrients and portions — so a food never arrives half-written (review R3).
 */
import { z } from 'zod';
import { epochMs, goalProfileSchema, localDate, positiveNumericString, tzOffsetMin, numericString, nonNegativeNumericString, nutrientCode, nutrientMap, waterEntrySchema, waterPresetSchema } from './schemas';
import { MEAL_SLOTS, ENTRY_KINDS } from './entries';
import { AMOUNT_UNITS, GRAMS_PROVENANCES } from './units';
import { FOOD_KINDS, QUALITY_TIERS } from './normalize';

/** Tables that sync. Catalog tables are server-owned and never pushed. */
export const SYNCED_TABLES = ['log_entry', 'water_entry', 'water_preset', 'goal_profile', 'food'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const syncedTable = z.enum(SYNCED_TABLES);

/** Every synced row carries these; the server owns `serverRev`. */
const syncColumns = {
  id: z.string().uuid(),
  updatedAt: epochMs,
  deletedAt: epochMs.nullable(),
};

export const syncLogEntry = z.object({
  ...syncColumns,
  localDate,
  loggedAt: epochMs,
  tzOffsetMin,
  mealSlot: z.enum(MEAL_SLOTS),
  entryKind: z.enum(ENTRY_KINDS),
  foodId: z.string().uuid().nullable(),
  amountValue: numericString,
  amountUnit: z.enum(AMOUNT_UNITS),
  portionId: z.string().uuid().nullable(),
  grams: numericString.nullable(),
  gramsProvenance: z.enum(GRAMS_PROVENANCES),
  foodNameSnapshot: z.string().trim().min(1),
  sourceReleaseId: z.string().nullable(),
  nutrientsPer100g: nutrientMap.nullable(),
  nutrientsAbsolute: nutrientMap.nullable(),
  note: z.string().nullable(),
});

export const syncWaterEntry = waterEntrySchema.extend(syncColumns);
export const syncWaterPreset = waterPresetSchema.extend(syncColumns);
export const syncGoalProfile = goalProfileSchema.extend(syncColumns);

/** Rejects an array whose items repeat a key that the database stores as a primary key. */
const hasUniqueKeys = <T>(items: T[], key: (item: T) => string) => new Set(items.map(key)).size === items.length;

/** A custom food and everything that belongs to it, in one payload. */
const syncFoodShape = z.object({
  ...syncColumns,
  kind: z.enum(FOOD_KINDS),
  name: z.string().trim().min(1),
  brand: z.string().nullable(),
  /** Stored normalized: 14 digits (see normalizeGtin). */
  gtin: z.string().regex(/^\d{14}$/, 'expected 14 digits').nullable(),
  qualityTier: z.enum(QUALITY_TIERS),
  sourceRef: z.string().nullable(),
  densityGPerMl: positiveNumericString.nullable(),
  nutrients: z
    .array(
      z.object({
        nutrientCode,
        amountPer100g: nonNegativeNumericString,
        derivation: z.string(),
      }),
    )
    .refine((items) => hasUniqueKeys(items, (n) => n.nutrientCode), 'duplicate nutrient code'),
  portions: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1),
        gramWeight: positiveNumericString,
        source: z.string(),
        position: z.number().int().nonnegative(),
      }),
    )
    .refine((items) => hasUniqueKeys(items, (p) => p.id), 'duplicate portion id'),
  /**
   * Present only for a recipe. It rides with the food for the same reason its
   * nutrients do: a recipe that arrives without its ingredients cannot be
   * edited, and one that arrives without its nutrients cannot be logged (R3).
   */
  recipe: z
    .object({
      servings: positiveNumericString,
      totalCookedGrams: positiveNumericString.nullable(),
      ingredients: z
        .array(
          z.object({
            id: z.string().uuid(),
            ingredientFoodId: z.string().uuid(),
            grams: positiveNumericString,
            position: z.number().int().nonnegative(),
          }),
        )
        .refine((items) => hasUniqueKeys(items, (i) => i.id), 'duplicate ingredient id'),
    })
    .nullable()
    .optional(),
});

export const syncFood = syncFoodShape.refine((f) => !f.recipe?.ingredients.some((i) => i.ingredientFoodId === f.id), {
  message: 'a recipe cannot be an ingredient of itself',
  path: ['recipe', 'ingredients'],
});

export const syncRow = z.discriminatedUnion('table', [
  z.object({ table: z.literal('log_entry'), row: syncLogEntry }),
  z.object({ table: z.literal('water_entry'), row: syncWaterEntry }),
  z.object({ table: z.literal('water_preset'), row: syncWaterPreset }),
  z.object({ table: z.literal('goal_profile'), row: syncGoalProfile }),
  z.object({ table: z.literal('food'), row: syncFood }),
]);

export type SyncRow = z.infer<typeof syncRow>;

/** A push batch is capped so one request can never be unbounded (spec 4.2). */
export const MAX_PUSH_ROWS = 500;

export const pushRequest = z.object({
  changes: z.array(syncRow).max(MAX_PUSH_ROWS),
});

export const pushResponse = z.object({
  /** The revision the server assigned each row, keyed by row id. */
  assigned: z.array(z.object({ table: syncedTable, id: z.string().uuid(), serverRev: z.number().int().nonnegative() })),
  cursor: z.number().int().nonnegative(),
});

export const pullResponse = z.object({
  changes: z.array(syncRow.and(z.object({ serverRev: z.number().int().nonnegative() }))),
  nextCursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type PushRequest = z.infer<typeof pushRequest>;
export type PushResponse = z.infer<typeof pushResponse>;
export type PullResponse = z.infer<typeof pullResponse>;

/** RFC 9457 problem+json, with the stable `code` the app maps to copy (4.1). */
export const PROBLEM_CODES = [
  'validation_failed',
  'not_found',
  'unauthorized',
  'rate_limited',
  'upstream_unavailable',
  'not_food',
  'analysis_timeout',
  'sync_cursor_expired',
  'upgrade_required',
  'server_error',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const problemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  code: z.enum(PROBLEM_CODES),
  detail: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetails>;

export const foodSearchResult = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  kind: z.enum(FOOD_KINDS),
  qualityTier: z.enum(QUALITY_TIERS),
  energyPer100g: numericString.nullable(),
});

export const foodDetailResponse = foodSearchResult.extend({
  gtin: z.string().nullable(),
  densityGPerMl: positiveNumericString.nullable(),
  nutrientsPer100g: nutrientMap,
  portions: z.array(z.object({ id: z.string(), label: z.string(), gramWeight: positiveNumericString, source: z.string() })),
  source: z.object({
    provider: z.string(),
    dataset: z.string().nullable(),
    version: z.string().nullable(),
    sourceRef: z.string().nullable(),
    citationUrl: z.string().nullable(),
  }),
});

export type FoodSearchResult = z.infer<typeof foodSearchResult>;
export type FoodDetailResponse = z.infer<typeof foodDetailResponse>;
