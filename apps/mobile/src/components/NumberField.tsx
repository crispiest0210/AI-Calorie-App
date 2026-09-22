/**
 * The amount field. Exposes screen-reader increment/decrement actions so the
 * gram stepper is adjustable without the keyboard (spec 5.6).
 */
import { Pressable, TextInput, View } from 'react-native';
import { dec, num } from '@nt/core';
import { MIN_TOUCH_TARGET, radii, spacing, tabularNumbers, typography, useTheme } from '../theme';
import { Text } from './Text';

export interface NumberFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  suffix?: string;
  step?: number;
  autoFocus?: boolean;
}

export function NumberField({ value, onChange, label, suffix, step = 10, autoFocus = false }: NumberFieldProps) {
  const { colors } = useTheme();

  const nudge = (delta: number) => {
    const parsed = Number.parseFloat(value);
    const base = Number.isFinite(parsed) ? parsed : 0;
    const next = Math.max(0, base + delta);
    onChange(num(dec(next.toFixed(2))));
  };

  const stepButton = (delta: number, symbol: string, a11y: string) => (
    <Pressable
      onPress={() => nudge(delta)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        width: MIN_TOUCH_TARGET,
        height: MIN_TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        backgroundColor: pressed ? colors.accentMuted : colors.surfaceRaised,
        borderWidth: 1,
        borderColor: colors.border,
      })}
    >
      <Text variant="heading">{symbol}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {stepButton(-step, '−', `Decrease by ${step}`)}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            minHeight: MIN_TOUCH_TARGET,
            backgroundColor: colors.surface,
          }}
        >
          <TextInput
            value={value}
            onChangeText={(text) => onChange(text.replace(/[^\d.]/g, ''))}
            keyboardType="decimal-pad"
            autoFocus={autoFocus}
            selectTextOnFocus
            accessibilityLabel={label}
            style={[typography.title, tabularNumbers, { flex: 1, color: colors.text, paddingVertical: spacing.sm }]}
            placeholderTextColor={colors.textFaint}
            placeholder="0"
          />
          {suffix !== undefined && (
            <Text variant="label" tone="muted">
              {suffix}
            </Text>
          )}
        </View>
        {stepButton(step, '+', `Increase by ${step}`)}
      </View>
    </View>
  );
}
