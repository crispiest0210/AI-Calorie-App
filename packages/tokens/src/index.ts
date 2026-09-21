/**
 * Design tokens (spec 5.5). Calm and low-density: one accent for progress,
 * neutral greys everywhere else, dark mode from day one. Every foreground /
 * background pair below meets WCAG 2.2 AA (4.5:1 for text, 3:1 for large text
 * and non-text indicators) in both themes.
 */

export interface Palette {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentMuted: string;
  accentText: string;
  /** Over target: paired with a text label and a pattern, never colour alone. */
  over: string;
  overSurface: string;
  water: string;
  protein: string;
  carb: string;
  fat: string;
  track: string;
  danger: string;
  scrim: string;
}

export const lightPalette: Palette = {
  background: '#F7F7F5',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E3E2DE',
  text: '#16150F',
  textMuted: '#5C5A52',
  textFaint: '#86837A',
  accent: '#2F6B4F',
  accentMuted: '#DCEBE2',
  accentText: '#FFFFFF',
  over: '#8A4B1F',
  overSurface: '#FBEDE2',
  water: '#2C6182',
  protein: '#2F6B4F',
  carb: '#8A6A1F',
  fat: '#6B4A8A',
  track: '#E8E7E3',
  danger: '#9B2C2C',
  scrim: 'rgba(22, 21, 15, 0.35)',
};

export const darkPalette: Palette = {
  background: '#131312',
  surface: '#1C1C1A',
  surfaceRaised: '#242422',
  border: '#33322E',
  text: '#F3F2EE',
  textMuted: '#B2AFA6',
  textFaint: '#8B887F',
  accent: '#7FC9A0',
  accentMuted: '#23382C',
  accentText: '#0E1A13',
  over: '#E0A175',
  overSurface: '#33251A',
  water: '#7FB6D9',
  protein: '#7FC9A0',
  carb: '#D9BC72',
  fat: '#BBA0DA',
  track: '#2B2A27',
  danger: '#E88C8C',
  scrim: 'rgba(0, 0, 0, 0.55)',
};

/** 4 pt base scale; layouts stay airy rather than dense. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/**
 * Sizes are unscaled base values; every text style is rendered with the
 * platform font scale applied, up to the largest accessibility sizes.
 */
export const typography = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: '600' as const },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '600' as const },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
} as const;

/** Spec 5.5: 150–250 ms; all of it is skipped when Reduce Motion is on. */
export const motion = { fast: 150, normal: 200, slow: 250 } as const;

/** Spec 5.6: nothing tappable is smaller than 44 × 44 pt. */
export const MIN_TOUCH_TARGET = 44;

/** Totals must not jitter as digits change (spec 5.5). */
export const tabularNumbers = { fontVariant: ['tabular-nums' as const] };

export type ThemeName = 'light' | 'dark';

export function paletteFor(theme: ThemeName): Palette {
  return theme === 'dark' ? darkPalette : lightPalette;
}
