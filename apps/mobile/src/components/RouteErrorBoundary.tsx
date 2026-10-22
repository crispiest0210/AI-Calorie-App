/**
 * What a screen shows when it throws while rendering, instead of taking the
 * whole app down. Every route re-exports this as its `ErrorBoundary`
 * (expo-router), so one broken screen leaves the rest of the stack usable and
 * offers a retry. It renders above the root providers too, so it depends on
 * nothing but the theme.
 */
import { View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { spacing, useTheme } from '../theme';
import { Text } from './Text';
import { Button } from './Button';

export interface ErrorPanelProps {
  title: string;
  body: string;
  error: Error;
  onRetry: () => void;
}

export function ErrorPanel({ title, body, error, onRetry }: ErrorPanelProps) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={{ flex: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background }}
    >
      <Text variant="heading">{title}</Text>
      <Text tone="muted">{body}</Text>
      {__DEV__ && (
        <Text variant="caption" tone="faint">
          {error.message}
        </Text>
      )}
      <Button label="Try again" onPress={onRetry} />
    </View>
  );
}

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ErrorPanel
      title="This screen hit a problem"
      body="Nothing you logged has been lost. Try again, or go back and open it from there."
      error={error}
      onRetry={() => void retry()}
    />
  );
}
