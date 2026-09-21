/**
 * One read for the Today screen: entries, water and goals for a date, with
 * totals and progress computed by the engine (not by SQL — see the note on
 * v_day_entry in the migration).
 */
import {
  dayTotals,
  profileForDate,
  progressForProfile,
  waterProgress,
  type DayTotals,
  type GoalProfile,
  type GoalProgress,
  type LocalDate,
  type WaterProgress,
} from '@nt/core';
import type { Db } from './db';
import { entriesForDate, type EntryView } from './repositories/entries';
import { goalsForDate } from './repositories/goals';
import { waterForDate, waterTotalMl } from './repositories/water';

export interface DaySnapshot {
  date: LocalDate;
  entries: EntryView[];
  totals: DayTotals;
  goals: GoalProfile | null;
  progress: GoalProgress[];
  water: WaterProgress;
  waterEntries: ReturnType<typeof waterForDate>;
}

export function readDay(db: Db, date: LocalDate): DaySnapshot {
  const entries = entriesForDate(db, date);
  const goals = goalsForDate(db, date);
  const totals = dayTotals(entries);
  return {
    date,
    entries,
    totals,
    goals,
    progress: progressForProfile(totals.total, goals),
    water: waterProgress(waterTotalMl(db, date), goals?.waterTargetMl ?? null),
    waterEntries: waterForDate(db, date),
  };
}

/** Same shape as readDay, for a profile the caller already has (History charts). */
export function progressFor(totals: DayTotals, profiles: readonly GoalProfile[], date: LocalDate): GoalProgress[] {
  return progressForProfile(totals.total, profileForDate(profiles, date));
}
