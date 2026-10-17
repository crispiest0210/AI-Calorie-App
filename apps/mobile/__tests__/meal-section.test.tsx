/**
 * A meal slot: header reads slot and energy and opens the log sheet, an empty
 * slot offers add / copy-from-yesterday, and a filled slot lists its entries.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { sumNutrients } from '@nt/core';
import type { EntryView } from '@nt/db';
import { MealSection } from '@/components/MealSection';

jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

const entry: EntryView = {
  id: 'e1',
  mealSlot: 'lunch',
  entryKind: 'food',
  grams: '200',
  nutrientsPer100g: { energy_kcal: '400' },
  nutrientsAbsolute: null,
  gramsProvenance: 'user',
  localDate: '2026-10-17',
  loggedAt: 0,
  foodId: 'f1',
  foodName: 'Oats',
  foodBrand: null,
  qualityTier: 'label',
  amountValue: '200',
  amountUnit: 'g',
  portionId: null,
  portionLabel: null,
  note: null,
};

function setup(entries: EntryView[], energy = '0') {
  const handlers = { onAdd: jest.fn(), onCopyYesterday: jest.fn(), onOpenEntry: jest.fn(), onDeleteEntry: jest.fn() };
  render(<MealSection slot="lunch" entries={entries} totals={sumNutrients([{ energy_kcal: energy }])} {...handlers} />);
  return handlers;
}

describe('MealSection', () => {
  it('speaks the slot and its energy in the header and opens the log sheet on press', () => {
    const { onAdd } = setup([entry], '800');
    fireEvent.press(screen.getByLabelText('Lunch, 800 calories'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText('800 cal')).toBeTruthy();
  });

  it('shows the empty state with add and copy-from-yesterday shortcuts', () => {
    const { onAdd, onCopyYesterday } = setup([]);
    expect(screen.getByText('Nothing logged yet.')).toBeTruthy();
    fireEvent.press(screen.getByText('Add food'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Copy from yesterday'));
    expect(onCopyYesterday).toHaveBeenCalledTimes(1);
  });

  it('lists entries instead of the empty state and routes entry presses', () => {
    const { onOpenEntry } = setup([entry], '800');
    expect(screen.queryByText('Nothing logged yet.')).toBeNull();
    fireEvent.press(screen.getByText('Oats'));
    expect(onOpenEntry).toHaveBeenCalledWith('e1');
  });
});
