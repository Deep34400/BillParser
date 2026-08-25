import { it, expect } from 'vitest';
import { costFmt, usdToInrRate, setUsdToInr } from '../../src/lib/format.js';

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
  expect(out).toBe(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(0.04 * usdToInrRate()));
});

it('uses the configured rate once settings load', () => {
  setUsdToInr(90);
  expect(usdToInrRate()).toBe(90);
  expect(costFmt(1)).toBe(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(90));
});

it('ignores a missing or nonsensical rate rather than zeroing every figure', () => {
  setUsdToInr(96);
  for (const bad of [undefined, null, 0, -5, NaN]) setUsdToInr(bad as number);
  expect(usdToInrRate()).toBe(96);
});
