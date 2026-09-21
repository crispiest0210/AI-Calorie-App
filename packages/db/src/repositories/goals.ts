/**
 * Goals are versioned by date (F1, spec 3.5): saving never edits a past
 * profile, it opens a new one effective from the given day, so a day read
 * later still shows the goals that applied then.
 */
import { asc, desc, eq, isNull, lte, and } from 'drizzle-orm';
import { localDateOf, uuidv7, type GoalProfile, type GoalTarget, type LocalDate, type NutrientCode } from '@nt/core';
import { goalProfile, goalTarget } from '../schema';
import type { Db } from '../db';
import { enqueue } from './outbox';

function targetsFor(db: Db, profileId: string): GoalTarget[] {
  return db
    .select()
    .from(goalTarget)
    .where(eq(goalTarget.goalProfileId, profileId))
    .all()
    .map((row) => ({
      nutrientCode: row.nutrientCode as NutrientCode,
      kind: row.kind as GoalTarget['kind'],
      value: row.value,
      valueLow: row.valueLow,
      valueHigh: row.valueHigh,
      basis: row.basis as GoalTarget['basis'],
    }));
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
  const now = at.getTime();
  const effectiveFrom = input.effectiveFrom ?? localDateOf(at);
  return db.transaction((tx) => {
    const existing = tx.select().from(goalProfile).where(eq(goalProfile.effectiveFrom, effectiveFrom)).get();
    const id = existing?.id ?? uuidv7(now);

    if (existing) {
      tx.update(goalProfile).set({ waterTargetMl: input.waterTargetMl, updatedAt: now, deletedAt: null }).where(eq(goalProfile.id, id)).run();
      tx.delete(goalTarget).where(eq(goalTarget.goalProfileId, id)).run();
    } else {
      tx.insert(goalProfile).values({ id, effectiveFrom, waterTargetMl: input.waterTargetMl, updatedAt: now }).run();
    }

    for (const target of input.targets) {
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
