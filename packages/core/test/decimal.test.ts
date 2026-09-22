import { describe, expect, it } from 'vitest';
import { NumericError, ZERO, add, compare, dec, div, isPositive, mul, num, sum, tryDec } from '../src/decimal';

describe('decimal', () => {
  it('parses strings, numbers and Decimals', () => {
    expect(num('1.5')).toBe('1.5');
    expect(num(2)).toBe('2');
    expect(num(dec('3.25'))).toBe('3.25');
    expect(ZERO).toBe('0');
  });

  it('rejects non-finite input', () => {
    expect(() => dec(Number.NaN)).toThrow(NumericError);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(NumericError);
    expect(tryDec('banana')).toBeNull();
    expect(tryDec('4')?.toFixed()).toBe('4');
  });

  it('never emits scientific notation', () => {
    expect(num('0.000000000000000001')).toBe('0.000000000000000001');
    expect(num('100000000000000000000000')).toBe('100000000000000000000000');
  });

  it('adds exactly where floats do not', () => {
    expect(num(add('0.1', '0.2'))).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('multiplies, divides and sums', () => {
    expect(num(mul('2.5', '4'))).toBe('10');
    expect(num(div('10', '4'))).toBe('2.5');
    expect(num(sum(['1', '2', '3.5']))).toBe('6.5');
    expect(num(sum([]))).toBe('0');
  });

  it('refuses division by zero', () => {
    expect(() => div('1', '0')).toThrow(NumericError);
  });

  it('compares', () => {
    expect(isPositive('0.0001')).toBe(true);
    expect(isPositive('0')).toBe(false);
    expect(compare('1', '2')).toBe(-1);
    expect(compare('2', '2')).toBe(0);
    expect(compare('3', '2')).toBe(1);
  });
});
