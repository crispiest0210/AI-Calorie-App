/**
 * Recipes screen: empty state, per-recipe nutrition caption (with and without
 * ingredients or a serving), creating a recipe, and the create button being
 * disabled until the user food source is ready.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockCreateRecipe = jest.fn(() => 'new-id');
let mockRecipes: unknown[] = [];
let mockUserRelease: string | null = 'rel-1';

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@nt/db', () => ({
  foods: { activeSourceRelease: () => mockUserRelease },
  recipes: {
    listRecipes: () => mockRecipes,
    createRecipe: (...args: unknown[]) => mockCreateRecipe(...(args as [])),
  },
}));

import RecipesScreen from '../app/recipes';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

describe('RecipesScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockCreateRecipe.mockClear();
    mockRecipes = [];
    mockUserRelease = 'rel-1';
  });

  it('shows an empty state when there are no recipes', () => {
    render(<RecipesScreen />);
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
  });

  it('captions recipes with and without ingredients or a serving', () => {
    mockRecipes = [
      { id: 'a', name: 'Soup', energyPer100g: 80, portions: [{ gramWeight: 250 }] },
      { id: 'b', name: 'Stew', energyPer100g: 120, portions: [] },
      { id: 'c', name: 'Blank', energyPer100g: null, portions: [] },
    ];
    render(<RecipesScreen />);
    expect(screen.getByText('80 cal per 100 g · 1 serving = 250 g')).toBeTruthy();
    expect(screen.getByText('120 cal per 100 g · no serving')).toBeTruthy();
    expect(screen.getByText('No ingredients yet')).toBeTruthy();
    expect(screen.queryByText('Nothing yet.')).toBeNull();
  });

  it('opens a recipe when its name is pressed', () => {
    mockRecipes = [{ id: 'a', name: 'Soup', energyPer100g: null, portions: [] }];
    render(<RecipesScreen />);
    fireEvent.press(screen.getByText('Soup'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'a' } });
  });

  it('creates a one-serving recipe and opens it', () => {
    render(<RecipesScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'New recipe' }));
    expect(mockCreateRecipe).toHaveBeenCalledWith(
      { marker: 'db' },
      { name: 'New recipe', servings: '1', sourceReleaseId: 'rel-1' },
    );
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'new-id' } });
  });

  it('disables New recipe until the user food source exists', () => {
    mockUserRelease = null;
    render(<RecipesScreen />);
    const button = screen.getByRole('button', { name: 'New recipe' });
    expect(button.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(button);
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });
});
