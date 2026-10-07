/**
 * Three numbers are not a chart (see the form heuristic): macro averages read
 * better as tiles than as three more plots on a phone screen.
 */
import { View } from 'react-native';
import { radii, spacing, useTheme } from '@/theme';
import { Text } from './Text';

export interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  /** Shown under the value, e.g. "of 131 g target". */
  detail?: string;
  state?: 'neutral' | 'over';
}

export function StatTile({ label, value, unit, detail, state = 'neutral' }: StatTileProps) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit === undefined ? '' : ` ${unit}`}${detail === undefined ? '' : `, ${detail}`}${state === 'over' ? ', over target' : ''}`}
      style={{
        flex: 1,
        minWidth: 96,
        gap: 2,
        padding: spacing.md,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="heading" numeric tone={state === 'over' ? 'over' : 'default'}>
        {value}
        {unit === undefined ? '' : ` ${unit}`}
      </Text>
      {detail !== undefined && (
        <Text variant="caption" tone="faint" numeric>
          {detail}
        </Text>
      )}
    </View>
  );
}
