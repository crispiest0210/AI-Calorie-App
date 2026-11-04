/**
 * Tab bar: exactly Today, History and Settings in that order (the Log button
 * lives on Today), header-less, themed, with a highlighted icon for the focused tab.
 */
import { render } from '@testing-library/react-native';
import { paletteFor } from '@nt/tokens';

type ScreenProps = { name: string; options: { title: string; tabBarIcon: (a: { focused: boolean }) => unknown } };
const mockScreens: ScreenProps[] = [];
let mockScreenOptions: Record<string, unknown> = {};

jest.mock('expo-router', () => {
  const Tabs = ({ screenOptions, children }: { screenOptions: Record<string, unknown>; children: unknown }) => {
    mockScreenOptions = screenOptions;
    return children;
  };
  Tabs.Screen = (props: ScreenProps) => {
    mockScreens.push(props);
    return null;
  };
  return { Tabs };
});

import TabsLayout from '../app/(tabs)/_layout';

const palette = paletteFor('light');

describe('TabsLayout', () => {
  beforeEach(() => {
    mockScreens.length = 0;
    render(<TabsLayout />);
  });

  it('declares Today, History and Settings in order', () => {
    expect(mockScreens.map((s) => [s.name, s.options.title])).toEqual([
      ['index', 'Today'],
      ['history', 'History'],
      ['settings', 'Settings'],
    ]);
  });

  it('hides the header and themes the tab bar', () => {
    expect(mockScreenOptions).toMatchObject({
      headerShown: false,
      tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
      tabBarActiveTintColor: palette.accent,
      tabBarInactiveTintColor: palette.textFaint,
    });
  });

  it('renders a distinct glyph icon for each tab', () => {
    const glyphs = mockScreens.map((s) => {
      const { toJSON, unmount } = render(<>{s.options.tabBarIcon({ focused: true }) as never}</>);
      const text = JSON.stringify(toJSON());
      unmount();
      return ['●', '▤', '⚙'].find((g) => text.includes(g));
    });
    expect(glyphs).toEqual(['●', '▤', '⚙']);
  });
});
