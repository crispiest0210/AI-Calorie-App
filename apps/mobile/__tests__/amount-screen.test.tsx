/**
 * Amount screen: seeds from the last logged amount or the source's first
 * serving, converts the amount when the unit changes, explains unresolvable
 * amounts, and logs through the entries repository.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockLogFood = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: Record<string, string> = {};
let mockFood: unknown = null;
let mockLast: unknown = null;

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ dismissAll: mockDismissAll, push: jest.fn() }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@nt/db', () => ({
  foods: { foodDetail: () => mockFood, lastAmountFor: () => mockLast },
  entries: { logFood: (...args: unknown[]) => mockLogFood(...args) },
}));

import AmountScreen from '../app/amount';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

function makeFood(overrides: Record<string, unknown> = {}) {
  return {
    id: 'food-1',
    name: 'Oats',
    brand: null,
    kind: 'generic',
    qualityTier: 'reference',
    sourceRef: 'FDC 123',
    sourceReleaseId: 'rel-1',
    densityGPerMl: null,
    nutrientsPer100g: { energy_kcal: '380' },
    portions: [{ id: 'p1', label: '1 cup', gramWeight: '40', source: 'source' }],
    ...overrides,
  };
}

describe('AmountScreen', () => {
  beforeEach(() => {
    mockLogFood.mockClear();
    mockDismissAll.mockClear();
    mockParams = { foodId: 'food-1' };
    mockFood = makeFood();
    mockLast = null;
  });

  it('says so when the food is no longer in the catalog', () => {
    mockFood = null;
    render(<AmountScreen />);
    expect(screen.getByText('That food is no longer in the catalog.')).toBeTruthy();
  });

  it('opens on the first serving and shows the source line', () => {
    render(<AmountScreen />);
    expect(screen.getByLabelText('Amount').props.value).toBe('1');
    expect(screen.getByRole('radio', { name: 'servings' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(/Source record FDC 123/)).toBeTruthy();
  });

  it('prefers the last logged amount over the default seed', () => {
    mockLast = { amountValue: '250', amountUnit: 'g', portionId: null, grams: '250' };
    render(<AmountScreen />);
    expect(screen.getByLabelText('Amount').props.value).toBe('250');
    expect(screen.getByRole('radio', { name: 'grams' }).props.accessibilityState.selected).toBe(true);
  });

  it('converts the amount when switching units and offers mL only with a density', () => {
    mockFood = makeFood({ densityGPerMl: '0.5' });
    render(<AmountScreen />);
    fireEvent.press(screen.getByRole('radio', { name: 'grams' }));
    expect(screen.getByLabelText('Amount').props.value).toBe('40');
    fireEvent.press(screen.getByRole('radio', { name: 'mL' }));
    expect(screen.getByLabelText('Amount').props.value).toBe('80');
  });

  it('hides the mL unit when the food has no density', () => {
    render(<AmountScreen />);
    expect(screen.queryByRole('radio', { name: 'mL' })).toBeNull();
  });

  it('disables Add and explains a zero amount', () => {
    mockLast = { amountValue: '100', amountUnit: 'g', portionId: null, grams: '100' };
    render(<AmountScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount'), '0');
    expect(screen.getByText('Enter an amount above zero.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to log' }).props.accessibilityState?.disabled).toBe(true);
  });

  it('logs the entry with resolved grams on the chosen meal and closes', () => {
    mockParams = { foodId: 'food-1', mealSlot: 'dinner' };
    render(<AmountScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount'), '2');
    fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    const input = mockLogFood.mock.calls[0]![1];
    expect(input).toMatchObject({
      foodId: 'food-1',
      mealSlot: 'dinner',
      amountValue: '2',
      amountUnit: 'portion',
      portionId: 'p1',
      grams: '80',
      gramsProvenance: 'portion',
    });
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
  });

  it('stamps a past date at noon local time', () => {
    mockParams = { foodId: 'food-1', date: '2020-03-04' };
    render(<AmountScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    expect((mockLogFood.mock.calls[0]![1].at as Date).getTime()).toBe(new Date('2020-03-04T12:00:00').getTime());
  });
});
