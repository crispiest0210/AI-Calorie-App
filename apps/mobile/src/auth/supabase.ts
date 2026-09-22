/**
 * Supabase Auth over its REST endpoints. A one-time code by email needs no
 * native configuration, so it works in Expo Go; Sign in with Apple and Google
 * are the same flow with a provider token and need a development build.
 */
import { config } from '../config';
import { saveSession, type Session } from './session';

interface OtpVerifyResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string | null };
}

export class AuthError extends Error {}

async function authFetch(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.supabaseAnonKey },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response === null) throw new AuthError('No connection. You can keep logging without an account.');
  return response;
}

/** Sends the six-digit code. */
export async function requestEmailCode(email: string): Promise<void> {
  const response = await authFetch('/otp', { email, create_user: true });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { msg?: string; error_description?: string } | null;
    throw new AuthError(body?.msg ?? body?.error_description ?? 'That email was not accepted.');
  }
}

export async function verifyEmailCode(email: string, token: string): Promise<Session> {
  const response = await authFetch('/verify', { email, token, type: 'email' });
  if (!response.ok) throw new AuthError('That code did not match. Check it and try again.');

  const body = (await response.json()) as OtpVerifyResponse;
  const session: Session = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + body.expires_in,
    userId: body.user.id,
    email: body.user.email,
  };
  await saveSession(session);
  return session;
}
