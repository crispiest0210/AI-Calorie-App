import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { LIMITS, RateLimiter } from '../src/rate-limit';

describe('RateLimiter', () => {
  it('rejects past the limit with a retry-after, and resets after the window', () => {
    let now = 1_000;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < LIMITS.barcode.limit; i++) limiter.check('u1', 'barcode');

    now += 20_000;
    let error: unknown;
    try {
      limiter.check('u1', 'barcode');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'rate_limited', headers: { 'retry-after': '40' } });

    now += LIMITS.barcode.windowMs;
    expect(() => limiter.check('u1', 'barcode')).not.toThrow();
  });

  it('counts users and buckets separately', () => {
    const limiter = new RateLimiter(() => 0);
    for (let i = 0; i < LIMITS.barcode.limit; i++) limiter.check('u1', 'barcode');
    expect(() => limiter.check('u2', 'barcode')).not.toThrow();
    expect(() => limiter.check('u1', 'search')).not.toThrow();
  });

  it('evicts expired windows once the map is large', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 1000; i++) limiter.check(`u${i}`, 'search');
    now = LIMITS.search.windowMs;
    limiter.check('fresh', 'search');
    expect((limiter as unknown as { windows: Map<string, unknown> }).windows.size).toBe(1);
  });
});
