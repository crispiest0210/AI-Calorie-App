/**
 * Barcode scan screen: a camera flow always has a non-camera way through it,
 * lookup failures say what to do next, and a found product is cached locally
 * before heading to the amount screen.
 */
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetAccessToken = jest.fn();
const mockFoodDetail = jest.fn();
const mockCreateCustomFood = jest.fn();
let mockAccountsEnabled = true;
let mockPermission: { granted: boolean } | null = { granted: false };
let mockUserRelease: string | null = 'release-1';
let mockOnScanned: ((event: { data: string }) => void) | undefined;
const mockFetch = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ mealSlot: 'lunch', date: '2026-03-04' }),
}));
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CameraView: (props: { onBarcodeScanned: (event: { data: string }) => void }) => {
      mockOnScanned = props.onBarcodeScanned;
      return <View testID="camera" />;
    },
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});
jest.mock('@/db/provider', () => ({
  useDb: () => ({ marker: 'db' }),
  useDbQuery: () => mockUserRelease,
}));
jest.mock('@/auth/provider', () => ({ useSession: () => ({ getAccessToken: mockGetAccessToken }) }));
jest.mock('@/config', () => ({
  config: { apiBaseUrl: 'https://api.test' },
  get accountsEnabled() {
    return mockAccountsEnabled;
  },
}));
jest.mock('@/hooks/useHaptics', () => ({ successFeedback: jest.fn() }));
jest.mock('@nt/db', () => ({
  foods: {
    activeSourceRelease: jest.fn(),
    foodDetail: (...args: unknown[]) => mockFoodDetail(...args),
    createCustomFood: (...args: unknown[]) => mockCreateCustomFood(...args),
  },
}));

import ScanScreen from '../app/scan';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render() {
  return rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <ScanScreen />
    </SafeAreaProvider>,
  );
}

const food = {
  id: 'food-1',
  name: 'Oat Bar',
  brand: 'Acme',
  gtin: '12345678',
  qualityTier: 'branded',
  densityGPerMl: null,
  source: { sourceRef: null },
  nutrientsPer100g: { energy_kcal: '400' },
  portions: [{ label: '1 bar', gramWeight: '40', source: 'label' }],
};

describe('ScanScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccountsEnabled = true;
    mockPermission = { granted: true };
    mockUserRelease = 'release-1';
    mockOnScanned = undefined;
    mockGetAccessToken.mockResolvedValue('token');
    mockFoodDetail.mockReturnValue(null);
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  it('offers the label route when accounts are not configured', () => {
    mockAccountsEnabled = false;
    render();
    expect(screen.getByText('Barcode lookup needs an account')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Add from label' }));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/custom-food',
      params: { mealSlot: 'lunch', date: '2026-03-04' },
    });
  });

  it('renders nothing while the permission state is unknown', () => {
    mockPermission = null;
    render();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByText('Camera access')).toBeNull();
  });

  it('keeps manual entry available without camera permission and strips non-digits', () => {
    mockPermission = { granted: false };
    render();
    fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    const lookup = () => screen.getByRole('button', { name: 'Look it up' });
    fireEvent.changeText(screen.getByLabelText('Or type the barcode number'), '12-34 567');
    expect(screen.getByLabelText('Or type the barcode number').props.value).toBe('1234567');
    expect(lookup().props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Or type the barcode number'), '12345678');
    expect(lookup().props.accessibilityState?.disabled).toBeFalsy();
  });

  it('asks for sign-in when there is no access token, without calling the API', async () => {
    mockGetAccessToken.mockResolvedValue(null);
    render();
    await act(async () => mockOnScanned?.({ data: '12345678' }));
    expect(screen.getByText(/Sign in to look up barcodes/)).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('explains an unknown barcode (404) and a failed lookup', async () => {
    render();
    mockFetch.mockResolvedValueOnce({ status: 404, ok: false });
    await act(async () => mockOnScanned?.({ data: '12345678' }));
    expect(screen.getByText(/No product for that barcode/)).toBeTruthy();

    mockFetch.mockResolvedValueOnce({ status: 500, ok: false });
    await act(async () => mockOnScanned?.({ data: '12345678' }));
    expect(screen.getByText(/Lookup failed/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not cache a product while the catalog is still loading', async () => {
    mockUserRelease = null;
    mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => food });
    render();
    await act(async () => mockOnScanned?.({ data: '12345678' }));
    expect(screen.getByText(/catalog is still loading/)).toBeTruthy();
    expect(mockCreateCustomFood).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('caches a found product locally, then opens the amount screen', async () => {
    mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => food });
    render();
    await act(async () => mockOnScanned?.({ data: '12345678' }));
    expect(mockFetch).toHaveBeenCalledWith('https://api.test/v1/foods/barcode/12345678', {
      headers: { authorization: 'Bearer token' },
    });
    expect(mockCreateCustomFood).toHaveBeenCalledTimes(1);
    const [, input, options] = mockCreateCustomFood.mock.calls[0]!;
    expect(input).toMatchObject({ name: 'Oat Bar', gtin: '12345678', sourceRef: '12345678' });
    expect(input.nutrients).toEqual([{ code: 'energy_kcal', amountPer100g: '400', derivation: 'reported' }]);
    expect(options).toEqual({ id: 'food-1', sourceReleaseId: 'release-1', synced: false });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/amount',
      params: { foodId: 'food-1', mealSlot: 'lunch', date: '2026-03-04' },
    });
  });

  it('skips caching a food that is already stored locally', async () => {
    mockFoodDetail.mockReturnValue({ id: 'food-1' });
    mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => food });
    render();
    await act(async () => mockOnScanned?.({ data: '12345678' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockCreateCustomFood).not.toHaveBeenCalled();
  });

  it('ignores a second scan while a lookup is in flight', async () => {
    let finish: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render();
    await act(async () => {
      mockOnScanned?.({ data: '12345678' });
      mockOnScanned?.({ data: '12345678' });
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: 404, ok: false }));
  });
});
