/**
 * Screen reserves the safe-area insets: the bottom inset always, the top inset
 * only for header-less tab screens (a stack header would double it).
 */
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { spacing } from '@/theme';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

/** Nearest ancestor of the body text that carries the padding. */
function paddedStyle() {
  let node = screen.getByText('body').parent;
  while (node) {
    // ScrollView pads through contentContainerStyle, a plain View through style.
    for (const prop of [node.props.contentContainerStyle, node.props.style]) {
      const style = StyleSheet.flatten(prop);
      if (style && 'paddingBottom' in style) return style;
    }
    node = node.parent;
  }
  throw new Error('no padded ancestor');
}

function renderScreen(props: Parameters<typeof Screen>[0]) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Screen {...props} />
    </SafeAreaProvider>,
  );
}

describe('Screen', () => {
  it('pads the bottom inset but not the top by default', () => {
    renderScreen({ children: <Text>body</Text> });
    const content = paddedStyle();
    expect(content.paddingTop).toBe(0);
    expect(content.paddingBottom).toBe(34 + spacing.xxl);
  });

  it('adds the top inset for tab screens', () => {
    renderScreen({ topInset: true, children: <Text>body</Text> });
    const content = paddedStyle();
    expect(content.paddingTop).toBe(47 + spacing.sm);
  });

  it('renders a plain padded view when scrolling is off', () => {
    renderScreen({ scroll: false, topInset: true, children: <Text>body</Text> });
    const style = paddedStyle();
    expect(style.flex).toBe(1);
    expect(style.paddingTop).toBe(47 + spacing.sm);
    expect(style.paddingBottom).toBe(34 + spacing.xxl);
  });
});
