/**
 * Zod schemas shared by the app, the JSON columns and (from Phase 2) the API,
 * so a row validated on one side cannot drift from the other.
 */
import { z } from 'zod';
import { NUTRIENT_CODES } from './nutrients';
import { AMOUNT_UNITS, GRAMS_PROVENANCES } from './units';
import { ENTRY_KINDS, MEAL_SLOTS } from './entries';
import { GOAL_BASES, GOAL_KINDS } from './goals';
import { FOOD_KINDS, QUALITY_TIERS } from './normalize';
import { isLocalDate } from './dates';
import { compare, isPositive } from './decimal';

/** A decimal string as stored and synced — never a float (review item R13). */
export const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'expected a decimal string');

/** A decimal string greater than zero: a zero serving count or portion weight would divide by zero downstream. */
export const positiveNumericString = numericString.refine(isPositive, 'must be greater than zero');

/** A decimal string that is zero or more: a nutrient amount below zero is corrupt data, not a real food. */
export const nonNegativeNumericString = numericString.refine((v) => compare(v, 0) >= 0, 'must not be negative');

export const localDate = z.string().refine(isLocalDate, 'expected YYYY-MM-DD');

/** Epoch milliseconds from 1970 to the end of year 9999, a range both JS dates and Postgres timestamps round-trip. */
export const epochMs = z.number().int().min(0).max(253_402_300_799_999);

/** Minutes east of UTC; real zones span UTC-12:00 to UTC+14:00, so anything outside is corrupt. */
export const tzOffsetMin = z.number().int().min(-720).max(840);

/** Smallest and largest single water entry or preset in mL; mirrors the device repository and the database check. */
export const WATER_ML_MIN = 1;
export const WATER_ML_MAX = 5000;

/** Largest daily water goal in mL; mirrors the device repository's limit so synced rows can't exceed it. */
export const WATER_TARGET_ML_MAX = 20000;

export const nutrientCode = z.enum(NUTRIENT_CODES);
export const nutrientMap = z.record(nutrientCode, nonNegativeNumericString);

export const mealSlot = z.enum(MEAL_SLOTS);
export const entryKind = z.enum(ENTRY_KINDS);
export const amountUnit = z.enum(AMOUNT_UNITS);
export const gramsProvenance = z.enum(GRAMS_PROVENANCES);
export const qualityTier = z.enum(QUALITY_TIERS);
export const foodKind = z.enum(FOOD_KINDS);

export const foodPortionSchema = z.object({
  id: z.string().min(1),
  foodId: z.string().min(1),
  label: z.string().trim().min(1),
  gramWeight: positiveNumericString,
  source: z.enum(['fdc', 'off_serving', 'user']),
});

export const foodSchema = z.object({
  id: z.string().min(1),
  kind: foodKind,
  name: z.string().trim().min(1),
  brand: z.string().nullable(),
  gtin: z.string().regex(/^\d{14}$/, 'expected 14 digits').nullable(),
  qualityTier,
  sourceRef: z.string().nullable(),
  sourceReleaseId: z.string().nullable(),
  densityGPerMl: positiveNumericString.nullable(),
});

/** Cross-field rules every log entry must satisfy, whether it comes from the device or the sync API. */
export const refineLogEntry = (
  entry: {
    entryKind: string;
    foodId: string | null;
    grams: string | null;
    amountValue: string;
    nutrientsPer100g: unknown;
    nutrientsAbsolute: unknown;
  },
  ctx: z.RefinementCtx,
): void => {
  if (entry.entryKind === 'food') {
    if (entry.foodId === null) ctx.addIssue({ code: 'custom', message: 'food entries need a food_id' });
    if (entry.grams === null) ctx.addIssue({ code: 'custom', message: 'food entries need resolved grams' });
    if (entry.nutrientsPer100g === null) ctx.addIssue({ code: 'custom', message: 'food entries need a per-100 g snapshot' });
    if (!isPositive(entry.amountValue)) ctx.addIssue({ code: 'custom', path: ['amountValue'], message: 'must be greater than zero for a food entry' });
  } else if (entry.nutrientsAbsolute === null) {
    ctx.addIssue({ code: 'custom', message: 'quick adds need absolute nutrients' });
  }
  if (entry.grams !== null && compare(entry.grams, 0) < 0) ctx.addIssue({ code: 'custom', path: ['grams'], message: 'must not be negative' });
  if (entry.entryKind === 'food' && entry.grams !== null && !isPositive(entry.grams)) ctx.addIssue({ code: 'custom', path: ['grams'], message: 'must be greater than zero for a food entry' });
  if (compare(entry.amountValue, 0) < 0) ctx.addIssue({ code: 'custom', path: ['amountValue'], message: 'must not be negative' });
};

export const logEntrySchema = z
  .object({
    id: z.string().min(1),
    localDate,
    loggedAt: epochMs,
    tzOffsetMin,
    mealSlot,
    entryKind,
    foodId: z.string().min(1).nullable(),
    amountValue: numericString,
    amountUnit,
    portionId: z.string().min(1).nullable(),
    grams: numericString.nullable(),
    gramsProvenance,
    foodNameSnapshot: z.string().trim().min(1),
    sourceReleaseId: z.string().nullable(),
    nutrientsPer100g: nutrientMap.nullable(),
    nutrientsAbsolute: nutrientMap.nullable(),
    note: z.string().nullable(),
  })
  .superRefine(refineLogEntry);

export const goalTargetSchema = z.object({
  nutrientCode,
  kind: z.enum(GOAL_KINDS),
  value: nonNegativeNumericString.nullable(),
  valueLow: nonNegativeNumericString.nullable(),
  valueHigh: nonNegativeNumericString.nullable(),
  basis: z.enum(GOAL_BASES),
}).superRefine((target, ctx) => {
  // Mirrors the db repository: each kind uses exactly its own value fields.
  const used = {
    target: { value: true, valueLow: false, valueHigh: false },
    min: { value: false, valueLow: true, valueHigh: false },
    max: { value: false, valueLow: false, valueHigh: true },
    range: { value: false, valueLow: true, valueHigh: true },
  }[target.kind];
  for (const key of ['value', 'valueLow', 'valueHigh'] as const) {
    if (used[key] && target[key] === null) ctx.addIssue({ code: 'custom', path: [key], message: `is required for a ${target.kind} goal` });
    if (!used[key] && target[key] !== null) ctx.addIssue({ code: 'custom', path: [key], message: `must be empty for a ${target.kind} goal` });
  }
  if (target.valueLow !== null && target.valueHigh !== null && compare(target.valueLow, target.valueHigh) > 0) {
    ctx.addIssue({ code: 'custom', path: ['valueLow'], message: 'must not exceed valueHigh' });
  }
});

export const goalProfileSchema = z.object({
  id: z.string().min(1),
  effectiveFrom: localDate,
  waterTargetMl: z.number().int().min(1).max(WATER_TARGET_ML_MAX).nullable(),
  targets: z.array(goalTargetSchema),
});

export const waterEntrySchema = z.object({
  id: z.string().min(1),
  localDate,
  loggedAt: epochMs,
  amountMl: z.number().int().min(WATER_ML_MIN).max(WATER_ML_MAX),
});

export const waterPresetSchema = z.object({
  id: z.string().min(1),
  // A blank label would render an empty chip; "no label" is null.
  label: z.string().trim().min(1).nullable(),
  amountMl: z.number().int().min(WATER_ML_MIN).max(WATER_ML_MAX),
  position: z.number().int().min(0),
});

export type FoodRow = z.infer<typeof foodSchema>;
export type LogEntryRow = z.infer<typeof logEntrySchema>;
export type GoalProfileRow = z.infer<typeof goalProfileSchema>;
export type WaterEntryRow = z.infer<typeof waterEntrySchema>;
export type WaterPresetRow = z.infer<typeof waterPresetSchema>;
