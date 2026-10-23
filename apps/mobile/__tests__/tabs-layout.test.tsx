/**
 * The tab bar is the app's main navigation: three tabs in a fixed order,
 * styled from the active palette so dark mode doesn't get a light bar.
 */
import { render } from '@testing-library/react-native';
import { paletteFor } from '@nt/tokens';
import TabsLayout from '../app/(tabs)/_layout';

type ScreenProps = {
  name: string;
  options: { title: string; tabBarIcon: (a: { focused: boolean }) => React.ReactElement };
};

const mockTabs = jest.fn();
const mockScreens: ScreenProps[] = [];

jest.mock('expo-router', () => {
  const Tabs = (props: { children: React.ReactNode } & Record<string, unknown>) => {
    mockTabs(props);
    return props.children;
  };
  Tabs.Screen = (props: ScreenProps) => {
    mockScreens.push(props);
    return null;
  };
  return { Tabs };
});

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ default: jest.fn() }));

const mockScheme = {
  mockReturnValue: (scheme: 'light' | 'dark') =>
    (jest.requireMock('react-native/Libraries/Utilities/useColorScheme').default as jest.Mock).mockReturnValue(scheme),
};

beforeEach(() => {
  mockTabs.mockClear();
  mockScreens.length = 0;
  mockScheme.mockReturnValue('light');
});

describe('tabs layout', () => {
  it('lists Today, History and Settings in that order', () => {
    render(<TabsLayout />);
    expect(mockScreens.map((s) => [s.name, s.options.title])).toEqual([
      ['index', 'Today'],
      ['history', 'History'],
      ['settings', 'Settings'],
    ]);
  });

  it('hides the navigation header on every tab', () => {
    render(<TabsLayout />);
    expect(mockTabs.mock.calls[0][0].screenOptions.headerShown).toBe(false);
  });

  it.each(['light', 'dark'] as const)('colours the tab bar from the %s palette', (scheme) => {
    mockScheme.mockReturnValue(scheme);
    render(<TabsLayout />);
    const { screenOptions } = mockTabs.mock.calls[0][0];
    const colors = paletteFor(scheme);
    expect(screenOptions.tabBarStyle).toEqual({
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
    });
    expect(screenOptions.tabBarActiveTintColor).toBe(colors.accent);
    expect(screenOptions.tabBarInactiveTintColor).toBe(colors.textFaint);
  });

  it('renders a glyph icon for each tab', () => {
    render(<TabsLayout />);
    const glyphs = mockScreens.map((s) => {
      const { toJSON } = render(s.options.tabBarIcon({ focused: false }));
      return JSON.stringify(toJSON());
    });
    for (const glyph of ['●', '▤', '⚙']) {
      expect(glyphs.filter((g) => g.includes(glyph))).toHaveLength(1);
    }
  });
});
