import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../src/auth/provider';
import * as sessionStore from '../src/auth/session';
import type { Session } from '../src/auth/session';

jest.mock('../src/auth/session', () => ({
  loadSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
  refreshSession: jest.fn(),
  isExpired: jest.fn(),
}));

const store = sessionStore as jest.Mocked<typeof sessionStore>;

const session: Session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 2_000,
  userId: 'user-1',
  email: 'viet@example.com',
};

const wrapper = ({ children }: { children: React.ReactNode }) => <SessionProvider>{children}</SessionProvider>;

async function renderSession(stored: Session | null) {
  store.loadSession.mockResolvedValue(stored);
  const hook = renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  store.saveSession.mockResolvedValue(undefined);
  store.clearSession.mockResolvedValue(undefined);
  store.isExpired.mockReturnValue(false);
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('SessionProvider', () => {
  it('starts loading and settles into local mode when nothing is stored', async () => {
    store.loadSession.mockResolvedValue(null);
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('restores a stored session', async () => {
    const { result } = await renderSession(session);
    expect(result.current.session).toEqual(session);
  });

  it('persists a session on sign-in and clears it on sign-out', async () => {
    const { result } = await renderSession(null);
    await act(() => result.current.signIn(session));
    expect(store.saveSession).toHaveBeenCalledWith(session);
    expect(result.current.session).toEqual(session);

    await act(() => result.current.signOut());
    expect(store.clearSession).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it('has no access token in local mode', async () => {
    const { result } = await renderSession(null);
    await expect(result.current.getAccessToken()).resolves.toBeNull();
    expect(store.refreshSession).not.toHaveBeenCalled();
  });

  it('returns the stored token while it is still valid', async () => {
    const { result } = await renderSession(session);
    await expect(result.current.getAccessToken()).resolves.toBe('access');
    expect(store.refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token and keeps the refreshed session', async () => {
    const refreshed = { ...session, accessToken: 'fresh', expiresAt: 9_000 };
    store.isExpired.mockReturnValue(true);
    store.refreshSession.mockResolvedValue(refreshed);
    const { result } = await renderSession(session);

    let token: string | null = null;
    await act(async () => {
      token = await result.current.getAccessToken();
    });
    expect(token).toBe('fresh');
    expect(result.current.session).toEqual(refreshed);
  });

  it('signs out when the refresh fails', async () => {
    store.isExpired.mockReturnValue(true);
    store.refreshSession.mockResolvedValue(null);
    const { result } = await renderSession(session);

    let token: string | null = 'unset';
    await act(async () => {
      token = await result.current.getAccessToken();
    });
    expect(token).toBeNull();
    expect(store.clearSession).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it('refuses to be used outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSession())).toThrow('useSession must be used inside SessionProvider');
    spy.mockRestore();
  });
});
