/**
 * Water screen: the custom amount must be 1-5000 mL, a past date is stamped at
 * noon local time, and entries list with a labelled Remove action.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockAddWater = jest.fn();
const mockDeleteWater = jest.fn();
let mockParams: Record<string, string> = {};
let mockEntries: { id: string; amountMl: number; loggedAt: number }[] = [];
let mockTotal = 0;

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@nt/db', () => ({
  water: {
    addWater: (...args: unknown[]) => mockAddWater(...args),
    deleteWater: (...args: unknown[]) => mockDeleteWater(...args),
    waterForDate: () => mockEntries,
    waterTotalMl: () => mockTotal,
  },
}));

import WaterScreen from '../app/water';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

describe('WaterScreen', () => {
  beforeEach(() => {
    mockAddWater.mockClear();
    mockDeleteWater.mockClear();
    mockParams = {};
    mockEntries = [];
    mockTotal = 0;
  });

  it('shows the total and an empty state', () => {
    mockTotal = 750;
    render(<WaterScreen />);
    expect(screen.getByText('750 mL today')).toBeTruthy();
    expect(screen.getByText('No water logged yet.')).toBeTruthy();
  });

  it('adds the default 300 mL for today', () => {
    render(<WaterScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Add 300 mL' }));
    expect(mockAddWater).toHaveBeenCalledTimes(1);
    expect(mockAddWater.mock.calls[0]![1]).toBe(300);
  });

  it('disables Add when the amount is blank or above 5000 mL', () => {
    render(<WaterScreen />);
    fireEvent.changeText(screen.getByLabelText('Custom amount'), '5001');
    const button = screen.getByRole('button', { name: 'Add 0 mL' });
    expect(button.props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Custom amount'), '');
    expect(screen.getByRole('button', { name: 'Add 0 mL' }).props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Custom amount'), '5000');
    expect(screen.getByRole('button', { name: 'Add 5000 mL' }).props.accessibilityState?.disabled).toBeFalsy();
  });

  it('stamps a past date at noon local time', () => {
    mockParams = { date: '2020-03-04' };
    render(<WaterScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Add 300 mL' }));
    expect((mockAddWater.mock.calls[0]![2] as Date).getTime()).toBe(new Date('2020-03-04T12:00:00').getTime());
  });

  it('lists entries and removes one by id', () => {
    mockEntries = [{ id: 'w1', amountMl: 250, loggedAt: Date.now() }];
    render(<WaterScreen />);
    expect(screen.queryByText('No water logged yet.')).toBeNull();
    fireEvent.press(screen.getByLabelText('Remove 250 millilitres'));
    expect(mockDeleteWater.mock.calls[0]![1]).toBe('w1');
  });
});
