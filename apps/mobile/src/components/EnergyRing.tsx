/**
 * The energy ring: eaten, target, remaining.
 *
 * Passing the target is shown three ways — a different colour, a dashed
 * pattern, and a text label — because colour alone is not a signal (spec 5.5),
 * and the whole ring carries a text alternative for screen readers (5.6).
 */
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { energyA11yLabel, formatEnergy } from '@nt/core';
import { spacing, useTheme } from '../theme';
import { Text } from './Text';

const SIZE = 168;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface EnergyRingProps {
  consumed: string;
  target: string | null;
  remaining: string | null;
  /** consumed ÷ target, unclamped: 1.2 means 20% over. */
  ratio: number | null;
  incomplete: boolean;
}

export function EnergyRing({ consumed, target, remaining, ratio, incomplete }: EnergyRingProps) {
  const { colors } = useTheme();
  const over = ratio !== null && ratio > 1;
  const filled = Math.min(Math.max(ratio ?? 0, 0), 1);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={energyA11yLabel(consumed, target, remaining)}
      style={{ alignItems: 'center', justifyContent: 'center', height: SIZE, width: SIZE }}
    >
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={colors.track} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={over ? colors.over : colors.accent}
          strokeWidth={STROKE}
          strokeLinecap={over ? 'butt' : 'round'}
          fill="none"
          strokeDasharray={over ? '6 5' : `${CIRCUMFERENCE * filled} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <Text variant="display" numeric>
        {formatEnergy(consumed)}
      </Text>
      <Text variant="caption" tone={over ? 'over' : 'muted'} style={{ marginTop: spacing.xs }}>
        {target === null
          ? 'cal · no target set'
          : over
            ? `${formatEnergy(remaining!.replace('-', ''))} cal over`
            : `${formatEnergy(remaining)} cal left`}
      </Text>
      {incomplete && (
        <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
          incomplete
        </Text>
      )}
    </View>
  );
}
