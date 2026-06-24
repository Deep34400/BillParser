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
    lineItems: [
      { description: 'Gasket', sku: '0916', hsnSac: '8409', quantity: '1', amount: '9.32' },
      { description: 'OUT SIDE LABOUR', sku: 'ZA64L0', hsnSac: '998729', labourAmount: '550' },
    ],
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
  expect(r.lineItems[0].amount).toBe(9.32);
  expect(r.lineItems[1].labourAmount).toBe(550);
  expect(r.lineItems[1].amount).toBeUndefined();
});
it('recovers an HSN/SAC code mis-mapped into taxRate', () => {
  // The OCR table puts HSN/SAC next to the Tax column; the model sometimes drops the
  // SAC code into taxRate. A tax rate > 100 is never a real GST % — treat it as the code.
  const json = JSON.stringify({ lineItems: [
    { description: 'OUT SIDE LABOUR', sku: 'ZA64L0', hsnSac: null, taxRate: 998729, amount: 550 },
    { description: 'BOLT', sku: '0155', hsnSac: null, taxRate: 18, amount: 59.3 },
    { description: 'PAINT', sku: 'ZF27P0', hsnSac: '998729', taxRate: 998729, amount: 1500 },
  ] });
  const r = normalizeStructured(json);
  // code recovered into hsnSac, bogus taxRate dropped
  expect(r.lineItems[0].hsnSac).toBe('998729');
  expect(r.lineItems[0].taxRate).toBeUndefined();
  // a legit percentage is untouched
  expect(r.lineItems[1].taxRate).toBe(18);
  // existing hsnSac is not overwritten; bogus taxRate still dropped
  expect(r.lineItems[2].hsnSac).toBe('998729');
  expect(r.lineItems[2].taxRate).toBeUndefined();
});
it('subtracts a forgotten discount from the tax-inclusive sub total', () => {
  // Model read every amount but its totalAmount = subtotal + tax (discount not subtracted).
  const json = JSON.stringify({
    subtotal: 101216.70, discountAmount: 18026.72, igstAmount: 14974.19, taxAmount: 14974.19,
    totalAmount: 116190.89, netAmount: 98164, lineItems: [],
  });
  const r = normalizeStructured(json);
  expect(r.totalAmount).toBe(98164.17);   // subtotal - discount + tax
  expect(r.netAmount).toBe(98164);        // already correct, untouched
});
it('leaves a correctly-discounted total alone', () => {
  const json = JSON.stringify({
    subtotal: 2666, discountAmount: 266.6, cgstAmount: 215.95, sgstAmount: 215.95,
    taxAmount: 431.9, totalAmount: 2831.3, netAmount: 2831, lineItems: [],
  });
  const r = normalizeStructured(json);
  expect(r.totalAmount).toBe(2831.3);     // unchanged — discount already applied
});
it('does not touch totals when there is no discount', () => {
  // Non-GST invoice with an extra charge: subtotal+tax != total, but no discount → leave as-is.
  const json = JSON.stringify({ subtotal: 100, taxAmount: 8, totalAmount: 118, lineItems: [] });
  const r = normalizeStructured(json);
  expect(r.totalAmount).toBe(118);
});
it('strips code fences and tolerates surrounding prose', () => {
  const r = normalizeStructured('Here:\n```json\n{"vendorName":"X","lineItems":[]}\n```');
  expect(r.vendorName).toBe('X'); expect(r.lineItems).toEqual([]);
});
it('throws with the raw output when the model returns malformed JSON', () => {
  expect(() => normalizeStructured('{ this is not valid json'))
    .toThrow(/Failed to parse structured JSON/);
});
