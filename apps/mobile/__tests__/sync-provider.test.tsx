/**
 * Sync failures must never block logging (spec 2.11): each failure kind maps
 * to a quiet state, and only an auth failure signs the user out.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockSync = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockActiveSourceRelease = jest.fn();
const mockDb = { marker: 'db' };
const mockGetAccessToken = jest.fn();
let mockSession: { userId: string } | null = { userId: 'u1' };

jest.mock('@nt/db', () => ({
  foods: { activeSourceRelease: (...args: unknown[]) => mockActiveSourceRelease(...args) },
  outboxRepo: { pendingCount: () => 3 },
  sync: {
    SyncError: class SyncError extends Error {
      kind: string;
      constructor(kind: string, message: string) {
        super(message);
        this.kind = kind;
      }
    },
    HttpTransport: class {},
    sync: (...args: unknown[]) => mockSync(...args),
  },
}));
jest.mock('@/db/provider', () => ({ useDb: () => mockDb }));
jest.mock('@/config', () => ({ config: { apiBaseUrl: 'https://api.test', appVersion: '1.0.0' } }));
jest.mock('@/auth/provider', () => ({
  useSession: () => ({ session: mockSession, getAccessToken: mockGetAccessToken, signOut: mockSignOut }),
}));

import { sync as syncClient } from '@nt/db';
import { SyncProvider, useSync } from '@/sync/provider';

function Probe() {
  const { state, message, pending } = useSync();
  return (
    <Text testID="status">
      {state}|{message ?? ''}|{pending}
    </Text>
  );
}

function renderProvider() {
  render(
    <SyncProvider>
      <Probe />
    </SyncProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { userId: 'u1' };
  mockActiveSourceRelease.mockReturnValue('rel-1');
});

describe('SyncProvider', () => {
  it('goes idle after a successful sync and reports the outbox depth', async () => {
    mockSync.mockResolvedValue({ pushed: 1, pulled: 0, cursor: 1, reset: false });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle||3'));
    expect(mockSync).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userSourceReleaseId: 'rel-1' });
  });

  it('stays signed out and does not sync without a session', async () => {
    mockSession = null;
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed_out||3'));
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('signs the user out on an auth failure', async () => {
    mockSync.mockRejectedValue(new syncClient.SyncError('auth' as never, 'expired'));
    renderProvider();
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed_out|Signed out. Sign in again to keep syncing.|3'));
  });

  it.each(['offline', 'timeout'])('treats a %s failure as quietly offline', async (kind) => {
    mockSync.mockRejectedValue(new syncClient.SyncError(kind as never, 'no network'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('offline||3'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('surfaces other sync errors with their message', async () => {
    mockSync.mockRejectedValue(new syncClient.SyncError('server' as never, 'boom'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error|boom|3'));
  });

  it('reports an error when the catalog has not finished loading', async () => {
    mockActiveSourceRelease.mockReturnValue(null);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error|catalog is still loading|3'));
    expect(mockSync).not.toHaveBeenCalled();
  });
});
