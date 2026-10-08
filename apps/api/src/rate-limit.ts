/** Per-user fixed-window limits (spec 2.12). In-memory: one API instance today. */
import { ApiError } from './errors';

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export const LIMITS = {
  search: { limit: 60, windowMs: 60_000 },
  barcode: { limit: 30, windowMs: 60_000 },
  sync: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimit>;

const SWEEP_THRESHOLD = 1000;

export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  check(userId: string, bucket: keyof typeof LIMITS): void {
    const { limit, windowMs } = LIMITS[bucket];
    const key = `${bucket}:${userId}`;
    const current = this.windows.get(key);
    const now = this.now();
    this.sweep(now);

    if (current === undefined || now >= current.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      throw new ApiError('rate_limited', `limit of ${limit} per minute reached`, { 'retry-after': String(retryAfter) });
    }
    current.count += 1;
  }

  /** Drop expired windows so the map doesn't grow with every user ever seen. */
  private sweep(now: number): void {
    if (this.windows.size < SWEEP_THRESHOLD) return;
    for (const [key, w] of this.windows) {
      if (now >= w.resetAt) this.windows.delete(key);
    }
  }
}
