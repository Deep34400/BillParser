import { describe, it, expect } from 'vitest';
import { enrichStructured } from '../../src/structuring/index.js';
import type { CanonicalResult } from '../../src/providers/types.js';

// A structured-provider (Azure) result: good headers + totals, no GST breakdown.
const azureBase = (): CanonicalResult => ({
  vendorName: 'SAI SERVICE', invoiceNumber: 'BC/25007199', currency: 'INR',
  subtotal: 1309.28, totalAmount: 1545, netAmount: 1545,
  discountAmount: undefined, cgstAmount: undefined, sgstAmount: undefined, igstAmount: undefined,
  lineItems: [{ lineNumber: 1, description: 'PART', amount: 100 }],
  confidence: 0.9, costEstimate: 0.83,
  rawText: 'CGST @ 9% 117.84 SGST @ 9% 117.84', rawJson: {},
});

// Structuring pass over the OCR text: fills the GST breakdown + HSN line items.
const structResult = async () => ({
  vendorName: 'sai service private limited', invoiceNumber: 'BC/25007199',
  subtotal: 1309.28, discountAmount: 0, cgstAmount: 117.84, sgstAmount: 117.84,
  taxAmount: 235.68, totalAmount: 1544.96, netAmount: 1545,
  lineItems: [{ lineNumber: 1, description: 'PART', hsnSac: '8409', amount: 100 }],
  confidence: 0.8, structuringCost: 0.002,
});

it('fills the GST breakdown from structuring, keeps the provider identity fields', async () => {
  const r = await enrichStructured(azureBase(), structResult);
  // GST breakdown now present (was missing on the Azure result)
  expect(r.cgstAmount).toBe(117.84);
  expect(r.sgstAmount).toBe(117.84);
  expect(r.discountAmount).toBe(0);
  // identity field kept from the structured provider (not the lowercase structuring value)
  expect(r.vendorName).toBe('SAI SERVICE');
  // line items come from structuring (carry hsnSac)
  expect(r.lineItems[0].hsnSac).toBe('8409');
  // raw + extraction cost preserved from base; structuring cost from the pass
  expect(r.rawText).toContain('CGST');
  expect(r.costEstimate).toBe(0.83);
  expect(r.structuringCost).toBe(0.002);
});

it('returns the base result unchanged when structuring fails', async () => {
  const r = await enrichStructured(azureBase(), async () => { throw new Error('no creds'); });
  expect(r.cgstAmount).toBeUndefined();
  expect(r.vendorName).toBe('SAI SERVICE');
});

it('skips enrichment when there is no OCR text', async () => {
  const base = { ...azureBase(), rawText: '' };
  let called = false;
  const r = await enrichStructured(base, async () => { called = true; return {} as any; });
  expect(called).toBe(false);
  expect(r).toEqual(base);
});
