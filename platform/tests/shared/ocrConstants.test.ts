import { describe, it, expect } from 'vitest';
import {
  RECONCILIATION_TOLERANCE,
  GST_TOLERANCE,
  FULL_GST_RATES,
  HALF_GST_RATES,
  isValidFullGstRate,
  isValidHalfGstRate,
  LLM_TIMEOUT_MS,
  AZAPI_TIMEOUT_MS,
  ODOMETER_TIMEOUT_MS,
} from '../../src/shared/ocrConstants.js';

describe('ocrConstants', () => {
  it('exports reconciliation tolerance as 2', () => {
    expect(RECONCILIATION_TOLERANCE).toBe(2);
  });

  it('exports GST tolerance as 1', () => {
    expect(GST_TOLERANCE).toBe(1);
  });

  it('exports correct full GST rates', () => {
    expect(FULL_GST_RATES).toEqual(new Set([0, 3, 5, 12, 18, 28]));
  });

  it('exports correct half GST rates', () => {
    expect(HALF_GST_RATES).toEqual(new Set([0, 1.5, 2.5, 6, 9, 14]));
  });

  it('validates full GST rates', () => {
    expect(isValidFullGstRate(18)).toBe(true);
    expect(isValidFullGstRate(10)).toBe(false);
  });

  it('validates half GST rates', () => {
    expect(isValidHalfGstRate(9)).toBe(true);
    expect(isValidHalfGstRate(7)).toBe(false);
  });

  it('exports timeout constants', () => {
    expect(LLM_TIMEOUT_MS).toBe(120_000);
    expect(AZAPI_TIMEOUT_MS).toBe(180_000);
    expect(ODOMETER_TIMEOUT_MS).toBe(60_000);
  });
});
