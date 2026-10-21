/**
 * Photo screen: it needs an account and the camera, tells the user what went
 * wrong at each stage of the upload, and hands the server draft to review.
 */
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetAccessToken = jest.fn();
const mockTakePicture = jest.fn();
const mockManipulate = jest.fn();
const mockFetch = jest.fn();
let mockAccountsEnabled = true;
let mockPermission: { granted: boolean } | null = { granted: false };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ mealSlot: 'dinner', date: '2026-03-04' }),
}));
jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CameraView: forwardRef((_props: object, ref) => {
      useImperativeHandle(ref, () => ({ takePictureAsync: (...args: unknown[]) => mockTakePicture(...args) }));
      return <View testID="camera" />;
    }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('@/auth/provider', () => ({ useSession: () => ({ getAccessToken: mockGetAccessToken }) }));
jest.mock('@/config', () => ({
  config: { apiBaseUrl: 'https://api.test' },
  get accountsEnabled() {
    return mockAccountsEnabled;
  },
}));

import PhotoScreen from '../app/photo';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render() {
  return rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <PhotoScreen />
    </SafeAreaProvider>,
  );
}

const analyse = async () => {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Analyse this meal' }));
  });
};

describe('PhotoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccountsEnabled = true;
    mockPermission = { granted: true };
    mockGetAccessToken.mockResolvedValue('token');
    mockTakePicture.mockResolvedValue({ uri: 'file:///raw.jpg' });
    mockManipulate.mockResolvedValue({ uri: 'file:///small.jpg' });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  it('explains that analysis needs an account when accounts are not configured', () => {
    mockAccountsEnabled = false;
    render();
    expect(screen.getByText('Photo analysis needs an account')).toBeTruthy();
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('renders nothing while the permission state is unknown', () => {
    mockPermission = null;
    render();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByText('Camera access')).toBeNull();
  });

  it('asks for camera access and offers search as the way around it', () => {
    mockPermission = { granted: false };
    render();
    fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Log by searching instead' }));
    expect(mockReplace).toHaveBeenCalledWith('/log');
  });

  it('asks for sign-in without calling the API when there is no access token', async () => {
    mockGetAccessToken.mockResolvedValue(null);
    render();
    await analyse();
    expect(screen.getByText(/Sign in to analyse photos/)).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('says the service is unreachable when the upload URL cannot be created', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    render();
    await analyse();
    expect(screen.getByText(/analysis service is unreachable/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('maps an analysis failure code to its copy and falls back for unknown ones', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ analysisId: 'a1', uploadUrl: 'https://up.test/a1' }) })
      .mockResolvedValueOnce({ blob: async () => 'blob' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'not_food' }) });
    render();
    await analyse();
    expect(screen.getByText(/does not look like food/)).toBeTruthy();

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ analysisId: 'a2', uploadUrl: 'https://up.test/a2' }) })
      .mockResolvedValueOnce({ blob: async () => 'blob' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('not json'); } });
    await analyse();
    expect(screen.getByText(/That did not work/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('resizes without EXIF, uploads, then opens review with the draft', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ analysisId: 'a1', uploadUrl: 'https://up.test/a1' }) })
      .mockResolvedValueOnce({ blob: async () => 'blob' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ok: true, text: async () => '{"items":[]}' });
    render();
    await analyse();

    expect(mockTakePicture).toHaveBeenCalledWith({ quality: 0.9, exif: false });
    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///raw.jpg',
      [{ resize: { width: 1568 } }],
      { compress: 0.8, format: 'jpeg' },
    );
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://api.test/v1/photos/upload-url', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(mockFetch).toHaveBeenNthCalledWith(3, 'https://up.test/a1', {
      method: 'PUT',
      body: 'blob',
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(mockFetch).toHaveBeenNthCalledWith(4, 'https://api.test/v1/photo-analyses/a1/run', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/photo-review',
      params: { analysisId: 'a1', draft: '{"items":[]}', mealSlot: 'dinner', date: '2026-03-04' },
    });
  });

  it('re-enables the button when no picture comes back so the photo can be retried', async () => {
    mockTakePicture.mockResolvedValueOnce(undefined);
    render();
    await analyse();
    expect(mockManipulate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Analyse this meal' }).props.accessibilityState?.disabled).toBeFalsy();
  });
});
