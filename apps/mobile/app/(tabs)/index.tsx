import { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { localDateOf } from '@nt/core';
import { DayView } from '@/components/DayView';
import { useUiStore, mealSlotForTime } from '@/state/ui';

export default function TodayScreen() {
  const selectedDate = useUiStore((s) => s.selectedDate);
  const setSelectedDate = useUiStore((s) => s.setSelectedDate);
  const setPendingMealSlot = useUiStore((s) => s.setPendingMealSlot);

  // Coming back after midnight should land on the new day, not yesterday.
  // useFocusEffect re-subscribes on every identity change, so the callback is
  // memoised rather than rebuilt each render.
  useFocusEffect(
    useCallback(() => {
      const today = localDateOf();
      if (selectedDate > today) setSelectedDate(today);
    }, [selectedDate, setSelectedDate]),
  );

  useEffect(() => {
    setPendingMealSlot(mealSlotForTime());
  }, [setPendingMealSlot]);

  return <DayView date={selectedDate} showDateNav />;
}
