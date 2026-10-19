/**
 * Provenance sheet: reads the entry's own snapshot (not today's catalog),
 * labels quick-adds as user-typed, shows the source record, and annotates
 * derived nutrients.
 */
import { render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockParams: Record<string, string> = {};
let mockEntry: unknown = null;
let mockFood: unknown = null;
let mockRelease: unknown = null;

jest.mock('@/db/provider', () => ({
  useDbQuery: (query: (db: unknown) => unknown) => query({ marker: 'db' }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@nt/db', () => ({
  entries: { entryById: () => mockEntry },
  foods: { foodDetail: () => mockFood, sourceRelease: () => mockRelease },
}));

import ProvenanceScreen from '../app/provenance';

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
    qualityTier: 'reference',
    sourceRef: 'FDC 123',
    sourceReleaseId: 'rel-1',
    category: 'Cereals',
    nutrientsPer100g: { energy_kcal: '380' },
    derivations: {},
    ...overrides,
  };
}

describe('ProvenanceScreen', () => {
  beforeEach(() => {
    mockParams = { foodId: 'food-1' };
    mockEntry = null;
    mockFood = makeFood();
    mockRelease = { provider: 'usda', dataset: 'Foundation', version: '2024-04' };
  });

  it('shows the catalog record and release for a food opened without an entry', () => {
    render(<ProvenanceScreen />);
    expect(screen.getByText('Oats')).toBeTruthy();
    expect(screen.getByText('These are the values currently in the catalog.')).toBeTruthy();
    expect(screen.getByText('USDA')).toBeTruthy();
    expect(screen.getByText('Foundation')).toBeTruthy();
    expect(screen.getByText('FDC 123')).toBeTruthy();
    expect(screen.getByText('Cereals')).toBeTruthy();
    expect(screen.getByText('Per 100 g')).toBeTruthy();
    expect(screen.queryByText('This entry')).toBeNull();
  });

  it('falls back to placeholders and an unknown name when nothing resolves', () => {
    mockFood = null;
    mockRelease = null;
    render(<ProvenanceScreen />);
    expect(screen.getByText('Unknown food')).toBeTruthy();
    expect(screen.getByText('This record reports no nutrients.')).toBeTruthy();
    expect(screen.queryByText('Record')).toBeNull();
  });

  it('uses the entry snapshot rather than the catalog and shows the contributed amount', () => {
    mockParams = { entryId: 'e1' };
    mockEntry = {
      id: 'e1',
      foodId: 'food-1',
      foodName: 'Oats (logged)',
      entryKind: 'food',
      qualityTier: 'reference',
      loggedAt: '2024-05-01T12:00:00.000Z',
      amountValue: '50',
      amountUnit: 'g',
      portionLabel: null,
      grams: '50',
      gramsProvenance: 'user',
      nutrientsPer100g: { energy_kcal: '400' },
      nutrientsAbsolute: null,
    };
    render(<ProvenanceScreen />);
    expect(screen.getByText('Oats (logged)')).toBeTruthy();
    expect(screen.getByText('Per 100 g at log time')).toBeTruthy();
    expect(screen.getByText(/copied when you logged this/)).toBeTruthy();
    expect(screen.getByText('you entered it')).toBeTruthy();
    expect(screen.getByLabelText('Energy: 400 cal per 100 grams, contributing 200 cal')).toBeTruthy();
  });

  it('says quick-add numbers were typed by the user and have no record', () => {
    mockParams = { entryId: 'q1' };
    mockFood = null;
    mockEntry = {
      id: 'q1',
      foodId: null,
      foodName: 'Snack',
      entryKind: 'quick_add',
      qualityTier: null,
      loggedAt: '2024-05-01T12:00:00.000Z',
      amountValue: '1',
      amountUnit: 'serving',
      portionLabel: null,
      grams: null,
      gramsProvenance: 'user',
      nutrientsPer100g: null,
      nutrientsAbsolute: { energy_kcal: '150' },
    };
    render(<ProvenanceScreen />);
    expect(screen.getByText(/You typed these numbers/)).toBeTruthy();
    expect(screen.getByText('Values')).toBeTruthy();
    expect(screen.queryByText('Record')).toBeNull();
  });

  it('annotates derived nutrients but not reported ones', () => {
    mockFood = makeFood({
      nutrientsPer100g: { energy_kcal: '380', protein_g: '10' },
      derivations: { energy_kcal: 'derived', protein_g: 'reported' },
    });
    render(<ProvenanceScreen />);
    expect(screen.getByText('derived from other values in the record')).toBeTruthy();
    expect(screen.queryByText('reported by the source')).toBeNull();
  });
});
