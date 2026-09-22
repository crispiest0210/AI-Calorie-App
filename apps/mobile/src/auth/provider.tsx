/**
 * Session state. Local mode — no account at all — is a first-class state, not
 * an error: everything except sync works without signing in (spec 2.9).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearSession, isExpired, loadSession, refreshSession, saveSession, type Session } from './session';

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  /** Refreshes on the way out if the access token is about to expire. */
  getAccessToken: () => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSession().then((stored) => {
      setSession(stored);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async (next: Session) => {
    await saveSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
  }, []);

  const getAccessToken = useCallback(async () => {
    if (session === null) return null;
    if (!isExpired(session)) return session.accessToken;
    const refreshed = await refreshSession(session);
    if (refreshed === null) {
      await signOut();
      return null;
    }
    setSession(refreshed);
    return refreshed.accessToken;
  }, [session, signOut]);

  const value = useMemo(
    () => ({ session, loading, signIn, signOut, getAccessToken }),
    [session, loading, signIn, signOut, getAccessToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === null) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
