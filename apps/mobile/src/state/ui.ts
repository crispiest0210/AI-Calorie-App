/**
 * Ephemeral UI state only (spec 2.2): which day Today is showing and which
 * meal the Log sheet was opened for. No user data lives here — that is SQLite's
 * job — so there is nothing to keep in sync.
 */
import { create } from 'zustand';
import { localDateOf, type LocalDate, type MealSlot } from '@nt/core';

interface UiState {
  selectedDate: LocalDate;
  pendingMealSlot: MealSlot;
  setSelectedDate: (date: LocalDate) => void;
  setPendingMealSlot: (slot: MealSlot) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedDate: localDateOf(),
  pendingMealSlot: 'breakfast',
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setPendingMealSlot: (pendingMealSlot) => set({ pendingMealSlot }),
}));

/** The meal a new entry lands in when the user has not picked one. */
export function mealSlotForTime(date: Date = new Date()): MealSlot {
  const hour = date.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}
