/**
 * Custom food: saving needs a name, energy and (per serving) a serving weight;
 * label values are converted to per-100 g, implausible numbers are refused, and
 * a successful save logs the new food through the amount screen.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockCreateCustomFood = jest.fn();
const mockReplace = jest.fn();
let mockReleaseId: number | null = 7;
let mockParams: Record<string, string> = {};

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: () => mockReleaseId,
}));
jest.mock('@/hooks/useHaptics', () => ({ successFeedback: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@nt/db', () => ({
  foods: {
    activeSourceRelease: jest.fn(),
    createCustomFood: (...args: unknown[]) => mockCreateCustomFood(...args),
  },
}));

import CustomFoodScreen from '../app/custom-food';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

function typeInto(label: string, text: string) {
  fireEvent.changeText(screen.getByLabelText(label), text);
}

const saveButton = () => screen.getByRole('button', { name: 'Save and log' });

describe('CustomFoodScreen', () => {
  beforeEach(() => {
    mockCreateCustomFood.mockReset().mockReturnValue(42);
    mockReplace.mockClear();
    mockReleaseId = 7;
    mockParams = {};
  });

  it('disables Save until name, energy and a serving weight are filled', () => {
    render(<CustomFoodScreen />);
    expect(saveButton().props.accessibilityState?.disabled).toBe(true);
    typeInto('Name', 'Granola');
    typeInto('Energy', '200');
    expect(saveButton().props.accessibilityState?.disabled).toBe(true);
    typeInto('Serving weight', '40');
    expect(saveButton().props.accessibilityState?.disabled).toBeFalsy();
  });

  it('does not need a serving weight for per-100 g labels', () => {
    render(<CustomFoodScreen />);
    fireEvent.press(screen.getByRole('radio', { name: 'Per 100 g' }));
    expect(screen.queryByLabelText('Serving weight')).toBeNull();
    typeInto('Name', 'Granola');
    typeInto('Energy', '480');
    expect(saveButton().props.accessibilityState?.disabled).toBeFalsy();
  });

  it('converts per-serving values to per 100 g and opens the amount screen', () => {
    mockParams = { mealSlot: 'breakfast', date: '2020-03-04' };
    render(<CustomFoodScreen />);
    typeInto('Name', 'Granola');
    typeInto('Serving weight', '50');
    typeInto('Energy', '200');
    fireEvent.press(saveButton());
    expect(mockCreateCustomFood).toHaveBeenCalledTimes(1);
    const [, food, options] = mockCreateCustomFood.mock.calls[0]!;
    expect(food.nutrients).toEqual([expect.objectContaining({ code: 'energy_kcal', amountPer100g: '400', derivation: 'converted' })]);
    expect(options).toEqual({ sourceReleaseId: 7, synced: true });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/amount',
      params: { foodId: 42, mealSlot: 'breakfast', date: '2020-03-04' },
    });
  });

  it('refuses implausible values instead of storing them', () => {
    render(<CustomFoodScreen />);
    fireEvent.press(screen.getByRole('radio', { name: 'Per 100 g' }));
    typeInto('Name', 'Typo bar');
    typeInto('Energy', '9000');
    fireEvent.press(saveButton());
    expect(screen.getByText(/^Check those numbers/)).toBeTruthy();
    expect(mockCreateCustomFood).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('asks the user to wait while the food catalog is still loading', () => {
    mockReleaseId = null;
    render(<CustomFoodScreen />);
    fireEvent.press(screen.getByRole('radio', { name: 'Per 100 g' }));
    typeInto('Name', 'Granola');
    typeInto('Energy', '480');
    fireEvent.press(saveButton());
    expect(screen.getByText('The food catalog is still loading. Try again in a moment.')).toBeTruthy();
    expect(mockCreateCustomFood).not.toHaveBeenCalled();
  });
});
