/**
 * Quick add: an entry needs a positive energy value, blank optional nutrients
 * stay missing rather than becoming zero, and the meal slot comes from the route.
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockLogQuickAdd = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('@/db/provider', () => ({ useDb: () => ({ marker: 'db' }) }));
jest.mock('@/hooks/useHaptics', () => ({ successFeedback: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissAll: mockDismissAll }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@nt/db', () => ({ entries: { logQuickAdd: (...args: unknown[]) => mockLogQuickAdd(...args) } }));

import QuickAddScreen from '../app/quick-add';

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

describe('QuickAddScreen', () => {
  beforeEach(() => {
    mockLogQuickAdd.mockClear();
    mockDismissAll.mockClear();
    mockParams = {};
  });

  it('disables Add to log until energy is a positive number', () => {
    render(<QuickAddScreen />);
    const button = () => screen.getByRole('button', { name: 'Add to log' });
    expect(button().props.accessibilityState?.disabled).toBe(true);
    typeInto('Energy', '0');
    expect(button().props.accessibilityState?.disabled).toBe(true);
    typeInto('Energy', '450');
    expect(button().props.accessibilityState?.disabled).toBeFalsy();
  });

  it('logs only the filled nutrients, defaulting to the snack slot', () => {
    render(<QuickAddScreen />);
    typeInto('Energy', '450');
    fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    expect(mockLogQuickAdd).toHaveBeenCalledTimes(1);
    const input = mockLogQuickAdd.mock.calls[0]![1] as { mealSlot: string; nutrients: Record<string, unknown> };
    expect(input.mealSlot).toBe('snack');
    expect(Object.keys(input.nutrients)).toEqual(['energy_kcal']);
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
  });

  it('uses the meal slot from the route when it is valid', () => {
    mockParams = { mealSlot: 'dinner' };
    render(<QuickAddScreen />);
    typeInto('Energy', '600');
    fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    expect((mockLogQuickAdd.mock.calls[0]![1] as { mealSlot: string }).mealSlot).toBe('dinner');
  });

  it('falls back to snack for an unknown meal slot', () => {
    mockParams = { mealSlot: 'brunch' };
    render(<QuickAddScreen />);
    typeInto('Energy', '600');
    fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    expect((mockLogQuickAdd.mock.calls[0]![1] as { mealSlot: string }).mealSlot).toBe('snack');
  });

  it('stamps a past date at noon local time', () => {
    mockParams = { date: '2020-03-04' };
    render(<QuickAddScreen />);
    typeInto('Energy', '300');
    fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    const at = (mockLogQuickAdd.mock.calls[0]![1] as { at: Date }).at;
    expect(at.getFullYear()).toBe(2020);
    expect(at.getMonth()).toBe(2);
    expect(at.getDate()).toBe(4);
    expect(at.getHours()).toBe(12);
  });
});
