/** RFC 9457 problem+json with the stable `code` the app maps to copy (spec 4.1). */
import type { Context } from 'hono';
import type { ProblemCode, ProblemDetails } from '@nt/core';

const TITLES: Record<ProblemCode, { status: number; title: string }> = {
  validation_failed: { status: 422, title: 'The request body did not validate' },
  not_found: { status: 404, title: 'Not found' },
  unauthorized: { status: 401, title: 'Authentication required' },
  rate_limited: { status: 429, title: 'Too many requests' },
  upstream_unavailable: { status: 502, title: 'An upstream service is unavailable' },
  not_food: { status: 422, title: 'The image does not appear to contain food' },
  analysis_timeout: { status: 504, title: 'Analysis took too long' },
  sync_cursor_expired: { status: 410, title: 'Sync cursor is older than the tombstone window' },
  upgrade_required: { status: 426, title: 'This app version can no longer sync safely' },
  server_error: { status: 500, title: 'Something went wrong' },
};

export class ApiError extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? code);
    this.name = 'ApiError';
  }

  get status(): number {
    return TITLES[this.code].status;
  }

  toProblem(): ProblemDetails {
    const { status, title } = TITLES[this.code];
    return {
      type: `https://nutritiontracker.dev/problems/${this.code}`,
      title,
      status,
      code: this.code,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

export function problemResponse(c: Context, error: ApiError) {
  return c.json(error.toProblem(), error.status as never, {
    'content-type': 'application/problem+json',
    ...error.headers,
  });
}
