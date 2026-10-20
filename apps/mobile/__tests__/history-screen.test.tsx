/**
 * History screen: macro averages divide by days actually logged, each day is
 * read against its own goal profile, the range switch widens the window, and
 * tapping a day row opens that day.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { localDateOf } from '@nt/core';

const mockPush = jest.fn();
let mockEntries: unknown[] = [];
let mockProfiles: unknown[] = [];
let mockWater: Record<string, number> = {};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/db/provider', () => ({
  useDbQuery: (read: (db: unknown) => unknown) => read({ marker: 'db' }),
}));
jest.mock('@nt/db', () => ({
  entries: { entriesForRange: () => mockEntries },
  goals: { allGoalProfiles: () => mockProfiles },
  water: { waterTotalsForRange: () => mockWater },
}));

import HistoryScreen from '../app/(tabs)/history';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const today = localDateOf();

/** 200 g of a 400 kcal / 10 g protein per 100 g food: 800 kcal, 20 g protein. */
const oats = {
  id: 'e1',
  mealSlot: 'breakfast',
  entryKind: 'food',
  grams: '200',
  nutrientsPer100g: { energy_kcal: '400', protein_g: '10' },
  nutrientsAbsolute: null,
  localDate: today,
};

const profile = {
  id: 'g1',
  effectiveFrom: '2000-01-01',
  waterTargetMl: 2000,
  targets: [
    { nutrientCode: 'energy_kcal', kind: 'target', value: '2000', basis: 'absolute' },
    { nutrientCode: 'protein_g', kind: 'target', value: '100', basis: 'absolute' },
  ],
};

describe('HistoryScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockEntries = [];
    mockProfiles = [];
    mockWater = {};
  });

  it('shows dashes and no target when nothing is logged', () => {
    render(<HistoryScreen />);
    expect(screen.getByText('0 of 7 days logged')).toBeTruthy();
    expect(screen.getAllByText('no target')).toHaveLength(3);
    expect(screen.getAllByText('nothing logged')).toHaveLength(7);
  });

  it('averages over logged days only and reads them against the profile target', () => {
    mockEntries = [oats];
    mockProfiles = [profile];
    render(<HistoryScreen />);
    expect(screen.getByLabelText('Protein: 20 g, of 100 g target')).toBeTruthy();
    expect(screen.getByText('1 of 7 days logged · water target met on 0')).toBeTruthy();
    expect(screen.getAllByText('nothing logged')).toHaveLength(6);
  });

  it('counts days that met the water target', () => {
    mockEntries = [oats];
    mockProfiles = [profile];
    mockWater = { [today]: 2500 };
    render(<HistoryScreen />);
    expect(screen.getByText('1 of 7 days logged · water target met on 1')).toBeTruthy();
  });

  it('widens the window to 30 days', () => {
    render(<HistoryScreen />);
    fireEvent.press(screen.getByRole('radio', { name: '30 days' }));
    expect(screen.getByText('0 of 30 days logged')).toBeTruthy();
    expect(screen.getAllByText('nothing logged')).toHaveLength(30);
  });

  it('opens the tapped day', () => {
    mockEntries = [oats];
    render(<HistoryScreen />);
    fireEvent.press(screen.getByLabelText('Today, 800 calories, 1 entry'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/day/[date]', params: { date: today } });
  });
});
