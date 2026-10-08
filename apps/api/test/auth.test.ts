import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { bearerToken, signTestToken, verifyToken, type AuthConfig } from '../src/auth';
import { ApiError } from '../src/errors';

const CONFIG: AuthConfig = { jwtSecret: 'unit-test-secret-unit-test-secret' };

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected the promise to reject');
}

describe('verifyToken', () => {
  it('returns the subject and issued-at of a valid token', async () => {
    const token = await signTestToken('user-1', CONFIG, 1_700_000_000);
    // The helper's 1h expiry is relative to now, so only iat is pinned.
    await expect(verifyToken(token, CONFIG)).resolves.toEqual({ id: 'user-1', issuedAt: 1_700_000_000 });
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signTestToken('user-1', { jwtSecret: 'another-secret-another-secret-00' });
    expect((await rejection(verifyToken(token, CONFIG))).code).toBe('unauthorized');
  });

  it('rejects an expired token', async () => {
    const key = new TextEncoder().encode(CONFIG.jwtSecret);
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect((await rejection(verifyToken(token, CONFIG))).code).toBe('unauthorized');
  });

  it('rejects a token without a subject', async () => {
    const key = new TextEncoder().encode(CONFIG.jwtSecret);
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).sign(key);
    const error = await rejection(verifyToken(token, CONFIG));
    expect(error.code).toBe('unauthorized');
    expect(error.message).toBe('token has no subject');
  });

  it('enforces the issuer and audience when configured', async () => {
    const key = new TextEncoder().encode(CONFIG.jwtSecret);
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('project-a')
      .setAudience('authenticated')
      .sign(key);
    await expect(verifyToken(token, { ...CONFIG, issuer: 'project-a', audience: 'authenticated' })).resolves.toMatchObject({ id: 'user-1' });
    expect((await rejection(verifyToken(token, { ...CONFIG, issuer: 'project-b' }))).code).toBe('unauthorized');
    expect((await rejection(verifyToken(token, { ...CONFIG, audience: 'anon' }))).code).toBe('unauthorized');
  });

  it('rejects garbage', async () => {
    expect((await rejection(verifyToken('not-a-jwt', CONFIG))).code).toBe('unauthorized');
  });
});

describe('bearerToken', () => {
  it('extracts the token case-insensitively and trims it', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer   abc.def  ')).toBe('abc.def');
  });

  it('rejects a missing or non-bearer header', () => {
    expect(() => bearerToken(undefined)).toThrow(ApiError);
    expect(() => bearerToken('Basic abc')).toThrow(ApiError);
    expect(() => bearerToken('')).toThrow(ApiError);
  });
});
