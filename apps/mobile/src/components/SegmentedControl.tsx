/** A small single-choice control used for units and meal slots. */
import { Pressable, View } from 'react-native';
import { MIN_TOUCH_TARGET, radii, spacing, useTheme } from '../theme';
import { Text } from './Text';

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: spacing.sm }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: 'center',
                paddingHorizontal: spacing.lg,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.accentMuted : colors.surface,
              }}
            >
              <Text variant="label" tone={selected ? 'accent' : 'muted'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
