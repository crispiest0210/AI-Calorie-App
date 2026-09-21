import { afterEach, describe, expect, it } from 'vitest';
import { isUuid, setRandomSource, timestampOfUuidv7, uuidv7 } from '../src/ids';

describe('uuidv7', () => {
  it('produces well-formed v7 ids', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('encodes the timestamp and sorts by time', () => {
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_700_000_001_000);
    expect(timestampOfUuidv7(early)).toBe(1_700_000_000_000);
    expect(early < late).toBe(true);
  });

  it('clamps a negative clock to the epoch', () => {
    expect(timestampOfUuidv7(uuidv7(-5))).toBe(0);
    expect(timestampOfUuidv7(uuidv7(10.9))).toBe(10);
  });

  it('rejects non-v7 and malformed ids', () => {
    expect(timestampOfUuidv7('not-a-uuid')).toBeNull();
    expect(timestampOfUuidv7('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(isUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
  });

  it('is unique across many draws', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => uuidv7()));
    expect(ids.size).toBe(2000);
  });
});

describe('random source', () => {
  afterEach(() => setRandomSource(null));

  it('uses an injected source when the platform has no Web Crypto', () => {
    setRandomSource((bytes) => bytes.fill(0xab));
    const id = uuidv7(1_700_000_000_000);
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(id.split('-').at(-1)).toBe('abababababab');
  });

  it('fails loudly rather than handing out guessable ids', () => {
    // Hermes (React Native) has no crypto global at all; the app installs
    // expo-crypto through setRandomSource before the first write.
    const original = globalThis.crypto;
    try {
      Reflect.deleteProperty(globalThis, 'crypto');
      expect(() => uuidv7()).toThrow(/No secure random source/);
      Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
      expect(() => uuidv7()).toThrow(/No secure random source/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
