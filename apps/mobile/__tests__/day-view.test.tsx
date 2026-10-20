/**
 * DayView wires the Today layout to SQLite: opening an entry routes to it,
 * deleting one offers undo, copying an empty meal says so, and the Log button
 * opens the sheet for the remembered meal slot.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { dayTotals, progressForProfile, waterProgress } from '@nt/core';
import type { EntryView } from '@nt/db';

const mockPush = jest.fn();
const mockDeleteEntry = jest.fn();
const mockRestoreEntry = jest.fn();
const mockCopyMeal = jest.fn();
const mockReadDay = jest.fn();
const mockAddWater = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (read: (db: unknown) => unknown) => read({ marker: 'db' }),
}));
jest.mock('@nt/db', () => ({
  readDay: (...args: unknown[]) => mockReadDay(...args),
  water: {
    presets: () => [
      { id: 'p1', label: null, amountMl: 250 },
      { id: 'p2', label: null, amountMl: 500 },
    ],
    addWater: (...args: unknown[]) => mockAddWater(...args),
  },
  entries: {
    deleteEntry: (...args: unknown[]) => mockDeleteEntry(...args),
    restoreEntry: (...args: unknown[]) => mockRestoreEntry(...args),
    copyMeal: (...args: unknown[]) => mockCopyMeal(...args),
  },
}));

import { DayView } from '@/components/DayView';
import { useUiStore } from '@/state/ui';

const oats: EntryView = {
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
  foodBrand: null,
  qualityTier: 'label',
  amountValue: '200',
  amountUnit: 'g',
  portionId: null,
  portionLabel: null,
  note: null,
};

function snapshot(entries: EntryView[]) {
  const totals = dayTotals(entries);
  return {
    date: '2026-10-17',
    entries,
    totals,
    goals: null,
    progress: progressForProfile(totals.total, null),
    water: waterProgress(0, null),
    waterEntries: [],
  };
}

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderDay(entries: EntryView[]) {
  mockReadDay.mockReturnValue(snapshot(entries));
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <DayView date="2026-10-17" showDateNav={false} />
    </SafeAreaProvider>,
  );
}

describe('DayView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUiStore.setState({ pendingMealSlot: 'breakfast' });
  });

  it('offers a goals shortcut while no goals are set', () => {
    renderDay([]);
    fireEvent.press(screen.getByText('Set your goals'));
    expect(mockPush).toHaveBeenCalledWith('/goals');
  });

  it('opens the log sheet for the remembered meal from the Log button', () => {
    useUiStore.setState({ pendingMealSlot: 'dinner' });
    renderDay([]);
    fireEvent.press(screen.getByText('Log'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { date: '2026-10-17', mealSlot: 'dinner' } });
    expect(useUiStore.getState().pendingMealSlot).toBe('dinner');
  });

  it('logs a water preset against the database', () => {
    renderDay([]);
    fireEvent.press(screen.getByLabelText('Add 500 millilitres of water'));
    expect(mockAddWater).toHaveBeenCalledWith({ marker: 'db' }, 500);
  });

  it('says so when yesterday has nothing to copy, with no undo action', () => {
    mockCopyMeal.mockReturnValue([]);
    renderDay([]);
    fireEvent.press(screen.getAllByText('Copy from yesterday')[0]!);
    expect(mockCopyMeal).toHaveBeenCalledWith(
      { marker: 'db' },
      { date: '2026-10-16', mealSlot: 'breakfast' },
      { date: '2026-10-17', mealSlot: 'breakfast' },
    );
    expect(screen.getByText('Nothing logged for that meal yesterday')).toBeTruthy();
    expect(screen.queryByText('Undo')).toBeNull();
  });

  it('reports how many entries were copied, pluralised', () => {
    mockCopyMeal.mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    renderDay([]);
    fireEvent.press(screen.getAllByText('Copy from yesterday')[0]!);
    expect(screen.getByText('Copied 2 entries')).toBeTruthy();
  });

  it('counts the day footer entries and reports no incomplete nutrients for an empty day', () => {
    renderDay([]);
    expect(screen.getByText('Every entry reports all six core nutrients.')).toBeTruthy();
    expect(screen.getByText(/0 entries/)).toBeTruthy();
  });

  it('lists a logged entry and flags the nutrients it does not report', () => {
    renderDay([oats]);
    expect(screen.getByText('Oats')).toBeTruthy();
    expect(screen.getByText(/^Incomplete: /)).toBeTruthy();
    expect(screen.getByText(/1 entry/)).toBeTruthy();
  });

  it('opens an entry for editing by its id', () => {
    renderDay([oats]);
    fireEvent.press(screen.getByText('Oats'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/entry/[id]', params: { id: 'e1' } });
  });

  it('deletes an entry, names it in the toast and restores it on Undo', () => {
    renderDay([oats]);
    fireEvent(screen.getByLabelText(/^Oats, /), 'accessibilityAction', { nativeEvent: { actionName: 'magicTap' } });
    expect(mockDeleteEntry).toHaveBeenCalledWith({ marker: 'db' }, 'e1');
    expect(screen.getByText('Removed Oats')).toBeTruthy();
    fireEvent.press(screen.getByText('Undo'));
    expect(mockRestoreEntry).toHaveBeenCalledWith({ marker: 'db' }, 'e1');
    expect(screen.queryByText('Removed Oats')).toBeNull();
  });

  it('clears the toast after its timeout without restoring anything', () => {
    jest.useFakeTimers();
    try {
      mockCopyMeal.mockReturnValue([]);
      renderDay([]);
      fireEvent.press(screen.getAllByText('Copy from yesterday')[0]!);
      expect(screen.getByText('Nothing logged for that meal yesterday')).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(screen.queryByText('Nothing logged for that meal yesterday')).toBeNull();
      expect(mockRestoreEntry).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
