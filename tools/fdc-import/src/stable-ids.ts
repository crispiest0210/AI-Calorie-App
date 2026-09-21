/**
 * Catalog rows get ids derived from their content, not from the clock, so
 * rebuilding from the same fixtures produces the same database file. That is
 * what lets CI prove the committed catalog matches its sources, and what makes
 * "re-point to the previous release" (review item R1) a real rollback.
 */
import { createHash } from 'node:crypto';

/** RFC 4122 §4.3 name-based UUID (v5-shaped), namespaced per provider. */
export function stableId(namespace: string, name: string): string {
  const digest = createHash('sha1').update(`${namespace}:${name}`).digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
