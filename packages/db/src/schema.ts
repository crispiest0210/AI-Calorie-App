/**
 * Drizzle mirror of migrations/0001_init.sql. The SQL files are the source of
 * truth (CI applies them to a fresh database); this file gives the app typed
 * queries over the same tables. `test/schema-drift.test.ts` fails if the two
 * ever disagree.
 */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const nutrientDef = sqliteTable('nutrient_def', {
  code: text('code').primaryKey(),
  displayName: text('display_name').notNull(),
  unit: text('unit').notNull(),
  fdcNutrientIds: text('fdc_nutrient_ids').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const sourceRelease = sqliteTable('source_release', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  dataset: text('dataset'),
  version: text('version'),
  releasedOn: text('released_on'),
  importedAt: integer('imported_at').notNull(),
  isActive: integer('is_active').notNull().default(0),
});

export const food = sqliteTable(
  'food',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    ownerUserId: text('owner_user_id'),
    name: text('name').notNull(),
    brand: text('brand'),
    gtin: text('gtin'),
    sourceReleaseId: text('source_release_id').notNull(),
    sourceRef: text('source_ref'),
    qualityTier: text('quality_tier').notNull(),
    densityGPerMl: text('density_g_per_ml'),
    category: text('category'),
    supersededBy: text('superseded_by'),
    serverRev: integer('server_rev'),
    updatedAt: integer('updated_at'),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('food_name_idx').on(t.name), uniqueIndex('food_gtin_idx').on(t.gtin)],
);

export const foodNutrient = sqliteTable(
  'food_nutrient',
  {
    foodId: text('food_id').notNull(),
    nutrientCode: text('nutrient_code').notNull(),
    amountPer100g: text('amount_per_100g').notNull(),
    derivation: text('derivation').notNull().default('reported'),
  },
  (t) => [primaryKey({ columns: [t.foodId, t.nutrientCode] })],
);

export const foodPortion = sqliteTable(
  'food_portion',
  {
    id: text('id').primaryKey(),
    foodId: text('food_id').notNull(),
    label: text('label').notNull(),
    gramWeight: text('gram_weight').notNull(),
    source: text('source').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('food_portion_food_idx').on(t.foodId, t.position)],
);

export const recipeIngredient = sqliteTable(
  'recipe_ingredient',
  {
    id: text('id').primaryKey(),
    recipeFoodId: text('recipe_food_id').notNull(),
    ingredientFoodId: text('ingredient_food_id').notNull(),
    grams: text('grams').notNull(),
    position: integer('position').notNull().default(0),
    serverRev: integer('server_rev'),
    updatedAt: integer('updated_at'),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('recipe_ingredient_recipe_idx').on(t.recipeFoodId, t.position)],
);

export const recipeMeta = sqliteTable('recipe_meta', {
  foodId: text('food_id').primaryKey(),
  totalCookedGrams: text('total_cooked_grams'),
  servings: text('servings').notNull().default('1'),
});

export const logEntry = sqliteTable(
  'log_entry',
  {
    id: text('id').primaryKey(),
    localDate: text('local_date').notNull(),
    loggedAt: integer('logged_at').notNull(),
    tzOffsetMin: integer('tz_offset_min').notNull(),
    mealSlot: text('meal_slot').notNull(),
    entryKind: text('entry_kind').notNull(),
    foodId: text('food_id'),
    amountValue: text('amount_value').notNull(),
    amountUnit: text('amount_unit').notNull(),
    portionId: text('portion_id'),
    grams: text('grams'),
    gramsProvenance: text('grams_provenance').notNull(),
    aiGramsLow: text('ai_grams_low'),
    aiGramsHigh: text('ai_grams_high'),
    foodNameSnapshot: text('food_name_snapshot').notNull(),
    sourceReleaseId: text('source_release_id'),
    nutrientsPer100g: text('nutrients_per_100g'),
    nutrientsAbsolute: text('nutrients_absolute'),
    note: text('note'),
    serverRev: integer('server_rev'),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('log_entry_day_idx').on(t.localDate), index('log_entry_food_idx').on(t.foodId, t.loggedAt), index('log_entry_rev_idx').on(t.serverRev)],
);

export const goalProfile = sqliteTable('goal_profile', {
  id: text('id').primaryKey(),
  effectiveFrom: text('effective_from').notNull().unique(),
  waterTargetMl: integer('water_target_ml'),
  serverRev: integer('server_rev'),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const goalTarget = sqliteTable(
  'goal_target',
  {
    goalProfileId: text('goal_profile_id').notNull(),
    nutrientCode: text('nutrient_code').notNull(),
    kind: text('kind').notNull(),
    valueLow: text('value_low'),
    valueHigh: text('value_high'),
    value: text('value'),
    basis: text('basis').notNull().default('absolute'),
  },
  (t) => [primaryKey({ columns: [t.goalProfileId, t.nutrientCode] })],
);

export const waterEntry = sqliteTable(
  'water_entry',
  {
    id: text('id').primaryKey(),
    localDate: text('local_date').notNull(),
    loggedAt: integer('logged_at').notNull(),
    amountMl: integer('amount_ml').notNull(),
    serverRev: integer('server_rev'),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('water_entry_day_idx').on(t.localDate)],
);

export const waterPreset = sqliteTable('water_preset', {
  id: text('id').primaryKey(),
  label: text('label'),
  amountMl: integer('amount_ml').notNull(),
  position: integer('position').notNull().default(0),
  serverRev: integer('server_rev'),
  updatedAt: integer('updated_at'),
  deletedAt: integer('deleted_at'),
});

export const outbox = sqliteTable(
  'outbox',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    op: text('op').notNull(),
    createdAt: integer('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('outbox_row_idx').on(t.tableName, t.rowId)],
);

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const schema = {
  nutrientDef,
  sourceRelease,
  food,
  foodNutrient,
  foodPortion,
  recipeIngredient,
  recipeMeta,
  logEntry,
  goalProfile,
  goalTarget,
  waterEntry,
  waterPreset,
  outbox,
  syncState,
  appSetting,
};

export type Schema = typeof schema;
