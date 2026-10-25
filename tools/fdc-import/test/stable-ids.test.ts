import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { stableId } from '../src/stable-ids';

describe('stableId', () => {
  it('is deterministic for the same namespace and name', () => {
    expect(stableId('usda', '170567')).toBe(stableId('usda', '170567'));
  });

  it('differs across names and across namespaces', () => {
    expect(stableId('usda', '170567')).not.toBe(stableId('usda', '170568'));
    expect(stableId('usda', '1')).not.toBe(stableId('off', '1'));
  });

  it('produces a lower-case RFC 4122 version-5 variant-1 UUID', () => {
    expect(stableId('portion', 'x:0')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is the first 16 bytes of sha1("namespace:name") with version and variant bits set', () => {
    const hex = createHash('sha1').update('release:usda:14.3').digest('hex').slice(0, 32);
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
    expect(stableId('release', 'usda:14.3')).toBe(expected);
  });
});
