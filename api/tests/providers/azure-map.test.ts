import { describe, it, expect } from 'vitest';
import { mapAzure } from '../../src/providers/azure.js';
it('maps Azure prebuilt-invoice fields to canonical', () => {
  const doc = { fields: {
    VendorName: { content: 'Globex', confidence: 0.95 },
    InvoiceId: { content: 'INV-9', confidence: 0.9 },
    InvoiceTotal: { valueCurrency: { amount: 100, currencyCode: 'USD' }, confidence: 0.8 },
    Items: { valueArray: [ { valueObject: {
      Description: { content: 'Item A' }, Quantity: { valueNumber: 2 },
      UnitPrice: { valueCurrency: { amount: 10 } }, Amount: { valueCurrency: { amount: 20 } } } } ] },
  } };
  const r = mapAzure({ documents: [doc] });
  expect(r.vendorName).toBe('Globex');
  expect(r.totalAmount).toBe(100); expect(r.currency).toBe('USD');
  expect(r.lineItems[0]).toMatchObject({ lineNumber: 1, description: 'Item A', quantity: 2, amount: 20 });
  expect(r.confidence).toBeGreaterThan(0);
});
