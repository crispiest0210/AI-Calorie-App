/** One-tap water quick-adds (F6, and the 1-tap target in 5.4). */
import { Pressable, View } from 'react-native';
import type { WaterProgress } from '@nt/core';
import { MIN_TOUCH_TARGET, radii, spacing, useTheme } from '../theme';
import { tapFeedback } from '../hooks/useHaptics';
import { Text } from './Text';

export interface WaterRowProps {
  progress: WaterProgress;
  presets: readonly { id: string; label: string | null; amountMl: number }[];
  onAdd: (amountMl: number) => void;
  onOpen: () => void;
}

export function WaterRow({ progress, presets, onAdd, onOpen }: WaterRowProps) {
  const { colors } = useTheme();
  const ratio = Math.min(Math.max(progress.ratio ?? 0, 0), 1);
  const summary =
    progress.targetMl === null
      ? `Water: ${progress.consumedMl} millilitres, no target set`
      : `Water: ${progress.consumedMl} of ${progress.targetMl} millilitres`;

  return (
    <View style={{ gap: spacing.md }}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={summary} accessibilityHint="Opens today’s water entries">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
          <Text variant="label" tone="muted">
            Water
          </Text>
          <Text variant="label" numeric>
            {progress.consumedMl}
            {progress.targetMl === null ? '' : ` / ${progress.targetMl}`} mL
          </Text>
        </View>
        <View style={{ height: 8, borderRadius: radii.pill, backgroundColor: colors.track, overflow: 'hidden' }}>
          <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: colors.water }} />
        </View>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {presets.map((preset) => (
          <Pressable
            key={preset.id}
            onPress={() => {
              tapFeedback();
              onAdd(preset.amountMl);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Add ${preset.amountMl} millilitres of water`}
            style={({ pressed }) => ({
              minHeight: MIN_TOUCH_TARGET,
              justifyContent: 'center',
              paddingHorizontal: spacing.lg,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.accentMuted : colors.surfaceRaised,
            })}
          >
            <Text variant="label" numeric>
              +{preset.amountMl} mL
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
