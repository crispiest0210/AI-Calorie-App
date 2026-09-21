import { TextInput, View, type TextInputProps } from 'react-native';
import { MIN_TOUCH_TARGET, radii, spacing, typography, useTheme } from '@/theme';
import { Text } from './Text';

export function LabelledTextInput({ label, style, ...rest }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        {...rest}
        style={[
          typography.body,
          {
            minHeight: MIN_TOUCH_TARGET,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            color: colors.text,
            backgroundColor: colors.surface,
          },
          style,
        ]}
      />
    </View>
  );
}
