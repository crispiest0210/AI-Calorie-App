/**
 * Typing into a number field must never crash a screen or store raw text.
 * These drive the real screens against an in-memory SQLite (the same schema
 * the app ships), so what is asserted is what actually lands in the database.
 */
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { sql } from 'drizzle-orm';
import { localDateOf } from '@nt/core';
import type { Db } from '@nt/db';
import { entries, goals, recipes } from '@nt/db';
import { RELEASE_ID, catalogFood, freshDb } from '../../../packages/db/test/helpers';

let mockDb: Db;
let mockParams: Record<string, string> = {};
const mockRouter = { dismissAll: jest.fn(), back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}));

jest.mock('@/db/provider', () => ({
  useDb: () => mockDb,
  useDbQuery: <T,>(read: (db: Db) => T) => read(mockDb),
}));

import AmountScreen from '../app/amount';
import GoalsScreen from '../app/goals';
import QuickAddScreen from '../app/quick-add';
import CustomFoodScreen from '../app/custom-food';
import EntryDetailScreen from '../app/entry/[id]';
import RecipeScreen from '../app/recipe/[id]';
import WaterScreen from '../app/water';

const metrics: Metrics = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const RICE = { energy_kcal: '130', protein_g: '2.7', carb_g: '28', fat_g: '0.3' };
const TODAY = localDateOf();

function show(element: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>);
}

function type(label: string, text: string) {
  act(() => {
    fireEvent.changeText(screen.getByLabelText(label), text);
  });
}

function isDisabled(label: string): boolean {
  return screen.getByLabelText(label).props.accessibilityState?.disabled === true;
}

beforeEach(() => {
  mockDb = freshDb().db;
  mockParams = {};
  jest.clearAllMocks();
});

describe('Amount', () => {
  let rice: string;
  beforeEach(() => {
    rice = catalogFood(mockDb, 'Rice', RICE);
    mockParams = { foodId: rice, mealSlot: 'lunch', date: TODAY };
  });

  it('logs "1,5" as 1.5 g', () => {
    show(<AmountScreen />);
    type('Amount', '1,5');
    fireEvent.press(screen.getByLabelText('Add to log'));
    const [entry] = entries.entriesForDate(mockDb, TODAY);
    expect(entry!.amountValue).toBe('1.5');
    expect(entry!.grams).toBe('1.5');
  });

  it.each(['.', '', '0'])('does not crash or log on %j', (text) => {
    show(<AmountScreen />);
    type('Amount', text);
    expect(screen.getByText('Enter an amount above zero.')).toBeTruthy();
    expect(isDisabled('Add to log')).toBe(true);
    fireEvent.press(screen.getByLabelText('Add to log'));
    expect(entries.entriesForDate(mockDb, TODAY)).toEqual([]);
  });

  it('refuses a second separator instead of crashing', () => {
    show(<AmountScreen />);
    type('Amount', '1.2');
    type('Amount', '1.2.3');
    expect(screen.getByLabelText('Amount').props.value).toBe('1.2');
  });

  it('survives a stored last amount that is not a number', () => {
    entries.logFood(mockDb, {
      foodId: rice, foodName: 'Rice', sourceReleaseId: RELEASE_ID, mealSlot: 'lunch',
      amountValue: '100', amountUnit: 'g', grams: '100', gramsProvenance: 'user', nutrientsPer100g: RICE,
    });
    mockDb.run(sql`update log_entry set amount_value = '1.2.3'`);
    show(<AmountScreen />);
    expect(isDisabled('Add to log')).toBe(true);
  });
});

describe('Goals', () => {
  it('saves a blank sodium as no sodium target', () => {
    show(<GoalsScreen />);
    type('Sodium, at most', '');
    fireEvent.press(screen.getByLabelText('Save goals'));
    const profile = goals.goalsForDate(mockDb, TODAY)!;
    expect(profile.targets.map((t) => t.nutrientCode)).not.toContain('sodium_mg');
    expect(profile.targets.find((t) => t.nutrientCode === 'energy_kcal')?.value).toBe('2100');
  });

  it('keeps a goal left blank blank the next time', () => {
    show(<GoalsScreen />);
    type('Fiber, at least', '');
    fireEvent.press(screen.getByLabelText('Save goals'));
    screen.unmount();
    show(<GoalsScreen />);
    expect(screen.getByLabelText('Fiber, at least').props.value).toBe('');
  });

  it.each(['.', '', '1.'])('renders and previews with energy %j without crashing', (text) => {
    show(<GoalsScreen />);
    type('Energy target', text);
    expect(screen.getByLabelText('Protein')).toBeTruthy();
  });

  it('holds Save while a field is half-typed', () => {
    show(<GoalsScreen />);
    type('Energy target', '.');
    expect(screen.getByText(/Check the energy value/)).toBeTruthy();
    expect(isDisabled('Save goals')).toBe(true);
    fireEvent.press(screen.getByLabelText('Save goals'));
    expect(goals.goalsForDate(mockDb, TODAY)).toBeNull();
  });

  it('rounds the gram preview of a percentage target', () => {
    show(<GoalsScreen />);
    type('Energy target', '2000');
    type('Protein', '33');
    // 33% of 2000 cal at 4 cal/g is 165 g; with 2001 cal it is 165.0825 g.
    type('Energy target', '2001');
    expect(screen.getByText(/≈ 165 g at 4 cal per gram/)).toBeTruthy();
  });
});

describe('Quick add', () => {
  it('logs "1,5" and refuses "." without crashing', () => {
    mockParams = { mealSlot: 'snack', date: TODAY };
    show(<QuickAddScreen />);
    type('Energy', '.');
    expect(isDisabled('Add to log')).toBe(true);
    type('Energy', '150,5');
    type('Protein (optional)', '.');
    expect(isDisabled('Add to log')).toBe(true);
    type('Protein (optional)', '');
    fireEvent.press(screen.getByLabelText('Add to log'));
    const [entry] = entries.entriesForDate(mockDb, TODAY);
    expect(entry!.nutrientsAbsolute).toEqual({ energy_kcal: '150.5' });
  });
});

describe('Entry detail', () => {
  it('never stores blank or half-typed energy for a quick add', () => {
    const id = entries.logQuickAdd(mockDb, { mealSlot: 'snack', nutrients: { energy_kcal: '200' } });
    mockParams = { id };
    show(<EntryDetailScreen />);
    for (const text of ['', '.']) {
      type('Energy', text);
      expect(screen.queryByLabelText('Save amount')).toBeNull();
    }
    type('Energy', '250,5');
    fireEvent.press(screen.getByLabelText('Save amount'));
    expect(entries.entryById(mockDb, id)!.nutrientsAbsolute).toEqual({ energy_kcal: '250.5' });
  });
});

describe('Custom food', () => {
  it('does not crash on half-typed values and holds Save', () => {
    show(<CustomFoodScreen />);
    type('Name', 'Granola');
    type('Serving weight', '.');
    type('Energy', '1,');
    expect(isDisabled('Save and log')).toBe(true);
    type('Serving weight', '40');
    type('Protein (optional)', '.');
    expect(isDisabled('Save and log')).toBe(true);
    type('Protein (optional)', '8');
    expect(isDisabled('Save and log')).toBe(false);
  });
});

describe('Recipe', () => {
  it('ignores "." and blank servings, and saves a real number', () => {
    const rice = catalogFood(mockDb, 'Rice', RICE);
    const id = recipes.createRecipe(mockDb, { name: 'Bowl', servings: '2', sourceReleaseId: RELEASE_ID });
    recipes.addIngredient(mockDb, id, rice, '200');
    mockParams = { id };
    show(<RecipeScreen />);
    for (const text of ['.', '', '0']) type('Servings', text);
    type('Grams', '.');
    type('Cooked weight (optional)', '.');
    expect(recipes.readRecipe(mockDb, id)!.servings).toBe('2');
    type('Servings', '2,5');
    expect(recipes.readRecipe(mockDb, id)!.servings).toBe('2.5');
  });
});

describe('Water', () => {
  it('only offers whole millilitres', () => {
    show(<WaterScreen />);
    type('Custom amount', '12,5');
    expect(isDisabled('Add 0 mL')).toBe(true);
    type('Custom amount', '.');
    expect(isDisabled('Add 0 mL')).toBe(true);
  });
});
