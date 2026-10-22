import { renderHook } from '@testing-library/react-native';
import { paletteFor } from '@nt/tokens';
import { useTheme } from '@/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ default: jest.fn() }));

const mockScheme = (scheme: 'light' | 'dark' | null) =>
  (jest.requireMock('react-native/Libraries/Utilities/useColorScheme').default as jest.Mock).mockReturnValue(scheme);

describe('useTheme', () => {
  it('returns the dark palette when the system scheme is dark', () => {
    mockScheme('dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
    expect(result.current.colors).toBe(paletteFor('dark'));
  });

  it('returns the light palette for light or unset schemes', () => {
    for (const scheme of ['light', null] as const) {
      mockScheme(scheme);
      const { result } = renderHook(() => useTheme());
      expect(result.current.isDark).toBe(false);
      expect(result.current.colors).toBe(paletteFor('light'));
    }
  });

  it('keeps a stable result across re-renders while the scheme is unchanged', () => {
    mockScheme('dark');
    const { result, rerender } = renderHook(() => useTheme());
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });
});
