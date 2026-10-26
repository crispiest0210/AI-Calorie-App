/**
 * The logged-entry row: visible and spoken label carry amount, brand and
 * energy when known, an AI-estimated amount keeps its badge, a food with no
 * snapshot shows a dash, and tap / the delete accessibility action reach their handlers.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { EntryView } from '@nt/db';
import { EntryRow } from '@/components/EntryRow';

// The swipe wiring needs reanimated's native event hooks, which jest-expo does
// not provide; the row's rendering and handlers are what is under test here.
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

const entry: EntryView = {
  id: 'e1',
  mealSlot: 'breakfast',
  entryKind: 'food',
  grams: '200',
  nutrientsPer100g: { energy_kcal: '400' },
  nutrientsAbsolute: null,
  gramsProvenance: 'user',
  localDate: '2026-10-17',
  loggedAt: 0,
  foodId: 'f1',
  foodName: 'Oats',
  foodBrand: 'Acme',
  qualityTier: 'label',
  amountValue: '200',
  amountUnit: 'g',
  portionId: null,
  portionLabel: null,
  note: null,
};

describe('EntryRow', () => {
  it('shows the name, amount, brand and scaled energy, and speaks them in the label', () => {
    render(<EntryRow entry={entry} onPress={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText('Oats')).toBeTruthy();
    expect(screen.getByText('200 g')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('800')).toBeTruthy();
    expect(screen.getByLabelText('Oats, 200 g, 800 calories')).toBeTruthy();
  });

  it('omits the brand and the Estimated badge for a plain entry', () => {
    render(<EntryRow entry={{ ...entry, foodBrand: null }} onPress={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.queryByText('Acme')).toBeNull();
    expect(screen.queryByText('Estimated')).toBeNull();
  });

  it('badges an AI-estimated amount', () => {
    render(<EntryRow entry={{ ...entry, gramsProvenance: 'ai_estimate' }} onPress={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText('Estimated')).toBeTruthy();
  });

  it('falls back to a dash and drops energy from the spoken label when there is no snapshot', () => {
    render(<EntryRow entry={{ ...entry, nutrientsPer100g: null }} onPress={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByLabelText('Oats, 200 g')).toBeTruthy();
  });

  it('uses the portion label for a portion amount', () => {
    render(
      <EntryRow entry={{ ...entry, amountValue: '2', amountUnit: 'portion', portionLabel: 'cup' }} onPress={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(screen.getByText('2 × cup')).toBeTruthy();
  });

  it('opens on tap and deletes through the accessibility action', () => {
    const onPress = jest.fn();
    const onDelete = jest.fn();
    render(<EntryRow entry={entry} onPress={onPress} onDelete={onDelete} />);
    const row = screen.getByRole('button');
    fireEvent.press(row);
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'magicTap' } });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('ignores accessibility actions other than the delete action', () => {
    const onDelete = jest.fn();
    render(<EntryRow entry={entry} onPress={jest.fn()} onDelete={onDelete} />);
    fireEvent(screen.getByRole('button'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onDelete).not.toHaveBeenCalled();
  });
});
