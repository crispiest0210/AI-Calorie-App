import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PROBLEM_CODES, problemDetails } from '@nt/core';
import { createApp } from '../src/app';
import { signTestToken } from '../src/auth';
import { ApiError } from '../src/errors';

const AUTH = { jwtSecret: 'test-secret-that-is-long-enough-for-hs256' };
const USER = '11111111-1111-4111-8111-111111111111';

describe('ApiError', () => {
  it('produces a schema-valid problem for every problem code', () => {
    for (const code of PROBLEM_CODES) {
      const error = new ApiError(code);
      const problem = error.toProblem();
      expect(problemDetails.parse(problem)).toEqual(problem);
      expect(problem.status).toBe(error.status);
      expect(problem.type).toBe(`https://nutritiontracker.dev/problems/${code}`);
    }
  });

  it('includes detail only when given, and uses it as the message', () => {
    expect(new ApiError('not_found').toProblem()).not.toHaveProperty('detail');
    const withDetail = new ApiError('validation_failed', 'name is required');
    expect(withDetail.toProblem().detail).toBe('name is required');
    expect(withDetail.message).toBe('name is required');
    expect(new ApiError('not_found').message).toBe('not_found');
  });
});

describe('an unexpected failure', () => {
  it('is answered as a generic 500 problem without leaking the underlying message', async () => {
    const pool = { connect: async () => { throw new Error('connection to db.internal:5432 refused'); } } as unknown as Pool;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const app = createApp({ pool, auth: AUTH });
      const token = await signTestToken(USER, AUTH);
      const res = await app.request(`/v1/foods/${USER}`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      const body = await res.text();
      expect(body).not.toContain('db.internal');
      expect(JSON.parse(body)).toMatchObject({ status: 500, type: 'https://nutritiontracker.dev/problems/server_error' });
      expect(log).toHaveBeenCalledWith('unhandled', expect.any(Error));
    } finally {
      log.mockRestore();
    }
  });
});
