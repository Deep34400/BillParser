import { describe, it, expect } from 'vitest';
import { roundMoney, toNum } from '../../src/shared/numbers.js';

describe('roundMoney', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundMoney(1.006)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(99.999)).toBe(100);
  });

  it('handles whole numbers', () => {
    expect(roundMoney(100)).toBe(100);
    expect(roundMoney(0)).toBe(0);
  });

  it('handles negative values', () => {
    expect(roundMoney(-1.006)).toBe(-1.01);
    expect(roundMoney(-0.001)).toBe(-0);
  });

  it('preserves existing 2-decimal values', () => {
    expect(roundMoney(10.25)).toBe(10.25);
    expect(roundMoney(0.01)).toBe(0.01);
  });
});

describe('toNum', () => {
  it('returns number for valid numeric input', () => {
    expect(toNum(42)).toBe(42);
    expect(toNum('3.14')).toBe(3.14);
  });

  it('returns null for non-numeric input', () => {
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum('')).toBeNull();
    expect(toNum(NaN)).toBeNull();
    expect(toNum(Infinity)).toBeNull();
  });
});
