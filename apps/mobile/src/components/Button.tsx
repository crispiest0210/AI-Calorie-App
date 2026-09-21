import { Pressable, View, type ViewStyle } from 'react-native';
import { MIN_TOUCH_TARGET, radii, spacing, useTheme } from '../theme';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  /** Spoken instead of the label when the label alone is not enough. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, accessibilityLabel, accessibilityHint, style }: ButtonProps) {
  const { colors } = useTheme();
  const background = variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.surfaceRaised : 'transparent';
  const textTone = variant === 'primary' ? undefined : 'accent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          minHeight: MIN_TOUCH_TARGET,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderRadius: radii.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text variant="label" tone={textTone} style={variant === 'primary' ? { color: colors.accentText } : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, gap = spacing.sm, style }: { children: React.ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}
