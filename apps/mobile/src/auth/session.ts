/**
 * Tokens live in the device keychain, never in the database or in app state
 * that gets persisted (spec 2.9, MASVS L1). The access token is short-lived;
 * the refresh token is exchanged for a new one when it expires.
 */
import * as SecureStore from 'expo-secure-store';
import { config } from '../config';

const KEY = 'nt.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds. */
  expiresAt: number;
  userId: string;
  email: string | null;
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    await SecureStore.deleteItemAsync(KEY);
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** Refreshed a minute early, so a request never starts with a dying token. */
const REFRESH_MARGIN_SECONDS = 60;

export function isExpired(session: Session, now = Date.now()): boolean {
  return session.expiresAt - REFRESH_MARGIN_SECONDS <= now / 1000;
}

export async function refreshSession(session: Session): Promise<Session | null> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.supabaseAnonKey },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  }).catch(() => null);

  if (response === null || !response.ok) return null;
  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user?: { id: string; email?: string | null };
  };
  const next: Session = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + body.expires_in,
    userId: body.user?.id ?? session.userId,
    email: body.user?.email ?? session.email,
  };
  await saveSession(next);
  return next;
}
