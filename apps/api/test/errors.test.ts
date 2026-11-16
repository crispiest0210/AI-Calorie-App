import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { PROBLEM_CODES, problemDetails } from '@nt/core';
import { ApiError, problemResponse } from '../src/errors';

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

describe('problemResponse', () => {
  const appThrowing = (error: ApiError) => new Hono().get('/', (c) => problemResponse(c, error));

  it('sends the problem body with its status and the problem+json content type', async () => {
    const error = new ApiError('not_found', 'no such entry');
    const res = await appThrowing(error).request('/');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toEqual(error.toProblem());
  });

  it('forwards extra headers such as retry-after', async () => {
    const res = await appThrowing(new ApiError('rate_limited', undefined, { 'retry-after': '30' })).request('/');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });
});
