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
it('maps the GST breakdown and per-line HSN/SAC', () => {
  const json = JSON.stringify({
    vendorName: 'SAI', subtotal: '2,666.00', discountAmount: '266.60',
    cgstAmount: '215.95', sgstAmount: '215.95', igstAmount: null,
    taxAmount: '431.90', totalAmount: '2,831.30', netAmount: '3,997.00',
    lineItems: [{ description: 'Gasket', sku: '0916', hsnSac: '8409', quantity: '1', amount: '9.32' }],
  });
  const r = normalizeStructured(json);
  expect(r.subtotal).toBe(2666);
  expect(r.discountAmount).toBe(266.6);
  expect(r.cgstAmount).toBe(215.95);
  expect(r.sgstAmount).toBe(215.95);
  expect(r.igstAmount).toBeUndefined();
  expect(r.totalAmount).toBe(2831.3);
  expect(r.netAmount).toBe(3997);
  expect(r.lineItems[0].hsnSac).toBe('8409');
});
it('strips code fences and tolerates surrounding prose', () => {
  const r = normalizeStructured('Here:\n```json\n{"vendorName":"X","lineItems":[]}\n```');
  expect(r.vendorName).toBe('X'); expect(r.lineItems).toEqual([]);
});
it('throws with the raw output when the model returns malformed JSON', () => {
  expect(() => normalizeStructured('{ this is not valid json'))
    .toThrow(/Failed to parse structured JSON/);
});
