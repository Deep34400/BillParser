import { describe, it, expect } from 'vitest';
import { normalizeStructured } from '../../src/structuring/index.js';
it('coerces a model JSON string into a canonical result', () => {
  const json = JSON.stringify({
    vendorName: 'Acme', invoiceDate: '2026-01-02', totalAmount: '1,234.50', confidence: 0.9,
    lineItems: [{ description: 'Widget', quantity: '2', unitPrice: '10', amount: '20' }],
  });
  const r = normalizeStructured(json);
  expect(r.vendorName).toBe('Acme');
  expect(r.totalAmount).toBe(1234.5);
  expect(r.lineItems[0]).toMatchObject({ lineNumber: 1, description: 'Widget', quantity: 2, amount: 20 });
  expect(r.confidence).toBe(0.9);
});
it('strips code fences and tolerates surrounding prose', () => {
  const r = normalizeStructured('Here:\n```json\n{"vendorName":"X","lineItems":[]}\n```');
  expect(r.vendorName).toBe('X'); expect(r.lineItems).toEqual([]);
});
it('throws with the raw output when the model returns malformed JSON', () => {
  expect(() => normalizeStructured('{ this is not valid json'))
    .toThrow(/Failed to parse structured JSON/);
});
