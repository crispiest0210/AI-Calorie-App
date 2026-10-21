/**
 * The email-code flow talks to Supabase's REST endpoints directly; these pin
 * the request shape, the user-facing error copy, and that only a verified
 * session is persisted.
 */
import { AuthError, requestEmailCode, verifyEmailCode } from '../src/auth/supabase';
import { saveSession } from '../src/auth/session';

jest.mock('../src/config', () => ({
  config: { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-key' },
}));
jest.mock('../src/auth/session', () => ({ saveSession: jest.fn().mockResolvedValue(undefined) }));

const fetchMock = jest.fn();
const save = saveSession as jest.Mock;

function reply(ok: boolean, body: unknown) {
  return { ok, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.resetAllMocks();
  save.mockResolvedValue(undefined);
});

describe('requestEmailCode', () => {
  it('posts the email to the OTP endpoint with the anon key', async () => {
    fetchMock.mockResolvedValue(reply(true, {}));
    await requestEmailCode('viet@example.com');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/auth/v1/otp');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ email: 'viet@example.com', create_user: true });
  });

  it('surfaces the server message when the email is refused', async () => {
    fetchMock.mockResolvedValue(reply(false, { msg: 'Email rate limit exceeded' }));
    await expect(requestEmailCode('a@b.co')).rejects.toThrow('Email rate limit exceeded');
  });

  it('falls back to error_description, then to generic copy', async () => {
    fetchMock.mockResolvedValueOnce(reply(false, { error_description: 'Signups not allowed' }));
    await expect(requestEmailCode('a@b.co')).rejects.toThrow('Signups not allowed');
    fetchMock.mockResolvedValueOnce({ ok: false, json: () => Promise.reject(new Error('not json')) });
    await expect(requestEmailCode('a@b.co')).rejects.toThrow('That email was not accepted.');
  });

  it('reports a dropped connection as an AuthError that points to local use', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const failure = requestEmailCode('a@b.co');
    await expect(failure).rejects.toBeInstanceOf(AuthError);
    await expect(failure).rejects.toThrow('No connection. You can keep logging without an account.');
  });
});

describe('verifyEmailCode', () => {
  const verified = {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    user: { id: 'user-1', email: 'viet@example.com' },
  };

  it('verifies the code, then saves and returns the session with an absolute expiry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    fetchMock.mockResolvedValue(reply(true, verified));

    const session = await verifyEmailCode('viet@example.com', '123456');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/auth/v1/verify');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'viet@example.com', token: '123456', type: 'email' });
    expect(session).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 1_000 + 3600,
      userId: 'user-1',
      email: 'viet@example.com',
    });
    expect(save).toHaveBeenCalledWith(session);
    jest.restoreAllMocks();
  });

  it('keeps a null email when the account has none', async () => {
    fetchMock.mockResolvedValue(reply(true, { ...verified, user: { id: 'user-2', email: null } }));
    expect((await verifyEmailCode('x@y.co', '000000')).email).toBeNull();
  });

  it('rejects a wrong code without saving anything', async () => {
    fetchMock.mockResolvedValue(reply(false, { msg: 'Token has expired or is invalid' }));
    await expect(verifyEmailCode('a@b.co', '111111')).rejects.toThrow('That code did not match. Check it and try again.');
    expect(save).not.toHaveBeenCalled();
  });

  it('reports a dropped connection without saving anything', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(verifyEmailCode('a@b.co', '111111')).rejects.toBeInstanceOf(AuthError);
    expect(save).not.toHaveBeenCalled();
  });
});
