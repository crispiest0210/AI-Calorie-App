import { describe, expect, it } from 'vitest';
import { PROBLEM_CODES, problemDetails } from '@nt/core';
import { ApiError } from '../src/errors';

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
