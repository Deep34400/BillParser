/**
 * Global constants — single source of truth for enums, limits, and magic values.
 * Import from here instead of hardcoding strings in multiple places.
 */

// ─── Bill types ─────────────────────────────────────────────────────────────
export const BILL_TYPES = [
  'MAINTENANCE', 'FUEL', 'INSURANCE', 'TYRE', 'TOLL',
  'ACCIDENT_REPAIR', 'BATTERY_REPLACEMENT', 'AMC_CONTRACT', 'OTHER',
] as const;
export type BillType = typeof BILL_TYPES[number];

// ─── OCR statuses ───────────────────────────────────────────────────────────
export const OCR_STATUSES = [
  'DRAFT', 'UPLOADED', 'PROCESSING', 'OCR_COMPLETED', 'NEED_REVIEW', 'VERIFIED', 'FAILED',
] as const;
export type OcrStatus = typeof OCR_STATUSES[number];

// ─── Line item types ────────────────────────────────────────────────────────
export const LINE_TYPES = ['PART', 'LABOUR'] as const;
export type LineType = typeof LINE_TYPES[number];

// ─── User roles & statuses ──────────────────────────────────────────────────
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = typeof USER_ROLES[number];

export const USER_STATUSES = ['active', 'blocked'] as const;
export type UserStatus = typeof USER_STATUSES[number];

// ─── Token transaction types ────────────────────────────────────────────────
export const TX_TYPES = ['credit', 'debit'] as const;
export type TxType = typeof TX_TYPES[number];

// ─── Review codes ───────────────────────────────────────────────────────────
export const REVIEW_CODE_KEYS = [
  'MISSING_TAX_ID', 'TOTAL_MISMATCH', 'PARTS_BASE_MISMATCH', 'LABOUR_BASE_MISMATCH',
] as const;

// ─── Pagination defaults ────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;
export const MAX_EXPORT_LIMIT = 5_000;

// ─── Pricing defaults ───────────────────────────────────────────────────────
export const DEFAULT_USD_TO_INR = 96;
export const DEFAULT_THINKING_BUDGET = 2048;
export const DEFAULT_MISTRAL_OCR_PRICE_PER_1K = 4;

// ─── Admin seed defaults ────────────────────────────────────────────────────
export const ADMIN_SEED_BALANCE = 99_999_999;
export const ADMIN_SEED_EMAIL = 'admin@praya.io';
