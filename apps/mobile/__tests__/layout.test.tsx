/**
 * Tab screens have no navigation header, so the Screen wrapper is the only
 * thing keeping content out from under the status bar and Dynamic Island.
 */
import { render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { Card, Screen } from '@/components/Screen';

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

describe('Screen without scrolling', () => {
  it('renders a plain View that still clears the insets', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen scroll={false} topInset>
          <Text testID="content">content</Text>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.UNSAFE_queryByType(ScrollView)).toBeNull();
    const view = screen.getByTestId('content').parent!.parent as unknown as { props: { style: unknown } };
    const style = StyleSheet.flatten(view.props.style) as { flex: number; paddingTop: number; paddingBottom: number };
    expect(style.flex).toBe(1);
    expect(style.paddingTop).toBeGreaterThanOrEqual(59);
    expect(style.paddingBottom).toBeGreaterThanOrEqual(34);
  });

  it('lets a caller style override the default padding', () => {
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Screen scroll={false} style={{ paddingBottom: 0 }}>
          <Text testID="content">content</Text>
        </Screen>
      </SafeAreaProvider>,
    );
    const view = screen.getByTestId('content').parent!.parent as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(view.props.style)).toMatchObject({ paddingBottom: 0 });
  });
});

describe('Card', () => {
  it('renders its children inside a bordered surface', () => {
    render(
      <Card>
        <Text>inside</Text>
      </Card>,
    );
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('merges a caller style over the defaults', () => {
    render(
      <Card style={{ marginTop: 0 }}>
        <Text>inside</Text>
      </Card>,
    );
    const card = screen.getByText('inside').parent!.parent as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ marginTop: 0, borderWidth: 1 });
  });
});
