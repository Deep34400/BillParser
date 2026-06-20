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
it('strips leaked label punctuation and whitespace from extracted text fields', () => {
  const doc = { fields: {
    InvoiceId: { content: ': DW21S25102751' },
    VendorName: { content: '  MORRIS GARAGES  ' },
    PurchaseOrder: { content: '#PO-42 ;' },
    VendorTaxId: { content: 'GST   29ABCDE1234F1Z5' },
  } };
  const r = mapAzure({ documents: [doc] });
  expect(r.invoiceNumber).toBe('DW21S25102751');
  expect(r.vendorName).toBe('MORRIS GARAGES');
  expect(r.poNumber).toBe('PO-42');
  // internal separators preserved, only runs of whitespace collapsed
  expect(r.vendorTaxId).toBe('GST 29ABCDE1234F1Z5');
});
it('returns undefined for fields that are only punctuation/whitespace', () => {
  const doc = { fields: { VendorName: { content: '  :  ' }, InvoiceId: { content: '-' } } };
  const r = mapAzure({ documents: [doc] });
  expect(r.vendorName).toBeUndefined();
  expect(r.invoiceNumber).toBeUndefined();
});
it('uses Azure normalized valueDate, not the raw locale-formatted date text', () => {
  const doc = { fields: {
    InvoiceDate: { content: '29.01.2026 16:36:20', valueDate: '2026-01-29' },
    DueDate: { content: '16.02.2026', valueDate: '2026-02-16' },
  } };
  const r = mapAzure({ documents: [doc] });
  expect(r.invoiceDate).toBe('2026-01-29');
  expect(r.dueDate).toBe('2026-02-16');
});
