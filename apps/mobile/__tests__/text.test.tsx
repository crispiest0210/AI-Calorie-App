/**
 * Text applies the type scale and tone colour from the theme, opts into
 * tabular figures only when asked, and lets a caller style win.
 */
import { render, screen } from '@testing-library/react-native';
import { paletteFor, tabularNumbers, typography } from '@nt/tokens';
import { Text } from '@/components/Text';

const flatStyle = (el: { props: { style?: unknown } }) => Object.assign({}, ...[el.props.style].flat(Infinity));

describe('Text', () => {
  it('defaults to the body variant in the default tone', () => {
    render(<Text>Hello</Text>);
    const style = flatStyle(screen.getByText('Hello'));
    expect(style).toMatchObject(typography.body);
    expect(style.color).toBe(paletteFor('light').text);
  });

  it('applies the requested variant', () => {
    render(<Text variant="display">1,420</Text>);
    expect(flatStyle(screen.getByText('1,420'))).toMatchObject(typography.display);
  });

  it.each([
    ['muted', 'textMuted'],
    ['faint', 'textFaint'],
    ['accent', 'accent'],
    ['over', 'over'],
    ['danger', 'danger'],
  ] as const)('maps the %s tone to its palette colour', (tone, key) => {
    render(<Text tone={tone}>Tone</Text>);
    expect(flatStyle(screen.getByText('Tone')).color).toBe(paletteFor('light')[key]);
  });

  it('uses tabular figures only when numeric is set', () => {
    render(
      <>
        <Text numeric>123</Text>
        <Text>456</Text>
      </>,
    );
    expect(flatStyle(screen.getByText('123'))).toMatchObject(tabularNumbers);
    expect(flatStyle(screen.getByText('456'))).not.toMatchObject(tabularNumbers);
  });

  it('lets a caller style override the defaults and forwards other props', () => {
    render(<Text style={{ color: 'red' }} numberOfLines={2}>Custom</Text>);
    const el = screen.getByText('Custom');
    expect(flatStyle(el).color).toBe('red');
    expect(el.props.numberOfLines).toBe(2);
  });
});
