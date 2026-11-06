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
import { compare } from './decimal';

/** A decimal string as stored and synced — never a float (review item R13). */
export const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'expected a decimal string');

export const localDate = z.string().refine(isLocalDate, 'expected YYYY-MM-DD');

export const nutrientCode = z.enum(NUTRIENT_CODES);
export const nutrientMap = z.record(nutrientCode, numericString);

export const mealSlot = z.enum(MEAL_SLOTS);
export const entryKind = z.enum(ENTRY_KINDS);
export const amountUnit = z.enum(AMOUNT_UNITS);
export const gramsProvenance = z.enum(GRAMS_PROVENANCES);
export const qualityTier = z.enum(QUALITY_TIERS);
export const foodKind = z.enum(FOOD_KINDS);

export const foodPortionSchema = z.object({
  id: z.string(),
  foodId: z.string(),
  label: z.string().min(1),
  gramWeight: numericString,
  source: z.enum(['fdc', 'off_serving', 'user']),
});

export const foodSchema = z.object({
  id: z.string(),
  kind: foodKind,
  name: z.string().min(1),
  brand: z.string().nullable(),
  gtin: z.string().nullable(),
  qualityTier,
  sourceRef: z.string().nullable(),
  sourceReleaseId: z.string().nullable(),
  densityGPerMl: numericString.nullable(),
});

export const logEntrySchema = z
  .object({
    id: z.string(),
    localDate,
    loggedAt: z.number().int(),
    tzOffsetMin: z.number().int(),
    mealSlot,
    entryKind,
    foodId: z.string().nullable(),
    amountValue: numericString,
    amountUnit,
    portionId: z.string().nullable(),
    grams: numericString.nullable(),
    gramsProvenance,
    foodNameSnapshot: z.string().min(1),
    sourceReleaseId: z.string().nullable(),
    nutrientsPer100g: nutrientMap.nullable(),
    nutrientsAbsolute: nutrientMap.nullable(),
    note: z.string().nullable(),
  })
  .superRefine((entry, ctx) => {
    if (entry.entryKind === 'food') {
      if (entry.foodId === null) ctx.addIssue({ code: 'custom', message: 'food entries need a food_id' });
      if (entry.grams === null) ctx.addIssue({ code: 'custom', message: 'food entries need resolved grams' });
      if (entry.nutrientsPer100g === null) ctx.addIssue({ code: 'custom', message: 'food entries need a per-100 g snapshot' });
    } else if (entry.nutrientsAbsolute === null) {
      ctx.addIssue({ code: 'custom', message: 'quick adds need absolute nutrients' });
    }
  });

export const goalTargetSchema = z.object({
  nutrientCode,
  kind: z.enum(GOAL_KINDS),
  value: numericString.nullable(),
  valueLow: numericString.nullable(),
  valueHigh: numericString.nullable(),
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
  id: z.string(),
  effectiveFrom: localDate,
  waterTargetMl: z.number().int().positive().nullable(),
  targets: z.array(goalTargetSchema),
});

export const waterEntrySchema = z.object({
  id: z.string(),
  localDate,
  loggedAt: z.number().int(),
  amountMl: z.number().int().min(1).max(5000),
});

export const waterPresetSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  amountMl: z.number().int().min(1).max(5000),
  position: z.number().int(),
});

export type FoodRow = z.infer<typeof foodSchema>;
export type LogEntryRow = z.infer<typeof logEntrySchema>;
export type GoalProfileRow = z.infer<typeof goalProfileSchema>;
export type WaterEntryRow = z.infer<typeof waterEntrySchema>;
export type WaterPresetRow = z.infer<typeof waterPresetSchema>;
