/**
 * The energy ring: eaten, target, remaining.
 *
 * Passing the target is shown three ways — a different colour, a dashed
 * pattern, and a text label — because colour alone is not a signal (spec 5.5),
 * and the whole ring carries a text alternative for screen readers (5.6).
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { energyA11yLabel, formatEnergy } from '@nt/core';
import { spacing, useTheme } from '../theme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Text } from './Text';

/** Spec 5.5: springs are used on the ring and nowhere else. */
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const SPRING = { damping: 18, stiffness: 120, mass: 0.6 };

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
  const reduceMotion = useReducedMotion();
  const over = ratio !== null && ratio > 1;
  const filled = Math.min(Math.max(ratio ?? 0, 0), 1);

  // The arc settles into its new length when an entry lands. With Reduce
  // Motion on it simply appears there.
  const progress = useSharedValue(filled);
  useEffect(() => {
    progress.value = reduceMotion ? filled : withSpring(filled, SPRING);
  }, [filled, reduceMotion, progress]);

  const arcProps = useAnimatedProps(() => ({
    strokeDasharray: [CIRCUMFERENCE * progress.value, CIRCUMFERENCE],
  }));

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={energyA11yLabel(consumed, target, remaining)}
      style={{ alignItems: 'center', justifyContent: 'center', height: SIZE, width: SIZE }}
    >
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={colors.track} strokeWidth={STROKE} fill="none" />
        {over ? (
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={colors.over}
            strokeWidth={STROKE}
            strokeLinecap="butt"
            fill="none"
            strokeDasharray="6 5"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        ) : (
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={colors.accent}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            animatedProps={arcProps}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
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
