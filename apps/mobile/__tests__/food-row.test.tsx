/**
 * The food list row: the spoken label drops the brand and energy when they are
 * unknown, the visible energy falls back to a dash, the subtitle is optional,
 * and tap / long-press reach their handlers.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { FoodSummary } from '@nt/db';
import { FoodRow } from '@/components/FoodRow';

const food: FoodSummary = { id: '1', name: 'Oats', brand: 'Acme', kind: 'branded', qualityTier: 'label', energyPer100g: '389' };

describe('FoodRow', () => {
  it('shows the brand, energy and the /100 g unit', () => {
    render(<FoodRow food={food} onPress={jest.fn()} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('389')).toBeTruthy();
    expect(screen.getByText('/100 g')).toBeTruthy();
  });

  it('omits the brand and energy from the spoken label when unknown', () => {
    render(<FoodRow food={{ ...food, brand: null, energyPer100g: null }} onPress={jest.fn()} />);
    expect(screen.getByLabelText('Oats')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('renders the subtitle only when given', () => {
    const { rerender } = render(<FoodRow food={food} onPress={jest.fn()} />);
    expect(screen.queryByText('Logged 3 times')).toBeNull();
    rerender(<FoodRow food={food} subtitle="Logged 3 times" onPress={jest.fn()} />);
    expect(screen.getByText('Logged 3 times')).toBeTruthy();
  });

  it('calls onPress on tap and onLongPress on long press', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(<FoodRow food={food} onPress={onPress} onLongPress={onLongPress} />);
    const row = screen.getByRole('button');
    fireEvent.press(row);
    fireEvent(row, 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
