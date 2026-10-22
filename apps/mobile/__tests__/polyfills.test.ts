/**
 * Hermes has no Web Crypto, so row ids depend on the polyfill handing
 * expo-crypto's native generator to the core id engine.
 */
import { getRandomValues } from 'expo-crypto';
import { setRandomSource, uuidv7 } from '@nt/core';
import '@/polyfills';

jest.mock('expo-crypto', () => ({
  getRandomValues: jest.fn((bytes: Uint8Array) => {
    bytes.fill(0xab);
    return bytes;
  }),
}));

afterAll(() => setRandomSource(null));

describe('polyfills', () => {
  it('routes id generation through expo-crypto', () => {
    const id = uuidv7(1);
    expect(getRandomValues).toHaveBeenCalled();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Node's own Web Crypto would make these differ; the fixed-byte mock proves it was bypassed.
    expect(uuidv7(1)).toBe(id);
  });
});
