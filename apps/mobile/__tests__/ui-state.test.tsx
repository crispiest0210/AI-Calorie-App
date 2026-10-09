/**
 * Ephemeral UI state (spec 2.2) and the search-input debounce (spec 2.13).
 */
import { act, renderHook } from '@testing-library/react-native';
import { mealSlotForTime, useUiStore } from '@/state/ui';
import { useDebounced } from '@/hooks/useDebounced';

const at = (hour: number, minute = 0) => new Date(2026, 5, 15, hour, minute);

describe('mealSlotForTime', () => {
  it('maps the hour of day to a meal slot', () => {
    expect(mealSlotForTime(at(0))).toBe('breakfast');
    expect(mealSlotForTime(at(10, 59))).toBe('breakfast');
    expect(mealSlotForTime(at(11))).toBe('lunch');
    expect(mealSlotForTime(at(14, 59))).toBe('lunch');
    expect(mealSlotForTime(at(15))).toBe('dinner');
    expect(mealSlotForTime(at(20, 59))).toBe('dinner');
    expect(mealSlotForTime(at(21))).toBe('snack');
    expect(mealSlotForTime(at(23, 59))).toBe('snack');
  });
});

describe('useUiStore', () => {
  it('updates the selected date and pending meal slot', () => {
    act(() => {
      useUiStore.getState().setSelectedDate('2026-01-02');
      useUiStore.getState().setPendingMealSlot('dinner');
    });
    expect(useUiStore.getState().selectedDate).toBe('2026-01-02');
    expect(useUiStore.getState().pendingMealSlot).toBe('dinner');
  });
});

describe('useDebounced', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('holds the old value until the delay has passed without changes', () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => useDebounced(value, 300), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ value: 'ab' });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender({ value: 'abc' });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current).toBe('abc');
  });
});
