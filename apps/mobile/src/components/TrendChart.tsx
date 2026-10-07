/**
 * Daily energy against the target that applied on each day (F12).
 *
 * One measure, one axis, one series — so there is no legend and no second
 * scale. Over-target is carried three ways, never by colour alone: the bar
 * crosses the target line, it is hatched, and its spoken label says "over".
 * Tapping a bar opens that day, which is the touch equivalent of a tooltip.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, Line, Path, Pattern, Rect } from 'react-native-svg';
import { formatDayLabel, formatEnergy, type LocalDate } from '@nt/core';
import { radii, spacing, useTheme } from '@/theme';
import { Text } from './Text';

export interface TrendDay {
  date: LocalDate;
  energy: number | null;
  target: number | null;
}

const HEIGHT = 128;
const GAP = 2;
const MARK_RADIUS = 4;

export function TrendChart({ days, today, onSelectDay }: { days: readonly TrendDay[]; today: LocalDate; onSelectDay: (date: LocalDate) => void }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  const logged = days.filter((d) => d.energy !== null);
  const peak = Math.max(...days.map((d) => Math.max(d.energy ?? 0, d.target ?? 0)), 1);
  const barWidth = width === 0 ? 0 : Math.max(2, width / days.length - GAP);
  const scale = (value: number) => (value / peak) * (HEIGHT - 8);

  // One target line, drawn at the most recent day's target: goals change
  // rarely, and a line per day would be noise rather than information.
  const target = [...days].reverse().find((d) => d.target !== null)?.target ?? null;
  const average = logged.length === 0 ? null : Math.round(logged.reduce((sum, d) => sum + (d.energy ?? 0), 0) / logged.length);

  const summary =
    logged.length === 0
      ? 'No days logged in this range.'
      : `Energy over ${days.length} days: ${logged.length} logged, averaging ${average} calories a day` +
        (target === null ? ', no target set.' : ` against a target of ${Math.round(target)}.`);

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ height: HEIGHT, justifyContent: 'flex-end' }}
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              {/* The non-colour cue for over target, at 45 degrees. */}
              <Pattern id="over" patternUnits="userSpaceOnUse" width={4} height={4}>
                <Rect width={4} height={4} fill={colors.chartOver} />
                <Path d="M0,4 L4,0" stroke={colors.surface} strokeWidth={1} />
              </Pattern>
            </Defs>

            {target !== null && (
              <Line
                x1={0}
                y1={HEIGHT - scale(target)}
                x2={width}
                y2={HEIGHT - scale(target)}
                stroke={colors.textFaint}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {days.map((day, index) => {
              if (day.energy === null) return null;
              const height = Math.max(scale(day.energy), MARK_RADIUS);
              const over = day.target !== null && day.energy > day.target;
              return (
                <Rect
                  key={day.date}
                  x={index * (barWidth + GAP)}
                  y={HEIGHT - height}
                  width={barWidth}
                  height={height}
                  rx={MARK_RADIUS}
                  fill={over ? 'url(#over)' : colors.chartMark}
                />
              );
            })}
          </Svg>
        )}

        {/* Touch targets sit above the marks and are the full height of the
            plot, so a 9 px bar is still comfortably tappable. */}
        <View style={{ position: 'absolute', inset: 0, flexDirection: 'row' }}>
          {days.map((day) => (
            <Pressable
              key={day.date}
              onPress={() => onSelectDay(day.date)}
              accessibilityRole="button"
              accessibilityLabel={
                day.energy === null
                  ? `${formatDayLabel(day.date, today)}, nothing logged`
                  : `${formatDayLabel(day.date, today)}, ${formatEnergy(String(day.energy))} calories${
                      day.target !== null && day.energy > day.target ? ', over target' : ''
                    }`
              }
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="faint">
          {days[0] === undefined ? '' : formatDayLabel(days[0].date, today)}
        </Text>
        {target !== null && (
          <Text variant="caption" tone="faint" numeric>
            target {formatEnergy(String(target))}
          </Text>
        )}
        <Text variant="caption" tone="faint">
          {formatDayLabel(today, today)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 10, height: 10, borderRadius: radii.sm, backgroundColor: colors.chartOver }} />
        <Text variant="caption" tone="muted">
          Hatched bars went over that day&apos;s target
        </Text>
      </View>
    </View>
  );
}
