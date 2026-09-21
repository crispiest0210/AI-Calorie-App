import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { tabularNumbers, typography, useTheme } from '../theme';

type Variant = keyof typeof typography;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'over' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  /** Totals and amounts use tabular figures so they do not jitter (spec 5.5). */
  numeric?: boolean;
}

export function Text({ variant = 'body', tone = 'default', numeric = false, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const color =
    tone === 'muted' ? colors.textMuted
    : tone === 'faint' ? colors.textFaint
    : tone === 'accent' ? colors.accent
    : tone === 'over' ? colors.over
    : tone === 'danger' ? colors.danger
    : colors.text;

  return <RNText {...rest} style={[typography[variant], { color }, numeric && tabularNumbers, style]} />;
}
