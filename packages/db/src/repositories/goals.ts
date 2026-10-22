/**
 * Goals are versioned by date (F1, spec 3.5): saving never edits a past
 * profile, it opens a new one effective from the given day, so a day read
 * later still shows the goals that applied then.
 */
import { asc, desc, eq, isNull, lte, and } from 'drizzle-orm';
import {
  GOAL_BASES,
  GOAL_KINDS,
  compare,
  isNutrientCode,
  localDateOf,
  uuidv7,
  type GoalProfile,
  type GoalTarget,
  type LocalDate,
  type NutrientCode,
} from '@nt/core';
import { goalProfile, goalTarget } from '../schema';
import type { Db } from '../db';
import { ValidationError, WATER_TARGET_ML_MAX, integerInRange, isReadableNum, nonNegativeNum, reportUnreadable } from '../validate';
import { enqueue } from './outbox';

function targetsFor(db: Db, profileId: string): GoalTarget[] {
  return db
    .select()
    .from(goalTarget)
    .where(eq(goalTarget.goalProfileId, profileId))
    .all()
    .flatMap((row) => {
      // A target the engine cannot read is no target, rather than a crash on every day it covers.
      const unreadable = [row.value, row.valueLow, row.valueHigh].some((v) => v !== null && !isReadableNum(v));
      if (unreadable) {
        reportUnreadable('goal_target', profileId, row.nutrientCode);
        return [];
      }
      return [{
        nutrientCode: row.nutrientCode as NutrientCode,
        kind: row.kind as GoalTarget['kind'],
        value: row.value,
        valueLow: row.valueLow,
        valueHigh: row.valueHigh,
        basis: row.basis as GoalTarget['basis'],
      }];
    });
}

/** The value fields each kind needs; the others must be empty. */
const REQUIRED_VALUES: Record<GoalTarget['kind'], readonly ('value' | 'valueLow' | 'valueHigh')[]> = {
  target: ['value'],
  min: ['valueLow'],
  max: ['valueHigh'],
  range: ['valueLow', 'valueHigh'],
};

function validTarget(target: GoalTarget): GoalTarget {
  const field = `targets.${target.nutrientCode}`;
  if (!isNutrientCode(target.nutrientCode)) throw new ValidationError(field, 'is not a nutrient code');
  if (!GOAL_KINDS.includes(target.kind)) throw new ValidationError(`${field}.kind`, 'is not a goal kind');
  if (!GOAL_BASES.includes(target.basis)) throw new ValidationError(`${field}.basis`, 'is not a goal basis');
  const required = REQUIRED_VALUES[target.kind];
  const out: GoalTarget = { nutrientCode: target.nutrientCode, kind: target.kind, value: null, valueLow: null, valueHigh: null, basis: target.basis };
  for (const key of ['value', 'valueLow', 'valueHigh'] as const) {
    const raw = target[key] ?? null;
    if (!required.includes(key)) {
      if (raw !== null) throw new ValidationError(`${field}.${key}`, `must be empty for a ${target.kind} goal`);
      continue;
    }
    // A blank goal is no goal: the caller omits the target rather than storing a zero.
    if (raw === null) throw new ValidationError(`${field}.${key}`, `is required for a ${target.kind} goal`);
    const parsed = nonNegativeNum(`${field}.${key}`, raw);
    if (target.basis === 'pct_energy' && compare(parsed, '100') > 0) {
      throw new ValidationError(`${field}.${key}`, 'must be at most 100 percent');
    }
    out[key] = parsed;
  }
  if (out.valueLow != null && out.valueHigh != null && compare(out.valueLow, out.valueHigh) > 0) {
    throw new ValidationError(`${field}.valueLow`, 'must not exceed valueHigh');
  }
  return out;
}

/** The profile in force on a date, read straight from SQL. */
export function goalsForDate(db: Db, date: LocalDate): GoalProfile | null {
  const row = db
    .select()
    .from(goalProfile)
    .where(and(lte(goalProfile.effectiveFrom, date), isNull(goalProfile.deletedAt)))
    .orderBy(desc(goalProfile.effectiveFrom))
    .limit(1)
    .get();
  if (!row) return null;
  return { id: row.id, effectiveFrom: row.effectiveFrom, waterTargetMl: row.waterTargetMl, targets: targetsFor(db, row.id) };
}

export function allGoalProfiles(db: Db): GoalProfile[] {
  return db
    .select()
    .from(goalProfile)
    .where(isNull(goalProfile.deletedAt))
    .orderBy(asc(goalProfile.effectiveFrom))
    .all()
    .map((row) => ({ id: row.id, effectiveFrom: row.effectiveFrom, waterTargetMl: row.waterTargetMl, targets: targetsFor(db, row.id) }));
}

export interface SaveGoalsInput {
  waterTargetMl: number | null;
  targets: readonly GoalTarget[];
  /** Defaults to today: edits apply from now on, never backwards. */
  effectiveFrom?: LocalDate;
}

export function saveGoals(db: Db, input: SaveGoalsInput, at = new Date()): string {
  const waterTargetMl = input.waterTargetMl === null ? null : integerInRange('waterTargetMl', input.waterTargetMl, 1, WATER_TARGET_ML_MAX);
  const targets = input.targets.map(validTarget);
  const codes = new Set(targets.map((t) => t.nutrientCode));
  if (codes.size !== targets.length) throw new ValidationError('targets', 'has more than one goal for a nutrient');
  const now = at.getTime();
  const effectiveFrom = input.effectiveFrom ?? localDateOf(at);
  return db.transaction((tx) => {
    const existing = tx.select().from(goalProfile).where(eq(goalProfile.effectiveFrom, effectiveFrom)).get();
    const id = existing?.id ?? uuidv7(now);

    if (existing) {
      tx.update(goalProfile).set({ waterTargetMl, updatedAt: now, deletedAt: null }).where(eq(goalProfile.id, id)).run();
      tx.delete(goalTarget).where(eq(goalTarget.goalProfileId, id)).run();
    } else {
      tx.insert(goalProfile).values({ id, effectiveFrom, waterTargetMl, updatedAt: now }).run();
    }

    for (const target of targets) {
      tx.insert(goalTarget)
        .values({
          goalProfileId: id,
          nutrientCode: target.nutrientCode,
          kind: target.kind,
          value: target.value ?? null,
          valueLow: target.valueLow ?? null,
          valueHigh: target.valueHigh ?? null,
          basis: target.basis,
        })
        .run();
    }
    enqueue(tx, 'goal_profile', id, 'upsert', now);
    return id;
  });
}
