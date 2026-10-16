/**
 * The data-quality badge (spec 2.5): every tier has its plain-language label,
 * unknown tiers fall back to the raw value, null hides it, and it is only a
 * button when there is somewhere to go.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QUALITY_TIER_BADGES, type QualityTier } from '@nt/core';
import { SourceBadge } from '@/components/SourceBadge';

describe('SourceBadge', () => {
  it.each(Object.entries(QUALITY_TIER_BADGES) as [QualityTier, string][])(
    'labels the %s tier "%s"',
    (tier, label) => {
      render(<SourceBadge tier={tier} />);
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it('falls back to the raw value for an unknown tier', () => {
    render(<SourceBadge tier="mystery" />);
    expect(screen.getByText('mystery')).toBeTruthy();
  });

  it('renders nothing for a null tier', () => {
    render(<SourceBadge tier={null} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it('is not a button without onPress', () => {
    render(<SourceBadge tier="lab" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes a labelled button that fires onPress', () => {
    const onPress = jest.fn();
    render(<SourceBadge tier="crowd" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Data source: Open Food Facts' });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
