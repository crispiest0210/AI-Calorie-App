/**
 * Log sheet: tab contents, the one-tap re-log of a recent, falling back to the
 * amount screen when there is no previous amount, long-press to choose an
 * amount, and picking an ingredient for a recipe.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockLogFood = jest.fn();
const mockAddIngredient = jest.fn();
let mockParams: Record<string, string> = {};
let mockLast: unknown = null;
let mockDetail: unknown = null;
let mockRecents: unknown[] = [];
let mockMine: unknown[] = [];

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
// FlashList measures and re-renders asynchronously; a plain list keeps the test synchronous.
jest.mock('@shopify/flash-list', () => {
  const { View } = jest.requireActual('react-native');
  return {
    FlashList: ({
      data,
      renderItem,
      ListEmptyComponent,
    }: {
      data: { id: string }[];
      renderItem: (info: { item: { id: string }; index: number }) => React.ReactNode;
      ListEmptyComponent: React.ReactNode;
    }) => (
      <View>
        {data.length === 0 ? ListEmptyComponent : data.map((item, index) => <View key={item.id}>{renderItem({ item, index })}</View>)}
      </View>
    ),
  };
});
jest.mock('@nt/db', () => ({
  foods: {
    MIN_SEARCH_LENGTH: 2,
    searchFoods: () => [],
    recentFoods: () => mockRecents,
    frequentFoods: () => [],
    myFoods: () => mockMine,
    mealCategories: () => [],
    foodsInCategory: () => [],
    lastAmountFor: () => mockLast,
    foodDetail: () => mockDetail,
  },
  entries: { logFood: (...args: unknown[]) => mockLogFood(...args) },
  recipes: { addIngredient: (...args: unknown[]) => mockAddIngredient(...args) },
}));

import LogSheet from '../app/log';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const oats = { id: 'food-1', name: 'Oats', brand: null, qualityTier: 'reference', energyPer100g: 380 };

describe('LogSheet', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockLogFood.mockClear();
    mockAddIngredient.mockClear();
    mockParams = { date: '2026-03-02', mealSlot: 'dinner' };
    mockLast = null;
    mockDetail = null;
    mockRecents = [oats];
    mockMine = [];
  });

  it('shows the empty state when the selected tab has nothing', () => {
    mockRecents = [];
    render(<LogSheet />);
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
  });

  it('re-logs a recent with its last amount in one tap', () => {
    mockLast = { amountValue: '50', amountUnit: 'g', portionId: null, grams: '50' };
    mockDetail = { name: 'Oats', sourceReleaseId: 'rel-1', nutrientsPer100g: { energy_kcal: '380' } };
    render(<LogSheet />);
    fireEvent.press(screen.getByRole('button', { name: /^Oats/ }));
    expect(mockLogFood).toHaveBeenCalledWith(
      { marker: 'db' },
      expect.objectContaining({
        foodId: 'food-1',
        mealSlot: 'dinner',
        amountValue: '50',
        grams: '50',
        gramsProvenance: 'user',
      }),
    );
    expect(mockBack).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the amount screen for a recent that was never logged', () => {
    render(<LogSheet />);
    fireEvent.press(screen.getByRole('button', { name: /^Oats/ }));
    expect(mockLogFood).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/amount',
      params: { foodId: 'food-1', mealSlot: 'dinner', date: '2026-03-02' },
    });
  });

  it('opens the amount screen on long press even when a last amount exists', () => {
    mockLast = { amountValue: '50', amountUnit: 'g', portionId: null, grams: '50' };
    render(<LogSheet />);
    fireEvent(screen.getByRole('button', { name: /^Oats/ }), 'longPress');
    expect(mockLogFood).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/amount' }));
  });

  it('adds a 100 g ingredient to the recipe being edited', () => {
    mockParams = { pickFor: 'recipe-9' };
    render(<LogSheet />);
    expect(screen.queryByText('Scan')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: /^Oats/ }));
    expect(mockAddIngredient).toHaveBeenCalledWith({ marker: 'db' }, 'recipe-9', 'food-1', '100');
    expect(mockBack).toHaveBeenCalled();
    expect(mockLogFood).not.toHaveBeenCalled();
  });
});
