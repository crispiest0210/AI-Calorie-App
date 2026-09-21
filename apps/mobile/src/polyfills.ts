/**
 * Hermes ships no Web Crypto, so `crypto.getRandomValues` is undefined on
 * device — which is where the UUIDv7 row ids come from. expo-crypto has a
 * native implementation; this hands it to the engine before anything writes a
 * row, and must be imported before any other app module.
 */
import { getRandomValues } from 'expo-crypto';
import { setRandomSource } from '@nt/core';

setRandomSource((bytes) => {
  getRandomValues(bytes);
});
