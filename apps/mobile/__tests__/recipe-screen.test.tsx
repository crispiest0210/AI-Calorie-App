/**
 * Recipe detail screen: removed state, name and servings saving, cooked weight
 * clearing, ingredient edit/remove, per-serving figures and the incomplete
 * nutrient caveat, and the log/delete actions.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUpdateRecipe = jest.fn();
const mockUpdateIngredient = jest.fn();
const mockRemoveIngredient = jest.fn();
const mockSoftDeleteFood = jest.fn();
let mockRecipe: unknown = null;

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@nt/db', () => ({
  recipes: {
    readRecipe: () => mockRecipe,
    updateRecipe: (...args: unknown[]) => mockUpdateRecipe(...args),
    updateIngredient: (...args: unknown[]) => mockUpdateIngredient(...args),
    removeIngredient: (...args: unknown[]) => mockRemoveIngredient(...args),
  },
  foods: { softDeleteFood: (...args: unknown[]) => mockSoftDeleteFood(...args) },
}));

import RecipeScreen from '../app/recipe/[id]';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

function recipe(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'Soup',
    servings: '4',
    totalCookedGrams: null,
    ingredients: [{ id: 'i1', name: 'Carrot', grams: '200' }],
    computed: { per100g: { energy_kcal: '80' }, servingGrams: '250', cookedGrams: '1000' },
    incompleteCodes: [],
    ...overrides,
  };
}

describe('RecipeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecipe = recipe();
  });

  it('says so when the recipe has been removed', () => {
    mockRecipe = null;
    render(<RecipeScreen />);
    expect(screen.getByText('This recipe has been removed.')).toBeTruthy();
    expect(screen.queryByText('Ingredients')).toBeNull();
  });

  it('saves a trimmed-non-empty name on blur and ignores a blank one', () => {
    render(<RecipeScreen />);
    const name = screen.getByLabelText('Name');
    fireEvent.changeText(name, 'Stew');
    fireEvent(name, 'blur');
    expect(mockUpdateRecipe).toHaveBeenCalledWith({ marker: 'db' }, 'r1', { name: 'Stew' });

    mockUpdateRecipe.mockClear();
    fireEvent.changeText(name, '   ');
    fireEvent(name, 'blur');
    expect(mockUpdateRecipe).not.toHaveBeenCalled();
  });

  it('falls back to one serving when the field is cleared', () => {
    render(<RecipeScreen />);
    fireEvent.changeText(screen.getByLabelText('Servings'), '');
    expect(mockUpdateRecipe).toHaveBeenCalledWith({ marker: 'db' }, 'r1', { servings: '1' });
  });

  it('sets and clears the cooked weight', () => {
    render(<RecipeScreen />);
    const cooked = screen.getByLabelText('Cooked weight (optional)');
    fireEvent.changeText(cooked, '900');
    expect(mockUpdateRecipe).toHaveBeenLastCalledWith({ marker: 'db' }, 'r1', { totalCookedGrams: '900' });
    fireEvent.changeText(cooked, '');
    expect(mockUpdateRecipe).toHaveBeenLastCalledWith({ marker: 'db' }, 'r1', { totalCookedGrams: null });
  });

  it('updates an ingredient but refuses blank or zero grams, and removes it', () => {
    render(<RecipeScreen />);
    const grams = screen.getByLabelText('Grams');
    fireEvent.changeText(grams, '150');
    expect(mockUpdateIngredient).toHaveBeenCalledWith({ marker: 'db' }, 'r1', 'i1', '150');

    mockUpdateIngredient.mockClear();
    fireEvent.changeText(grams, '');
    fireEvent.changeText(grams, '0');
    expect(mockUpdateIngredient).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Remove Carrot' }));
    expect(mockRemoveIngredient).toHaveBeenCalledWith({ marker: 'db' }, 'r1', 'i1');
  });

  it('opens the food picker for this recipe from Add ingredient', () => {
    render(<RecipeScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Add ingredient' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { pickFor: 'r1' } });
  });

  it('shows per-serving figures computed from per-100 g values', () => {
    render(<RecipeScreen />);
    expect(screen.getByText('1 serving = 250 g · yield 1,000 g')).toBeTruthy();
    expect(screen.getByText('200 cal')).toBeTruthy();
    expect(screen.getAllByText('not reported').length).toBeGreaterThan(0);
  });

  it('shows the empty states and disables logging with no computed nutrition', () => {
    mockRecipe = recipe({ ingredients: [], computed: null });
    render(<RecipeScreen />);
    expect(screen.getByText('Add what goes in, and the nutrition follows.')).toBeTruthy();
    expect(screen.getByText('Nothing to compute yet.')).toBeTruthy();
    const log = screen.getByRole('button', { name: 'Log this recipe' });
    expect(log.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(log);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('explains which nutrients an ingredient does not report', () => {
    mockRecipe = recipe({ incompleteCodes: ['protein_g'] });
    render(<RecipeScreen />);
    expect(screen.getByText(/does not report protein, so this recipe cannot either/)).toBeTruthy();
  });

  it('logs the recipe as a food and deletes it then goes back', () => {
    render(<RecipeScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Log this recipe' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/amount', params: { foodId: 'r1' } });

    fireEvent.press(screen.getByRole('button', { name: 'Delete recipe' }));
    expect(mockSoftDeleteFood).toHaveBeenCalledWith({ marker: 'db' }, 'r1');
    expect(mockBack).toHaveBeenCalled();
  });
});
