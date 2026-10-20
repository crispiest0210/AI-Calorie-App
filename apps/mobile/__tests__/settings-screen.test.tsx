/**
 * Settings screen: account section per build/session state, queue and catalog
 * summaries, export (sign-in gate, failure, share) and the account-deletion
 * confirmation including the stale-session 401 path.
 */
import { Alert, Share } from 'react-native';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockSignOut = jest.fn(async () => {});
const mockSyncNow = jest.fn(async () => {});
const mockGetAccessToken = jest.fn<Promise<string | null>, []>(async () => 'tok');
let mockSession: { userId: string; email: string | null } | null = null;
let mockAccountsEnabled = true;
let mockCatalog: { quality_tier: string; n: number }[] = [];
let mockReleases: { provider: string; dataset: string | null; version: string | null }[] = [];
let mockQueued = 0;
let mockCursor = 0;

jest.mock('@/db/provider', () => ({
  useDbQuery: (read: (db: unknown) => unknown) =>
    read({
      all: (query: unknown) => (JSON.stringify(query).includes('source_release') ? mockReleases : mockCatalog),
    }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@nt/db', () => ({
  outboxRepo: { pendingCount: () => mockQueued },
  sync: { pullCursor: () => mockCursor },
}));
jest.mock('@/auth/provider', () => ({
  useSession: () => ({ session: mockSession, signOut: mockSignOut, getAccessToken: mockGetAccessToken }),
}));
jest.mock('@/sync/provider', () => ({
  useSync: () => ({ state: 'idle', pending: mockQueued, message: null, lastSyncedAt: null, syncNow: mockSyncNow }),
}));
jest.mock('@/config', () => ({
  get accountsEnabled() {
    return mockAccountsEnabled;
  },
  config: { apiBaseUrl: 'https://api.test' },
}));

import SettingsScreen from '../app/(tabs)/settings';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render(ui: React.ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const signedIn = { userId: 'u1', email: 'viet@example.com' };
let alertSpy: jest.SpyInstance;
let fetchMock: jest.Mock;

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSignOut.mockClear();
    mockSyncNow.mockClear();
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('tok');
    mockSession = null;
    mockAccountsEnabled = true;
    mockCatalog = [];
    mockReleases = [];
    mockQueued = 0;
    mockCursor = 0;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens goals and recipes from the top card', () => {
    render(<SettingsScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Goals' }));
    fireEvent.press(screen.getByRole('button', { name: 'Recipes' }));
    expect(mockPush).toHaveBeenNthCalledWith(1, '/goals');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/recipes');
  });

  it('explains local mode when the build has no API address', () => {
    mockAccountsEnabled = false;
    render(<SettingsScreen />);
    expect(screen.getByText(/runs in local mode/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('offers sign-in when signed out and hides export and delete', () => {
    render(<SettingsScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
    expect(screen.queryByRole('button', { name: 'Export everything' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
  });

  it('shows the account, sync cursor and sign-out when signed in', () => {
    mockSession = signedIn;
    mockCursor = 42;
    render(<SettingsScreen />);
    expect(screen.getByText('Signed in as viet@example.com')).toBeTruthy();
    expect(screen.getByText(/Not synced yet/)).toBeTruthy();
    expect(screen.getByText(/cursor 42/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Sync now' }));
    expect(mockSyncNow).toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('falls back to the user id when the account has no email', () => {
    mockSession = { userId: 'u9', email: null };
    render(<SettingsScreen />);
    expect(screen.getByText('Signed in as u9')).toBeTruthy();
  });

  it('pluralises the waiting-change count', () => {
    mockQueued = 1;
    const { rerender } = render(<SettingsScreen />);
    expect(screen.getByText('1 change waiting to sync.')).toBeTruthy();
    mockQueued = 3;
    rerender(
      <SafeAreaProvider initialMetrics={metrics}>
        <SettingsScreen />
      </SafeAreaProvider>,
    );
    expect(screen.getByText('3 changes waiting to sync.')).toBeTruthy();
  });

  it('lists catalog tiers and active source releases', () => {
    mockCatalog = [{ quality_tier: 'unknown_tier', n: 7 }];
    mockReleases = [
      { provider: 'usda', dataset: 'foundation', version: '2024-04' },
      { provider: 'off', dataset: null, version: null },
    ];
    render(<SettingsScreen />);
    expect(screen.getByText('unknown_tier')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('USDA · foundation · 2024-04')).toBeTruthy();
    expect(screen.getByText('OFF · catalog · unversioned')).toBeTruthy();
  });

  it('shares the export with the bearer token', async () => {
    mockSession = signedIn;
    fetchMock.mockResolvedValue({ ok: true, text: async () => '{"foods":[]}' });
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Export everything' }));
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/me/export', { headers: { authorization: 'Bearer tok' } });
    expect(share).toHaveBeenCalledWith({ message: '{"foods":[]}', title: 'Nutrition Tracker export' });
    expect(screen.getByRole('button', { name: 'Export everything' })).toBeTruthy();
  });

  it('asks to sign in when there is no access token, and reports a failed export', async () => {
    mockSession = signedIn;
    mockGetAccessToken.mockResolvedValueOnce(null);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Export everything' }));
    });
    expect(alertSpy).toHaveBeenCalledWith('Sign in first', expect.any(String));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: false });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Export everything' }));
    });
    expect(alertSpy).toHaveBeenCalledWith('Export failed', expect.any(String));
    expect(share).not.toHaveBeenCalled();
  });

  describe('delete account', () => {
    async function confirmDelete() {
      render(<SettingsScreen />);
      fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
      const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
      expect(alertSpy.mock.calls[0]![0]).toBe('Delete your account?');
      expect(buttons.map((b) => b.text)).toEqual(['Keep it', 'Delete']);
      alertSpy.mockClear();
      await act(async () => {
        buttons[1]!.onPress!();
      });
    }

    beforeEach(() => {
      mockSession = signedIn;
    });

    it('deletes on the server, then signs out', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 204 });
      await confirmDelete();
      expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/me', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok' },
      });
      expect(mockSignOut).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith('Account deleted', expect.any(String));
    });

    it('asks for a fresh sign-in on 401 and stays signed in', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      await confirmDelete();
      expect(alertSpy).toHaveBeenCalledWith('Sign in again', expect.any(String));
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('reports other failures without signing out', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      await confirmDelete();
      expect(alertSpy).toHaveBeenCalledWith('Could not delete', expect.any(String));
      expect(mockSignOut).not.toHaveBeenCalled();
    });
  });
});
