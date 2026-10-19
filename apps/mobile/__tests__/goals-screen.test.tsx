/**
 * Goals screen: defaults when no goals exist, the % -> grams explanation, the
 * 100% warning, and the saved payload (absolute vs percentage macros, water).
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockSaveGoals = jest.fn();
const mockBack = jest.fn();
let mockCurrent: unknown = null;

jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@nt/db', () => ({
  goals: {
    goalsForDate: () => mockCurrent,
    saveGoals: (...args: unknown[]) => mockSaveGoals(...args),
  },
}));

import GoalsScreen from '../app/goals';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

type Saved = { waterTargetMl: number | null; targets: { nutrientCode: string; value: string | null; basis: string }[] };
const saved = () => mockSaveGoals.mock.calls[0]![1] as Saved;

describe('GoalsScreen', () => {
  beforeEach(() => {
    mockSaveGoals.mockClear();
    mockBack.mockClear();
    mockCurrent = null;
  });

  it('saves the defaults as percentage macros and returns', () => {
    render(<GoalsScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Save goals' }));
    const { targets, waterTargetMl } = saved();
    expect(waterTargetMl).toBe(2500);
    expect(targets.find((t) => t.nutrientCode === 'energy_kcal')!.value).toBe('2100');
    for (const code of ['protein_g', 'carb_g', 'fat_g']) {
      expect(targets.find((t) => t.nutrientCode === code)!.basis).toBe('pct_energy');
    }
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows the gram equivalent of a percentage macro', () => {
    render(<GoalsScreen />);
    expect(screen.getByText('≈ 131.25 g at 4 cal per gram')).toBeTruthy();
    expect(screen.getByText('≈ 236.25 g at 4 cal per gram')).toBeTruthy();
    expect(screen.getByText('≈ 70 g at 9 cal per gram')).toBeTruthy();
  });

  it('warns when percentages do not add up to 100 and clears once they do', () => {
    render(<GoalsScreen />);
    expect(screen.queryByText(/Percentages add up to/)).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Protein'), '30');
    expect(screen.getByText('Percentages add up to 105%, not 100%.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Protein'), '25');
    expect(screen.queryByText(/Percentages add up to/)).toBeNull();
  });

  it('switches macros to grams, hiding the warning and gram hints', () => {
    render(<GoalsScreen />);
    fireEvent.changeText(screen.getByLabelText('Protein'), '60');
    fireEvent.press(screen.getByRole('radio', { name: 'grams' }));
    expect(screen.queryByText(/Percentages add up to/)).toBeNull();
    expect(screen.queryByText(/cal per gram/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Save goals' }));
    const protein = saved().targets.find((t) => t.nutrientCode === 'protein_g')!;
    expect(protein).toMatchObject({ value: '60', basis: 'absolute' });
  });

  it('saves a null water target when the amount is blank or zero', () => {
    render(<GoalsScreen />);
    fireEvent.changeText(screen.getByLabelText('Water target'), '0');
    fireEvent.press(screen.getByRole('button', { name: 'Save goals' }));
    expect(saved().waterTargetMl).toBeNull();
  });
});
