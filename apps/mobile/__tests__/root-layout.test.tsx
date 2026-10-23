/**
 * The root layout registers every route with the stack, keeps modals as modals,
 * hides the splash screen once mounted, and themes the status bar and headers.
 */
import { render } from '@testing-library/react-native';
import { paletteFor } from '@nt/tokens';
import RootLayout from '../app/_layout';

type ScreenProps = { name: string; options?: { presentation?: string; title?: string; headerShown?: boolean } };

const mockStack = jest.fn();
const mockScreens: ScreenProps[] = [];
const mockStatusBar = jest.fn();
const mockHideAsync = jest.fn();

jest.mock('@/polyfills', () => ({}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/db/provider', () => ({ DatabaseProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/auth/provider', () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/sync/provider', () => ({ SyncProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-status-bar', () => ({
  StatusBar: (props: Record<string, unknown>) => {
    mockStatusBar(props);
    return null;
  },
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: (...args: unknown[]) => mockHideAsync(...args),
}));
jest.mock('expo-router', () => {
  const Stack = (props: { children: React.ReactNode } & Record<string, unknown>) => {
    mockStack(props);
    return props.children;
  };
  Stack.Screen = (props: ScreenProps) => {
    mockScreens.push(props);
    return null;
  };
  return { Stack };
});

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ default: jest.fn() }));

const setScheme = (scheme: 'light' | 'dark') =>
  (jest.requireMock('react-native/Libraries/Utilities/useColorScheme').default as jest.Mock).mockReturnValue(scheme);

beforeEach(() => {
  mockStack.mockClear();
  mockStatusBar.mockClear();
  mockHideAsync.mockClear();
  mockScreens.length = 0;
  setScheme('light');
});

describe('root layout', () => {
  it('registers every route once', () => {
    render(<RootLayout />);
    const names = mockScreens.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(
      [
        '(tabs)', 'log', 'amount', 'quick-add', 'custom-food', 'water', 'goals', 'entry/[id]',
        'day/[date]', 'sign-in', 'scan', 'recipes', 'recipe/[id]', 'provenance', 'photo', 'photo-review',
      ].sort(),
    );
  });

  it('hides the tab navigator header and presents entry flows as modals', () => {
    render(<RootLayout />);
    const byName = Object.fromEntries(mockScreens.map((s) => [s.name, s.options]));
    expect(byName['(tabs)']?.headerShown).toBe(false);
    for (const name of ['log', 'amount', 'quick-add', 'custom-food', 'water', 'sign-in', 'scan', 'provenance', 'photo']) {
      expect(byName[name]?.presentation).toBe('modal');
    }
    for (const name of ['goals', 'entry/[id]', 'day/[date]', 'recipes', 'recipe/[id]', 'photo-review']) {
      expect(byName[name]?.presentation).toBeUndefined();
    }
  });

  it('hides the splash screen once mounted', () => {
    render(<RootLayout />);
    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['light', 'dark'],
    ['dark', 'light'],
  ] as const)('uses the %s palette with a %s status bar', (scheme, barStyle) => {
    setScheme(scheme);
    render(<RootLayout />);
    const colors = paletteFor(scheme);
    expect(mockStatusBar).toHaveBeenCalledWith(expect.objectContaining({ style: barStyle }));
    const { screenOptions } = mockStack.mock.calls[0][0];
    expect(screenOptions.headerStyle).toEqual({ backgroundColor: colors.background });
    expect(screenOptions.headerTintColor).toBe(colors.text);
    expect(screenOptions.contentStyle).toEqual({ backgroundColor: colors.background });
  });
});
