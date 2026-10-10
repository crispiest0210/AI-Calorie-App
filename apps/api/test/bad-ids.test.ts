/** Path ids that are not UUIDs must read as "no such thing", not a server error. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, USER_A, type Harness } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

describe('malformed path ids', () => {
  it.each(['/v1/foods/not-a-uuid', '/v1/photo-analyses/not-a-uuid'])('GET %s is a 404', async (path) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await h.request(USER_A, path);
    spy.mockRestore();
    expect(response.status).toBe(404);
  });
});
