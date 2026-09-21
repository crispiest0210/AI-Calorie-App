/** Theme access for components: palette, spacing, type scale, motion. */
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { MIN_TOUCH_TARGET, motion, paletteFor, radii, spacing, tabularNumbers, typography, type Palette } from '@nt/tokens';

export { MIN_TOUCH_TARGET, motion, radii, spacing, tabularNumbers, typography };
export type { Palette };

export function useTheme(): { colors: Palette; isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return useMemo(() => ({ colors: paletteFor(isDark ? 'dark' : 'light'), isDark }), [isDark]);
}
