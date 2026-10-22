import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeNumberDraft, parseUserNumber } from '../src/user-number';

describe('parseUserNumber', () => {
  it('parses plain numbers into canonical decimal strings', () => {
    expect(parseUserNumber('150')).toBe('150');
    expect(parseUserNumber('12.5')).toBe('12.5');
    expect(parseUserNumber('0')).toBe('0');
    expect(parseUserNumber('007')).toBe('7');
    expect(parseUserNumber('2.50')).toBe('2.5');
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseUserNumber('12,5')).toBe('12.5');
    expect(parseUserNumber('1,5')).toBe('1.5');
    expect(parseUserNumber(',5')).toBe('0.5');
  });

  it('accepts half-typed numbers that still mean something', () => {
    expect(parseUserNumber('1.')).toBe('1');
    expect(parseUserNumber('.5')).toBe('0.5');
    expect(parseUserNumber('3,')).toBe('3');
  });

  it('trims surrounding whitespace', () => {
    expect(parseUserNumber('  42 ')).toBe('42');
  });

  it('returns null for blank text', () => {
    expect(parseUserNumber('')).toBeNull();
    expect(parseUserNumber('   ')).toBeNull();
  });

  it('returns null for a lone separator', () => {
    expect(parseUserNumber('.')).toBeNull();
    expect(parseUserNumber(',')).toBeNull();
  });

  it('rejects a second separator rather than guessing', () => {
    expect(parseUserNumber('1.2.3')).toBeNull();
    expect(parseUserNumber('1,2,3')).toBeNull();
    expect(parseUserNumber('1,2.3')).toBeNull();
    expect(parseUserNumber('1.2,3')).toBeNull();
    expect(parseUserNumber('..')).toBeNull();
  });

  it('rejects signs, exponents and anything else', () => {
    for (const text of ['-1', '+1', '1e3', '1E3', 'Infinity', 'NaN', '0x10', 'abc', '12g', '1 000', '½']) {
      expect(parseUserNumber(text)).toBeNull();
    }
  });

  it('agrees with the canonical form of any non-negative decimal', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.constantFrom('.', ','), (whole, frac, sep) => {
        const parsed = parseUserNumber(`${whole}${sep}${frac}`);
        expect(parsed).not.toBeNull();
        expect(parseUserNumber(parsed as string)).toBe(parsed);
      }),
    );
  });

  it('never throws, whatever is typed', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const parsed = parseUserNumber(text);
        if (parsed !== null) expect(parsed).toMatch(/^\d+(\.\d+)?$/);
      }),
    );
  });
});

describe('normalizeNumberDraft', () => {
  it('keeps partial numbers so they can be finished', () => {
    expect(normalizeNumberDraft('')).toBe('');
    expect(normalizeNumberDraft('.')).toBe('.');
    expect(normalizeNumberDraft('1.')).toBe('1.');
    expect(normalizeNumberDraft('.5')).toBe('.5');
    expect(normalizeNumberDraft('125')).toBe('125');
  });

  it('turns a comma into a dot instead of dropping it', () => {
    expect(normalizeNumberDraft('12,5')).toBe('12.5');
    expect(normalizeNumberDraft('1,')).toBe('1.');
  });

  it('trims what a paste brings along', () => {
    expect(normalizeNumberDraft(' 12 ')).toBe('12');
  });

  it('refuses text that cannot become a number', () => {
    for (const text of ['1.2.3', '1,2,3', '1,2.3', '-1', '1e3', 'abc', '12g']) {
      expect(normalizeNumberDraft(text)).toBeNull();
    }
  });
});
