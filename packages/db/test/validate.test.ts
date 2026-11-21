/** The boundary helpers on their own, without a database behind them. */
import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  integerInRange,
  isReadableNum,
  isReadablePositiveNum,
  nonNegativeNum,
  nutrientMap,
  positiveNum,
} from '../src/validate';

describe('nonNegativeNum / positiveNum', () => {
  it('accepts zero only where zero is allowed', () => {
    expect(nonNegativeNum('x', '0')).toBe('0');
    expect(() => positiveNum('x', '0')).toThrow(ValidationError);
  });

  it('rejects non-string values and blank or malformed strings', () => {
    for (const bad of [5, null, undefined, '', '  ', 'abc']) {
      expect(() => nonNegativeNum('x', bad)).toThrow('x must be a decimal string');
    }
  });

  it('names the field and the reason', () => {
    expect(() => nonNegativeNum('grams', '-1')).toThrow('grams must not be negative');
    expect(() => positiveNum('grams', '-1')).toThrow('grams must be greater than zero');
  });
});

describe('nutrientMap', () => {
  it('keeps listed nutrients and skips undefined ones', () => {
    expect(nutrientMap('n', { protein_g: '12.50', fat_g: undefined })).toEqual({ protein_g: '12.5' });
  });

  it('rejects unknown codes and names them in the field', () => {
    expect(() => nutrientMap('n', { magic_g: '1' })).toThrow('n.magic_g is not a nutrient code');
  });

  it('rejects negative, exponent and non-string values', () => {
    for (const bad of ['-1', '1e3', '', 3]) {
      expect(() => nutrientMap('n', { protein_g: bad })).toThrow('n.protein_g must be a non-negative decimal string');
    }
  });

  it('rejects a map that is not an object', () => {
    for (const bad of [null, 'x', 4]) expect(() => nutrientMap('n', bad)).toThrow('n must be a nutrient map');
  });
});

describe('integerInRange', () => {
  it('accepts both bounds and rejects fractions, strings and out-of-range values', () => {
    expect(integerInRange('w', 1, 1, 5)).toBe(1);
    expect(integerInRange('w', 5, 1, 5)).toBe(5);
    for (const bad of [0, 6, 2.5, '3', NaN]) expect(() => integerInRange('w', bad, 1, 5)).toThrow(ValidationError);
  });
});

describe('isReadableNum / isReadablePositiveNum', () => {
  it('treats zero as readable but not as a divisor', () => {
    expect(isReadableNum('0')).toBe(true);
    expect(isReadablePositiveNum('0')).toBe(false);
    expect(isReadablePositiveNum('0.1')).toBe(true);
  });

  it('rejects negatives, blanks and non-strings', () => {
    for (const bad of ['-1', '', 'x', 1, null]) {
      expect(isReadableNum(bad)).toBe(false);
      expect(isReadablePositiveNum(bad)).toBe(false);
    }
  });
});
