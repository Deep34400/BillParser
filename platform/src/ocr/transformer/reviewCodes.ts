/**
 * Stable machine codes for NEED_REVIEW filtering (DB + API + UI chips).
 * Human messages stay in review_reasons[]; these codes are for filters/counts.
 */
export const REVIEW_REASON_CODES = [
  'MISSING_TAX_ID',
  'TOTAL_MISMATCH',
  'PARTS_BASE_MISMATCH',
  'LABOUR_BASE_MISMATCH',
] as const;

export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

export const REVIEW_REASON_LABELS: Record<ReviewReasonCode, string> = {
  MISSING_TAX_ID: 'No GSTIN / PAN',
  TOTAL_MISMATCH: 'Total mismatch',
  PARTS_BASE_MISMATCH: 'Parts base ≠ parts total',
  LABOUR_BASE_MISMATCH: 'Labour base ≠ labour total',
};
