import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { localDateOf } from '@nt/core';
import { DayView } from '@/components/DayView';
import { useUiStore, mealSlotForTime } from '@/state/ui';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/RouteErrorBoundary';

export default function TodayScreen() {
  const selectedDate = useUiStore((s) => s.selectedDate);
  const setSelectedDate = useUiStore((s) => s.setSelectedDate);
  const setPendingMealSlot = useUiStore((s) => s.setPendingMealSlot);

  // The calendar day this screen last saw as "today". A viewer sitting on that
  // day when midnight passes moves on with it; one browsing a past day stays.
  const lastToday = useRef(localDateOf());

  // Coming back after midnight should land on the new day, not yesterday.
  // useFocusEffect re-subscribes on every identity change, so the callback is
  // memoised rather than rebuilt each render.
  useFocusEffect(
    useCallback(() => {
      const today = localDateOf();
      if (selectedDate > today || (selectedDate === lastToday.current && today !== lastToday.current)) {
        setSelectedDate(today);
      }
      lastToday.current = today;
    }, [selectedDate, setSelectedDate]),
  );

  useEffect(() => {
    setPendingMealSlot(mealSlotForTime());
  }, [setPendingMealSlot]);

  return <DayView date={selectedDate} showDateNav />;
}
