/**
 * Runs sync on app foreground, shortly after a write, and on demand (spec
 * 2.10). A failure here never blocks logging: SQLite already has the row, so
 * the UI shows a quiet badge rather than an alert (2.11).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { foods as foodsRepo, outboxRepo, sync as syncClient } from '@nt/db';
import { useDb } from '@/db/provider';
import { config } from '@/config';
import { useSession } from '@/auth/provider';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed_out';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  pending: number;
  message: string | null;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncStatus | null>(null);

/** Debounce after a write, so a burst of logging is one round trip (2.10). */
const WRITE_DEBOUNCE_MS = 5_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const { session, getAccessToken, signOut } = useSession();
  const [state, setState] = useState<SyncState>('signed_out');
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pending, setPending] = useState(() => outboxRepo.pendingCount(db));
  const running = useRef(false);

  const syncNow = useCallback(async () => {
    if (session === null) {
      setState('signed_out');
      return;
    }
    if (running.current) return;
    running.current = true;
    setState('syncing');

    try {
      const userRelease = foodsRepo.activeSourceRelease(db, 'user');
      if (userRelease === null) throw new Error('catalog is still loading');

      const transport = new syncClient.HttpTransport({
        baseUrl: config.apiBaseUrl,
        getToken: getAccessToken,
        appVersion: config.appVersion,
      });
      await syncClient.sync(db, transport, { userSourceReleaseId: userRelease });
      setState('idle');
      setMessage(null);
      setLastSyncedAt(Date.now());
    } catch (error) {
      if (error instanceof syncClient.SyncError) {
        if (error.kind === 'auth') {
          await signOut();
          setState('signed_out');
          setMessage('Signed out. Sign in again to keep syncing.');
        } else if (error.kind === 'offline' || error.kind === 'timeout') {
          setState('offline');
          setMessage(null);
        } else {
          setState('error');
          setMessage(error.message);
        }
      } else {
        setState('error');
        setMessage(error instanceof Error ? error.message : 'Sync failed');
      }
    } finally {
      setPending(outboxRepo.pendingCount(db));
      running.current = false;
    }
  }, [db, session, getAccessToken, signOut]);

  // Foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);

  // First run after sign-in. Anything logged before the account existed is
  // already in the outbox, so this is also what adopts local data (2.9).
  useEffect(() => {
    if (session !== null) void syncNow();
    else setState('signed_out');
  }, [session, syncNow]);

  // Debounced after writes: the outbox depth is the signal something changed.
  useEffect(() => {
    if (session === null) return undefined;
    const timer = setInterval(() => {
      const depth = outboxRepo.pendingCount(db);
      setPending(depth);
      if (depth > 0 && !running.current) void syncNow();
    }, WRITE_DEBOUNCE_MS);
    return () => clearInterval(timer);
  }, [db, session, syncNow]);

  const value = useMemo<SyncStatus>(
    () => ({ state, lastSyncedAt, pending, message, syncNow }),
    [state, lastSyncedAt, pending, message, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncStatus {
  const context = useContext(SyncContext);
  if (context === null) throw new Error('useSync must be used inside SyncProvider');
  return context;
}
