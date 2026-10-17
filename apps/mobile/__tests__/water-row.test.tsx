/**
 * WaterRow names its summary for screen readers with or without a target,
 * opens the water entries from the summary, and quick-adds a preset amount.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { WaterRow } from '@/components/WaterRow';

const presets = [
  { id: 'a', label: null, amountMl: 250 },
  { id: 'b', label: 'Bottle', amountMl: 500 },
];

function progress(consumedMl: number, targetMl: number | null) {
  return { consumedMl, targetMl, ratio: targetMl === null ? null : consumedMl / targetMl };
}

describe('WaterRow', () => {
  it('announces consumed of target millilitres and shows both visibly', () => {
    render(<WaterRow progress={progress(750, 2000)} presets={presets} onAdd={() => {}} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Water: 750 of 2000 millilitres' })).toBeTruthy();
    expect(screen.getByText('750 / 2000 mL')).toBeTruthy();
  });

  it('says no target is set and omits the target visually when there is none', () => {
    render(<WaterRow progress={progress(300, null)} presets={presets} onAdd={() => {}} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Water: 300 millilitres, no target set' })).toBeTruthy();
    expect(screen.getByText('300 mL')).toBeTruthy();
  });

  it('opens the water entries from the summary', () => {
    const onOpen = jest.fn();
    render(<WaterRow progress={progress(0, 2000)} presets={presets} onAdd={() => {}} onOpen={onOpen} />);
    fireEvent.press(screen.getByRole('button', { name: 'Water: 0 of 2000 millilitres' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('adds the tapped preset amount with a labelled button per preset', () => {
    const onAdd = jest.fn();
    render(<WaterRow progress={progress(0, 2000)} presets={presets} onAdd={onAdd} onOpen={() => {}} />);
    fireEvent.press(screen.getByRole('button', { name: 'Add 500 millilitres of water' }));
    expect(onAdd).toHaveBeenCalledWith(500);
    expect(screen.getByRole('button', { name: 'Add 250 millilitres of water' })).toBeTruthy();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
