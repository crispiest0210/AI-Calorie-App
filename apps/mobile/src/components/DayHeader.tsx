/** Date arrows on Today; the future is not walkable because it holds nothing. */
import { Pressable, View } from 'react-native';
import { addDays, type LocalDate } from '@nt/core';
import { MIN_TOUCH_TARGET, spacing, useTheme } from '@/theme';
import { Text } from './Text';

export function DayHeader({
  date,
  label,
  onChange,
  canGoForward,
}: {
  date: LocalDate;
  label: string;
  onChange: (date: LocalDate) => void;
  canGoForward: boolean;
}) {
  const { colors } = useTheme();

  const arrow = (delta: number, symbol: string, a11y: string, enabled: boolean) => (
    <Pressable
      onPress={() => onChange(addDays(date, delta))}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !enabled }}
      style={{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.3 }}
    >
      <Text variant="heading" tone="muted">
        {symbol}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
        backgroundColor: colors.background,
      }}
    >
      {arrow(-1, '‹', 'Previous day', true)}
      <Text variant="title">{label}</Text>
      {arrow(1, '›', 'Next day', canGoForward)}
    </View>
  );
}
