import { Stack, useLocalSearchParams } from 'expo-router';
import { formatDayLabel, isLocalDate, localDateOf } from '@nt/core';
import { DayView } from '@/components/DayView';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/RouteErrorBoundary';

/** A past day, editable, in the same layout as Today (spec 5.2). */
export default function PastDayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const today = localDateOf();
  const safeDate = typeof date === 'string' && isLocalDate(date) ? date : today;
  return (
    <>
      <Stack.Screen options={{ title: formatDayLabel(safeDate, today) }} />
      <DayView date={safeDate} showDateNav={false} />
    </>
  );
}
