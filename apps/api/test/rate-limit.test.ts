/** The per-user fixed-window limiter (spec 2.12), driven by a fake clock. */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { LIMITS, RateLimiter } from '../src/rate-limit';

function limiterAt(start = 1_000_000) {
  let now = start;
  const limiter = new RateLimiter(() => now);
  return { limiter, advance: (ms: number) => (now += ms) };
}

function rejection(fn: () => void): ApiError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the limiter to reject');
}

describe('RateLimiter', () => {
  it('allows exactly the limit, then rejects with 429 and a retry-after', () => {
    const { limiter, advance } = limiterAt();
    for (let i = 0; i < LIMITS.barcode.limit; i++) limiter.check('u1', 'barcode');
    advance(10_000);

    const err = rejection(() => limiter.check('u1', 'barcode'));
    expect(err.code).toBe('rate_limited');
    expect(err.status).toBe(429);
    expect(err.headers['retry-after']).toBe('50');
  });

  it('never advertises a retry-after below one second', () => {
    const { limiter, advance } = limiterAt();
    for (let i = 0; i < LIMITS.barcode.limit; i++) limiter.check('u1', 'barcode');
    advance(LIMITS.barcode.windowMs - 1);

    expect(rejection(() => limiter.check('u1', 'barcode')).headers['retry-after']).toBe('1');
  });

  it('starts a fresh window once the old one has elapsed', () => {
    const { limiter, advance } = limiterAt();
    for (let i = 0; i < LIMITS.barcode.limit; i++) limiter.check('u1', 'barcode');
    advance(LIMITS.barcode.windowMs);

    expect(() => limiter.check('u1', 'barcode')).not.toThrow();
  });

  it('counts each user and each bucket separately', () => {
    const { limiter } = limiterAt();
    for (let i = 0; i < LIMITS.barcode.limit; i++) limiter.check('u1', 'barcode');

    expect(() => limiter.check('u2', 'barcode')).not.toThrow();
    expect(() => limiter.check('u1', 'search')).not.toThrow();
  });
});
