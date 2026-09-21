/** A food in the search, recents or frequents list. */
import { Pressable, View } from 'react-native';
import { formatEnergy } from '@nt/core';
import type { FoodSummary } from '@nt/db';
import { MIN_TOUCH_TARGET, spacing, useTheme } from '../theme';
import { Text } from './Text';
import { SourceBadge } from './SourceBadge';

export function FoodRow({ food, subtitle, onPress, onLongPress }: { food: FoodSummary; subtitle?: string; onPress: () => void; onLongPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${food.name}${food.brand === null ? '' : `, ${food.brand}`}${
        food.energyPer100g === null ? '' : `, ${formatEnergy(food.energyPer100g)} calories per 100 grams`
      }`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: MIN_TOUCH_TARGET + 12,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: pressed ? colors.accentMuted : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2}>{food.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {food.brand !== null && (
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {food.brand}
            </Text>
          )}
          <SourceBadge tier={food.qualityTier} />
          {subtitle !== undefined && (
            <Text variant="caption" tone="faint">
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      <Text variant="label" tone="muted" numeric>
        {food.energyPer100g === null ? '—' : `${formatEnergy(food.energyPer100g)}`}
      </Text>
      <Text variant="caption" tone="faint">
        /100 g
      </Text>
    </Pressable>
  );
}
