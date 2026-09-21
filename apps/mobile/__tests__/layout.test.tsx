/**
 * Tab screens have no navigation header, so the Screen wrapper is the only
 * thing keeping content out from under the status bar and Dynamic Island.
 */
import { render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';

// An iPhone with a Dynamic Island: 59 pt of status bar, 34 pt home indicator.
const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderScreen(topInset: boolean) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Screen topInset={topInset}>
        <Text testID="content">content</Text>
      </Screen>
    </SafeAreaProvider>,
  );
}

function contentPadding() {
  const scrollView = screen.UNSAFE_root.findByType(ScrollView) as unknown as {
    props: { contentContainerStyle: unknown };
  };
  return StyleSheet.flatten(scrollView.props.contentContainerStyle) as {
    paddingTop: number;
    paddingBottom: number;
  };
}

describe('Screen safe area', () => {
  it('clears the status bar on a headerless tab screen', () => {
    renderScreen(true);
    expect(contentPadding().paddingTop).toBeGreaterThanOrEqual(59);
  });

  it('adds no top padding where a navigation header already reserves it', () => {
    renderScreen(false);
    expect(contentPadding().paddingTop).toBe(0);
  });

  it('always clears the home indicator at the bottom', () => {
    renderScreen(false);
    expect(contentPadding().paddingBottom).toBeGreaterThanOrEqual(34);
  });
});
