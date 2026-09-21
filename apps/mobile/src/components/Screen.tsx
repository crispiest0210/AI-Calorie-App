import type { ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, useTheme } from '../theme';

export function Screen({
  children,
  scroll = true,
  topInset = false,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  /**
   * Tab screens draw with no navigation header, so nothing reserves space for
   * the status bar and Dynamic Island — without this the first row of content
   * sits under the clock and the camera cutout. Screens pushed onto the stack
   * have a header and must not add it twice.
   */
  topInset?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: topInset ? insets.top + spacing.sm : 0,
    paddingBottom: insets.bottom + spacing.xxl,
  };

  if (!scroll) {
    return <View style={[{ flex: 1, backgroundColor: colors.background }, padding, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[padding, style]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: spacing.lg,
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
