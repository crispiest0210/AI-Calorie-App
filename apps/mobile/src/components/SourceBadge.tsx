/** The data-quality tier, visible on every food (spec 2.5). */
import { Pressable, View } from 'react-native';
import { QUALITY_TIER_BADGES, type QualityTier } from '@nt/core';
import { radii, spacing, useTheme } from '../theme';
import { Text } from './Text';

export function SourceBadge({ tier, onPress }: { tier: QualityTier | string | null; onPress?: () => void }) {
  const { colors } = useTheme();
  if (tier === null) return null;
  const label = QUALITY_TIER_BADGES[tier as QualityTier] ?? String(tier);

  const body = (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radii.pill,
        backgroundColor: colors.accentMuted,
      }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );

  if (onPress === undefined) return body;
  return (
    <Pressable
      onLongPress={onPress}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Data source: ${label}`}
      accessibilityHint="Shows where this number comes from"
    >
      {body}
    </Pressable>
  );
}
