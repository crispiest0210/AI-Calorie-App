/**
 * Row ids are UUIDv7 generated on the device (spec 2.10): time-ordered, so
 * inserts stay local in the index and offline rows sort by creation time.
 */

const HEX = '0123456789abcdef';

export type RandomSource = (bytes: Uint8Array) => void;

let randomSource: RandomSource | null = null;

/**
 * Supplies the randomness for row ids. Node and browsers have
 * `crypto.getRandomValues`; Hermes does not, so React Native installs
 * expo-crypto's implementation here before the first row is written.
 */
export function setRandomSource(source: RandomSource | null): void {
  randomSource = source;
}

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  if (randomSource !== null) {
    randomSource(bytes);
    return bytes;
  }
  const webCrypto = globalThis.crypto;
  if (webCrypto === undefined || typeof webCrypto.getRandomValues !== 'function') {
    // Falling back to Math.random would hand out guessable ids that still look
    // like uuids, so this fails loudly instead.
    throw new Error('No secure random source: call setRandomSource() before generating ids.');
  }
  webCrypto.getRandomValues(bytes);
  return bytes;
}

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Math.max(0, Math.floor(now)));
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    const b = bytes[i]!;
    out += HEX[b >> 4]! + HEX[b & 0x0f]!;
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Milliseconds encoded in a v7 id; null for any other uuid. */
export function timestampOfUuidv7(uuid: string): number | null {
  if (!isUuid(uuid) || uuid[14] !== '7') return null;
  return Number(BigInt('0x' + uuid.slice(0, 8) + uuid.slice(9, 13)));
}
