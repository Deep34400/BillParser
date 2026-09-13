/** Tolerance (in currency units) for total reconciliation checks. */
export const RECONCILIATION_TOLERANCE = 2;

/** Tolerance (in currency units) for GST line-item validation. */
export const GST_TOLERANCE = 1;

/** Valid full GST rates under Indian tax law. */
export const FULL_GST_RATES = new Set([0, 3, 5, 12, 18, 28]);

/** Valid half GST rates (CGST/SGST split). */
export const HALF_GST_RATES = new Set([0, 1.5, 2.5, 6, 9, 14]);

export function isValidFullGstRate(rate: number): boolean {
  return FULL_GST_RATES.has(rate);
}

export function isValidHalfGstRate(rate: number): boolean {
  return HALF_GST_RATES.has(rate);
}

/** Default timeout for LLM provider calls (Claude, OpenAI, Mistral, Gemini). */
export const LLM_TIMEOUT_MS = 120_000;

/** Timeout for AzAPI provider calls. */
export const AZAPI_TIMEOUT_MS = 180_000;

/** Timeout for odometer OCR calls. */
export const ODOMETER_TIMEOUT_MS = 60_000;
