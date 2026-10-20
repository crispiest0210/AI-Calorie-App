/**
 * Entry detail screen: removed entries, amount saving (grams re-resolved, AI
 * estimates become adjusted, quick-add rewrites energy), meal changes and delete.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockUpdateEntry = jest.fn();
const mockDeleteEntry = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockEntry: unknown = null;
let mockFood: unknown = null;

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'e1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));
jest.mock('@nt/db', () => ({
  entries: {
    entryById: () => mockEntry,
    updateEntry: (...args: unknown[]) => mockUpdateEntry(...args),
    deleteEntry: (...args: unknown[]) => mockDeleteEntry(...args),
  },
  foods: { foodDetail: () => mockFood },
}));

import EntryDetailScreen from '../app/entry/[id]';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    foodId: 'food-1',
    foodName: 'Oats',
    foodBrand: null,
    entryKind: 'food',
    mealSlot: 'breakfast',
    amountValue: '50',
    amountUnit: 'g',
    portionId: null,
    portionLabel: null,
    grams: '50',
    gramsProvenance: 'user',
    qualityTier: 'reference',
    loggedAt: new Date('2024-05-01T08:00:00').getTime(),
    nutrientsPer100g: { energy_kcal: '380' },
    nutrientsAbsolute: null,
    ...overrides,
  };
}

const food = { id: 'food-1', densityGPerMl: null, portions: [] };

describe('EntryDetailScreen', () => {
  beforeEach(() => {
    mockUpdateEntry.mockClear();
    mockDeleteEntry.mockClear();
    mockBack.mockClear();
    mockPush.mockClear();
    mockEntry = makeEntry();
    mockFood = food;
  });

  it('says so when the entry has been removed', () => {
    mockEntry = null;
    render(<EntryDetailScreen />);
    expect(screen.getByText('This entry has been removed.')).toBeTruthy();
  });

  it('hides Save until the amount changes', () => {
    render(<EntryDetailScreen />);
    expect(screen.getByText('Oats')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save amount' })).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Amount (g)'), '100');
    expect(screen.getByRole('button', { name: 'Save amount' })).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Amount (g)'), '50');
    expect(screen.queryByRole('button', { name: 'Save amount' })).toBeNull();
  });

  it('re-resolves grams when the amount is saved', () => {
    render(<EntryDetailScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount (g)'), '100');
    fireEvent.press(screen.getByRole('button', { name: 'Save amount' }));
    expect(mockUpdateEntry).toHaveBeenCalledTimes(1);
    const patch = mockUpdateEntry.mock.calls[0]![2] as Record<string, unknown>;
    expect(mockUpdateEntry.mock.calls[0]![1]).toBe('e1');
    expect(patch.amountValue).toBe('100');
    expect(String(patch.grams)).toBe('100');
    expect(patch.gramsProvenance).toBe('user');
  });

  it('turns an edited AI estimate into an adjusted amount', () => {
    mockEntry = makeEntry({ gramsProvenance: 'ai_estimate' });
    render(<EntryDetailScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount (g)'), '80');
    fireEvent.press(screen.getByRole('button', { name: 'Save amount' }));
    expect((mockUpdateEntry.mock.calls[0]![2] as Record<string, unknown>).gramsProvenance).toBe('ai_adjusted');
  });

  it('does not save a zero amount', () => {
    render(<EntryDetailScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount (g)'), '0');
    fireEvent.press(screen.getByRole('button', { name: 'Save amount' }));
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });

  it('rewrites energy for a quick add', () => {
    mockEntry = makeEntry({
      entryKind: 'quick_add',
      foodId: null,
      amountValue: '300',
      amountUnit: 'kcal',
      grams: null,
      nutrientsPer100g: null,
      nutrientsAbsolute: { energy_kcal: '300', protein_g: '10' },
    });
    mockFood = null;
    render(<EntryDetailScreen />);
    fireEvent.changeText(screen.getByLabelText('Energy'), '450');
    fireEvent.press(screen.getByRole('button', { name: 'Save amount' }));
    const patch = mockUpdateEntry.mock.calls[0]![2] as { amountValue: string; nutrientsAbsolute: Record<string, string> };
    expect(patch.amountValue).toBe('450');
    expect(patch.nutrientsAbsolute).toEqual({ energy_kcal: '450', protein_g: '10' });
  });

  it('changes the meal slot', () => {
    render(<EntryDetailScreen />);
    fireEvent.press(screen.getByText('Dinner'));
    expect(mockUpdateEntry).toHaveBeenCalledWith({ marker: 'db' }, 'e1', { mealSlot: 'dinner' });
  });

  it('opens provenance and deletes then goes back', () => {
    render(<EntryDetailScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'See every source' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/provenance', params: { entryId: 'e1' } });
    fireEvent.press(screen.getByRole('button', { name: 'Delete entry' }));
    expect(mockDeleteEntry).toHaveBeenCalledWith({ marker: 'db' }, 'e1');
    expect(mockBack).toHaveBeenCalled();
  });
});
