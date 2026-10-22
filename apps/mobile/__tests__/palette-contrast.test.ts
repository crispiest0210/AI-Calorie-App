/**
 * The tokens promise WCAG 2.2 AA for every foreground/background pair in both
 * themes (spec 5.5): 4.5:1 for text, 3:1 for large text and non-text marks.
 */
import { darkPalette, lightPalette, type Palette } from '@nt/tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

type Pair = [fg: keyof Palette, bg: keyof Palette, min: number];

const PAIRS: Pair[] = [
  ['text', 'background', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surfaceRaised', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'surface', 4.5],
  ['accentText', 'accent', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'accentMuted', 4.5],
  ['over', 'overSurface', 4.5],
  ['danger', 'surface', 4.5],
  ['chartMark', 'surface', 3],
  ['chartOver', 'surface', 3],
];

describe.each([
  ['light', lightPalette],
  ['dark', darkPalette],
])('%s palette contrast', (_name, palette) => {
  it.each(PAIRS)('%s on %s is at least %s:1', (fg, bg, min) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(min);
  });
});
