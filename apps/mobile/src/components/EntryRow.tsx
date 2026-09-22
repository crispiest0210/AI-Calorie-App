/** One logged entry inside a meal section. Swipe to delete, tap to edit. */
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { entryNutrients, formatAmount, formatEnergy, isEstimated } from '@nt/core';
import type { EntryView } from '@nt/db';
import { motion, spacing, useTheme } from '../theme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Text } from './Text';

const SWIPE_THRESHOLD = -96;

export function EntryRow({ entry, onPress, onDelete }: { entry: EntryView; onPress: () => void; onDelete: () => void }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const translateX = useSharedValue(0);

  const nutrients = entryNutrients(entry);
  const energy = nutrients.energy_kcal ?? null;
  const amount = formatAmount(entry.amountValue, entry.amountUnit, entry.portionLabel ?? undefined);

  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((event) => {
      translateX.value = Math.min(0, event.translationX);
    })
    .onEnd(() => {
      if (translateX.value < SWIPE_THRESHOLD) {
        runOnJS(onDelete)();
      }
      translateX.value = reduceMotion ? 0 : withTiming(0, { duration: motion.fast });
    });

  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View style={{ backgroundColor: colors.overSurface }}>
      <View style={{ position: 'absolute', right: spacing.lg, top: 0, bottom: 0, justifyContent: 'center' }}>
        <Text variant="label" tone="over">
          Delete
        </Text>
      </View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[animated, { backgroundColor: colors.surface }]}>
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${entry.foodName}, ${amount}${energy === null ? '' : `, ${formatEnergy(energy)} calories`}`}
            accessibilityHint="Opens the entry to edit it"
            accessibilityActions={[{ name: 'magicTap', label: 'Delete entry' }]}
            onAccessibilityAction={onDelete}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              backgroundColor: pressed ? colors.accentMuted : colors.surface,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2}>{entry.foodName}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: 2 }}>
                <Text variant="caption" tone="muted" numeric>
                  {amount}
                </Text>
                {entry.foodBrand !== null && (
                  <Text variant="caption" tone="faint" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {entry.foodBrand}
                  </Text>
                )}
                {isEstimated(entry) && (
                  <Text variant="caption" tone="over">
                    Estimated
                  </Text>
                )}
              </View>
            </View>
            <Text variant="label" numeric tone={energy === null ? 'faint' : 'default'}>
              {energy === null ? '—' : formatEnergy(energy)}
            </Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
