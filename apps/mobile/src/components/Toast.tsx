/** The undo toast behind swipe-to-delete (spec 5.2). Quiet, never modal. */
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radii, spacing, useTheme } from '../theme';
import { Text } from './Text';

export interface ToastProps {
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, actionLabel, onAction, onDismiss, durationMs = 5000 }: ToastProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (message === null) return undefined;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, onDismiss]);

  if (message === null) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: insets.bottom + spacing.xl,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.lg,
        padding: spacing.lg,
        borderRadius: radii.md,
        backgroundColor: colors.surfaceRaised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text variant="label" style={{ flexShrink: 1 }}>
        {message}
      </Text>
      {actionLabel !== undefined && onAction !== undefined && (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={12}>
          <Text variant="label" tone="accent">
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
