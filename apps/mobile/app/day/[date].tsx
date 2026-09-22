import { useLocalSearchParams } from 'expo-router';
import { isLocalDate, localDateOf } from '@nt/core';
import { DayView } from '@/components/DayView';

/** A past day, editable, in the same layout as Today (spec 5.2). */
export default function PastDayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const safeDate = typeof date === 'string' && isLocalDate(date) ? date : localDateOf();
  return <DayView date={safeDate} showDateNav={false} />;
}
