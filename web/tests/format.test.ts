import { describe, it, expect } from 'vitest';
import { money, dateFmt, confLabel } from '../src/format.js';
it('formats money/date/confidence', () => {
  expect(money(1234.5, 'USD')).toBe('$1,234.50');
  expect(money(null, 'USD')).toBe('—');
  expect(dateFmt('2026-01-05T00:00:00.000Z')).toBe('Jan 5, 2026');
  expect(confLabel(0.873)).toBe('87%');
});
