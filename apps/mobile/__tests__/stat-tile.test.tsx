/**
 * StatTile reads as one screen-reader element; its label folds in the unit,
 * detail and over-target state only when they are present.
 */
import { render, screen } from '@testing-library/react-native';
import { StatTile } from '@/components/StatTile';

describe('StatTile', () => {
  it('labels a bare tile with just label and value', () => {
    render(<StatTile label="Protein" value="98" />);
    expect(screen.getByLabelText('Protein: 98')).toBeTruthy();
  });

  it('appends the unit and the detail', () => {
    render(<StatTile label="Protein" value="98" unit="g" detail="of 131 g target" />);
    expect(screen.getByLabelText('Protein: 98 g, of 131 g target')).toBeTruthy();
  });

  it('announces the over state', () => {
    render(<StatTile label="Fat" value="80" unit="g" state="over" />);
    expect(screen.getByLabelText('Fat: 80 g, over target')).toBeTruthy();
  });

  it('shows the value with its unit and the detail as visible text', () => {
    render(<StatTile label="Carbs" value="210" unit="g" detail="of 250 g target" />);
    expect(screen.getByText('Carbs')).toBeTruthy();
    expect(screen.getByText('210 g')).toBeTruthy();
    expect(screen.getByText('of 250 g target')).toBeTruthy();
  });
});
