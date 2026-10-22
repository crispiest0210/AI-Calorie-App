/**
 * Numbers people type. A keyboard may offer "," as the decimal separator
 * ("12,5" in most of Europe), a field may be half-typed ("1.", "."), and a
 * paste can carry anything. These helpers are the only way typed text becomes
 * a Num, so no screen ever hands raw text to dec()/num().
 */
import { num, tryDec, type Num } from './decimal';

/** Digits with at most one "." — the shape of a number while it is being typed. */
const DRAFT = /^\d*\.?\d*$/;

function normalizeSeparators(text: string): string | null {
  const trimmed = text.trim();
  const commas = trimmed.split(',').length - 1;
  if (commas > 1) return null;
  const dotted = trimmed.replace(',', '.');
  return DRAFT.test(dotted) ? dotted : null;
}

/**
 * Normalizes text while it is being typed: maps a single "," to "." and keeps
 * partial numbers like "", "1." and ".5". Returns null when the text cannot
 * become a number (a second separator, a sign, an exponent, a letter), so the
 * field can refuse the keystroke instead of silently rewriting it.
 */
export function normalizeNumberDraft(text: string): string | null {
  return normalizeSeparators(text);
}

/**
 * Parses typed text into a canonical, non-negative decimal string, or null
 * when it is blank or not a number. "12,5" → "12.5"; "1.2.3", "-1", "1e3",
 * "." → null.
 */
export function parseUserNumber(text: string): Num | null {
  const normalized = normalizeSeparators(text);
  if (normalized === null) return null;
  // The draft shape already rules out signs and exponents; tryDec rejects the
  // digitless leftovers ("" and ".").
  const parsed = tryDec(normalized);
  return parsed === null ? null : num(parsed);
}
