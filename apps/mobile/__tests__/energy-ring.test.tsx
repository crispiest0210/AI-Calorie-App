/**
 * EnergyRing's visible captions: the remaining/over/no-target line and the
 * "incomplete" marker appear only when they apply (spec 5.5).
 */
import { render, screen } from '@testing-library/react-native';
import { EnergyRing } from '@/components/EnergyRing';

describe('EnergyRing captions', () => {
  it('shows the consumed energy as the headline number', () => {
    render(<EnergyRing consumed="1420" target="2100" remaining="680" ratio={0.676} incomplete={false} />);
    expect(screen.getByText('1,420')).toBeTruthy();
  });

  it('says there is no target when none is set', () => {
    render(<EnergyRing consumed="300" target={null} remaining={null} ratio={null} incomplete={false} />);
    expect(screen.getByText('cal · no target set')).toBeTruthy();
    expect(screen.queryByText(/cal left/)).toBeNull();
  });

  it('omits the incomplete marker for a complete total', () => {
    render(<EnergyRing consumed="1420" target="2100" remaining="680" ratio={0.676} incomplete={false} />);
    expect(screen.queryByText('incomplete')).toBeNull();
  });

  it('shows no "over" copy exactly at the target', () => {
    render(<EnergyRing consumed="2100" target="2100" remaining="0" ratio={1} incomplete={false} />);
    expect(screen.getByText('0 cal left')).toBeTruthy();
    expect(screen.queryByText(/over/)).toBeNull();
  });
});
