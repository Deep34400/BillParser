import { describe, it, expect } from 'vitest';
import { deriveConfidence, estimateCost } from '../../src/extraction/confidence.js';
it('uses explicit confidence when present', () => {
  expect(deriveConfidence({ confidence: 0.42, lineItems: [] } as any)).toBeCloseTo(0.42);
});
it('derives from completeness when no explicit confidence', () => {
  const c = deriveConfidence({ vendorName: 'A', invoiceNumber: 'B', totalAmount: 1, invoiceDate: '2026-01-01', lineItems: [{ lineNumber: 1 }] } as any);
  expect(c).toBeGreaterThan(0.5); expect(c).toBeLessThanOrEqual(1);
});
it('estimates cost from page count and rate', () => {
  expect(estimateCost('azure', 3)).toBeCloseTo(3 * 10 / 1000);
  expect(estimateCost('unknown', 3)).toBeUndefined();
});
