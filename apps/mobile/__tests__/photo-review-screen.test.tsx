/**
 * Photo review screen (spec 5.3): nothing is logged until Confirm, Confirm is
 * held while an item is unresolved, an edited amount becomes the user's own
 * number, and a missing draft says so instead of crashing.
 */
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockDismissAll = jest.fn();
const mockGetAccessToken = jest.fn();
const mockFoodDetail = jest.fn();
const mockLogFood = jest.fn();
const mockFetch = jest.fn();
let mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, dismissAll: mockDismissAll }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: (fn: (db: unknown) => unknown) => fn({ marker: 'db' }),
}));
jest.mock('@/auth/provider', () => ({ useSession: () => ({ getAccessToken: mockGetAccessToken }) }));
jest.mock('@/config', () => ({ config: { apiBaseUrl: 'https://api.test' } }));
jest.mock('@/hooks/useHaptics', () => ({ successFeedback: jest.fn() }));
jest.mock('@nt/db', () => ({
  foods: { foodDetail: (...args: unknown[]) => mockFoodDetail(...args) },
  entries: { logFood: (...args: unknown[]) => mockLogFood(...args) },
}));

import PhotoReviewScreen from '../app/photo-review';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render() {
  return rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <PhotoReviewScreen />
    </SafeAreaProvider>,
  );
}

const foodFor = (id: string, name: string, energy: string) => ({
  id,
  name,
  qualityTier: 'lab',
  sourceReleaseId: 'release-1',
  nutrientsPer100g: { energy_kcal: energy },
});

const draftItem = (itemId: string, label: string, overrides: Record<string, unknown> = {}) => ({
  itemId,
  label,
  description: null,
  preparation: null,
  identification: { confidence: 0.9, band: 'likely' },
  portionGrams: { estimate: '100', low: '80', high: '120', basis: null },
  occluded: false,
  matchStatus: 'matched',
  candidates: [{ foodId: `${itemId}-food`, name: `${label} (catalog)`, score: 0.9, qualityTier: 'lab' }],
  ...overrides,
});

const setDraft = (items: unknown[], extra: Record<string, unknown> = {}) => {
  mockParams = {
    analysisId: 'a1',
    mealSlot: 'dinner',
    draft: JSON.stringify({ analysisId: 'a1', status: 'ready', model: null, notes: null, items, ...extra }),
  };
};

describe('PhotoReviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockGetAccessToken.mockResolvedValue('token');
    mockFetch.mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mockFoodDetail.mockImplementation((_db: unknown, id: string) => foodFor(id, `Food ${id}`, '200'));
  });

  it('says the draft is gone when no draft param was passed', () => {
    render();
    expect(screen.getByText('This draft is no longer available. Take the photo again.')).toBeTruthy();
    expect(screen.queryByText('Confirm and log')).toBeNull();
  });

  it('pre-selects a confident match and shows a calorie range until the amount is touched', () => {
    setDraft([draftItem('i1', 'rice')]);
    render();
    expect(screen.getByText('Food i1-food')).toBeTruthy();
    // 200 kcal/100 g over 80–120 g.
    expect(screen.getByText('160–240 cal')).toBeTruthy();
    expect(screen.getByText('Amount (estimated)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and log' })).toBeEnabled();
  });

  it('holds Confirm for an unsure item until a candidate is chosen', () => {
    setDraft([draftItem('i1', 'stew', { identification: { confidence: 0.3, band: 'unsure' } })]);
    render();
    expect(screen.getByText('Choose a food')).toBeTruthy();
    expect(screen.getByText('Pick a food for every item first. Nothing is logged until you do.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and log' })).toBeDisabled();

    fireEvent.press(screen.getByLabelText('stew (catalog)'));
    expect(screen.getByText('Food i1-food')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and log' })).toBeEnabled();
  });

  it('lets an unmatched item go to search and be removed', () => {
    setDraft([draftItem('i1', 'mystery', { matchStatus: 'unmatched', candidates: [] })]);
    render();
    fireEvent.press(screen.getByRole('button', { name: 'Search for this food' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { pickFor: 'photo', itemId: 'i1' } });

    fireEvent.press(screen.getByLabelText('Remove mystery'));
    expect(screen.queryByLabelText('Remove mystery')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm and log' })).toBeDisabled();
  });

  it('logs each accepted item with the chosen meal, tells the server, and dismisses', async () => {
    setDraft([draftItem('i1', 'rice')]);
    render();
    fireEvent.press(screen.getByRole('button', { name: 'Confirm and log' }));

    await waitFor(() => expect(mockDismissAll).toHaveBeenCalled());
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    expect(mockLogFood.mock.calls[0]![1]).toMatchObject({
      foodId: 'i1-food',
      mealSlot: 'dinner',
      amountUnit: 'g',
      gramsProvenance: 'ai_estimate',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test/v1/photo-analyses/a1/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'confirmed' }) }),
    );
  });

  it('records an edited amount as an adjustment and settles on one calorie figure', async () => {
    setDraft([draftItem('i1', 'rice')]);
    render();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Amount (estimated)'), '150');
    });
    expect(screen.getByText('300 cal')).toBeTruthy();
    expect(screen.getByText('Every item accepted.')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Confirm and log' }));
    await waitFor(() => expect(mockDismissAll).toHaveBeenCalled());
    expect(mockLogFood.mock.calls[0]![1]).toMatchObject({ grams: '150', gramsProvenance: 'ai_adjusted' });
  });

  it('still logs and dismisses when signed out, without calling the server', async () => {
    setDraft([draftItem('i1', 'rice')]);
    mockGetAccessToken.mockResolvedValue(null);
    render();
    fireEvent.press(screen.getByRole('button', { name: 'Confirm and log' }));
    await waitFor(() => expect(mockDismissAll).toHaveBeenCalled());
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
