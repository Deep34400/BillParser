import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/lib/csv.js';
it('serializes rows and escapes commas/quotes/newlines', () => {
  const csv = toCsv(['a', 'b'], [{ a: 'x', b: 'has,comma' }, { a: 'q"ote', b: 'line\nbreak' }]);
  expect(csv).toBe('a,b\r\nx,"has,comma"\r\n"q""ote","line\nbreak"');
});
it('renders null/undefined as empty', () => {
  expect(toCsv(['a'], [{ a: null }])).toBe('a\r\n');
});
