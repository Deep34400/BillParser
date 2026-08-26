import { describe, it, expect } from 'vitest';
import { hasUnlimitedBalance, formatBalance, balanceNumber } from '../src/lib/balance.js';
import { setUsdToInr, usdToInrRate } from '../src/lib/format.js';

describe('balance helpers', () => {
  it('treats admin as unlimited even when balance is null', () => {
    expect(hasUnlimitedBalance('admin', null)).toBe(true);
    expect(formatBalance('admin', null)).toBe('∞');
    expect(balanceNumber('admin', null)).toBe(Infinity);
  });

  it('formats regular user balance in INR at the configured rate', () => {
    // Was pinned to '₹83.00'. The rate is no longer a hardcoded constant — it
    // comes from Settings — so assert against the rate in force, not a literal.
    expect(formatBalance('user', 1)).toBe(`₹${usdToInrRate().toFixed(2)}`);
    expect(formatBalance('user', null)).toBe('₹0.00');
  });

  it('tracks a rate change rather than caching the value at import time', () => {
    setUsdToInr(90);
    expect(formatBalance('user', 2)).toBe('₹180.00');
    setUsdToInr(96);
    expect(formatBalance('user', 2)).toBe('₹192.00');
  });
});
