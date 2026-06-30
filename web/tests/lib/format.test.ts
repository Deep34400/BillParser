import { it, expect } from 'vitest';
import { costFmt, USD_TO_INR } from '../../src/lib/format.js';

it('shows Free for zero (local) cost and em dash for unknown', () => {
  expect(costFmt(0)).toBe('Free');
  expect(costFmt(null)).toBe('—');
  expect(costFmt(undefined)).toBe('—');
});

it('converts the USD cost estimate to rupees (no dollar sign)', () => {
  const out = costFmt(0.04);
  expect(out).toContain('₹');
  expect(out).not.toContain('$');
  // 0.04 USD * rate, formatted as INR
  expect(out).toBe(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(0.04 * USD_TO_INR));
});
