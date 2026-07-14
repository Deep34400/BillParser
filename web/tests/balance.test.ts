import { describe, it, expect } from 'vitest';
import { hasUnlimitedBalance, formatBalance, balanceNumber } from '../src/lib/balance.js';

describe('balance helpers', () => {
  it('treats admin as unlimited even when balance is null', () => {
    expect(hasUnlimitedBalance('admin', null)).toBe(true);
    expect(formatBalance('admin', null)).toBe('∞');
    expect(balanceNumber('admin', null)).toBe(Infinity);
  });

  it('formats regular user balance in INR', () => {
    expect(formatBalance('user', 1)).toBe('₹83.00');
    expect(formatBalance('user', null)).toBe('₹0.00');
  });
});
