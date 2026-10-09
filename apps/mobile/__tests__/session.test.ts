import * as SecureStore from 'expo-secure-store';
import { clearSession, isExpired, loadSession, refreshSession, saveSession, type Session } from '../src/auth/session';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const store = SecureStore as jest.Mocked<typeof SecureStore>;

const session: Session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 2_000,
  userId: 'user-1',
  email: 'viet@example.com',
};

afterEach(() => {
  jest.resetAllMocks();
});

describe('isExpired', () => {
  it('treats a token as expired one minute before its real expiry', () => {
    expect(isExpired(session, (2_000 - 61) * 1000)).toBe(false);
    expect(isExpired(session, (2_000 - 60) * 1000)).toBe(true);
    expect(isExpired(session, 3_000 * 1000)).toBe(true);
  });
});

describe('loadSession', () => {
  it('returns null when nothing is stored', async () => {
    store.getItemAsync.mockResolvedValue(null);
    expect(await loadSession()).toBeNull();
    expect(store.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('round-trips a stored session', async () => {
    store.getItemAsync.mockResolvedValue(JSON.stringify(session));
    expect(await loadSession()).toEqual(session);
  });

  it('discards a corrupt entry instead of throwing', async () => {
    store.getItemAsync.mockResolvedValue('{not json');
    expect(await loadSession()).toBeNull();
    expect(store.deleteItemAsync).toHaveBeenCalledWith('nt.session');
  });
});

describe('saveSession / clearSession', () => {
  it('stores the session device-locally in the keychain', async () => {
    await saveSession(session);
    expect(store.setItemAsync).toHaveBeenCalledWith('nt.session', JSON.stringify(session), {
      keychainAccessible: 'when-unlocked-this-device-only',
    });
  });

  it('deletes the stored session', async () => {
    await clearSession();
    expect(store.deleteItemAsync).toHaveBeenCalledWith('nt.session');
  });
});

describe('refreshSession', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns null without saving when the network fails', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await refreshSession(session)).toBeNull();
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it('returns null without saving when the server rejects the refresh token', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    expect(await refreshSession(session)).toBeNull();
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it('saves and returns the rotated session, keeping identity when the body omits the user', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }),
    });

    const next = await refreshSession(session);

    expect(next).toEqual({
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: 1_000 + 3600,
      userId: 'user-1',
      email: 'viet@example.com',
    });
    expect(store.setItemAsync).toHaveBeenCalledWith('nt.session', JSON.stringify(next), expect.any(Object));
    jest.restoreAllMocks();
  });
});
