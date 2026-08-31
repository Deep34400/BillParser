/**
 * Re-run review/reconciliation for bills in a created_at date range.
 * mode=check → preview only; mode=update → persist review fields + status.
 */
import type { BillDoc, BillStatus } from '../../shared/types.js';
import { computeReview } from '../transformer/review.js';
import { listBillsByCreatedAtRange, updateBill } from '../repository.js';
import { cacheInvalidate } from '../../shared/cache.js';

export type ReconcileRangeMode = 'check' | 'update';

export interface ReconcileRangeOpts {
  startDate: string;
  endDate: string;
  mode?: ReconcileRangeMode;
  /** When true, also re-check VERIFIED bills (may set NEED_REVIEW). Default false. */
  includeVerified?: boolean;
  maxBills?: number;
}

export interface ReconcileRangeRow {
  bill_id: string;
  invoice_number: string | null;
  created_at: string;
  previous_status: BillStatus;
  next_status: BillStatus;
  would_change: boolean;
  review_codes: string[];
  review_reasons: string[];
  total_reconciliation: ReturnType<typeof computeReview>['total_reconciliation'];
  updated: boolean;
}

export interface ReconcileRangeResult {
  start_date: string;
  end_date: string;
  mode: ReconcileRangeMode;
  scanned: number;
  eligible: number;
  would_update: number;
  updated: number;
  marked_need_review: number;
  cleared_to_completed: number;
  skipped: number;
  results: ReconcileRangeRow[];
  errors: { bill_id: string; message: string }[];
}

const DEFAULT_MAX = 5_000;
const SKIP_STATUSES: BillStatus[] = ['DRAFT', 'UPLOADED', 'PROCESSING', 'FAILED'];

/** Parse YYYY-MM-DD (or ISO) into inclusive UTC bounds. */
export function parseCreatedAtRange(startDate: string, endDate: string): { startIso: string; endIso: string } {
  const start = startDate.trim();
  const end = endDate.trim();
  if (!start || !end) throw new Error('start_date and end_date are required');

  const startIso = start.includes('T') ? new Date(start).toISOString() : `${start}T00:00:00.000Z`;
  const endIso = end.includes('T') ? new Date(end).toISOString() : `${end}T23:59:59.999Z`;

  if (Number.isNaN(Date.parse(startIso)) || Number.isNaN(Date.parse(endIso))) {
    throw new Error('Invalid start_date or end_date');
  }
  if (startIso > endIso) throw new Error('start_date must be <= end_date');
  return { startIso, endIso };
}

function nextStatus(bill: BillDoc, hasCodes: boolean, includeVerified: boolean): BillStatus {
  if (SKIP_STATUSES.includes(bill.ocr_status)) return bill.ocr_status;
  if (bill.ocr_status === 'VERIFIED' && !includeVerified) return 'VERIFIED';
  if (hasCodes) return 'NEED_REVIEW';
  if (bill.ocr_status === 'VERIFIED') return 'VERIFIED';
  return 'OCR_COMPLETED';
}

function isEligible(bill: BillDoc, includeVerified: boolean): boolean {
  if (SKIP_STATUSES.includes(bill.ocr_status)) return false;
  if (bill.ocr_status === 'VERIFIED' && !includeVerified) return false;
  if (!bill.parsed_data || typeof bill.parsed_data !== 'object') return false;
  return true;
}

export async function reconcileBillsInCreatedAtRange(opts: ReconcileRangeOpts): Promise<ReconcileRangeResult> {
  const mode: ReconcileRangeMode = opts.mode === 'update' ? 'update' : 'check';
  const includeVerified = opts.includeVerified === true;
  const maxBills = Math.min(Math.max(opts.maxBills ?? DEFAULT_MAX, 1), DEFAULT_MAX);
  const { startIso, endIso } = parseCreatedAtRange(opts.startDate, opts.endDate);

  const bills = await listBillsByCreatedAtRange(startIso, endIso, maxBills);

  const results: ReconcileRangeRow[] = [];
  const errors: { bill_id: string; message: string }[] = [];
  let skipped = 0;
  let updated = 0;
  let wouldUpdate = 0;
  let markedNeedReview = 0;
  let clearedToCompleted = 0;

  for (const bill of bills) {
    if (!isEligible(bill, includeVerified)) {
      skipped += 1;
      continue;
    }

    try {
      const review = computeReview(bill.parsed_data!);
      const codes = review.codes;
      const reasons = review.reasons;
      const hasCodes = codes.length > 0;
      const next = nextStatus(bill, hasCodes, includeVerified);
      const wouldChange =
        next !== bill.ocr_status
        || JSON.stringify(bill.review_codes ?? []) !== JSON.stringify(codes)
        || JSON.stringify(bill.review_reasons ?? []) !== JSON.stringify(reasons);

      if (wouldChange) wouldUpdate += 1;
      if (next === 'NEED_REVIEW' && bill.ocr_status !== 'NEED_REVIEW') markedNeedReview += 1;
      if (next === 'OCR_COMPLETED' && bill.ocr_status === 'NEED_REVIEW') clearedToCompleted += 1;

      let didUpdate = false;
      if (mode === 'update') {
        // Always refresh reconciliation snapshot; status/codes only when changed
        await updateBill(bill.bill_id, {
          ocr_status: next,
          review_codes: codes.length ? codes : null,
          review_reasons: reasons.length ? reasons : null,
          total_reconciliation: review.total_reconciliation,
        });
        didUpdate = true;
        updated += 1;
      }

      results.push({
        bill_id: bill.bill_id,
        invoice_number: bill.invoice_number ?? null,
        created_at: bill.created_at,
        previous_status: bill.ocr_status,
        next_status: next,
        would_change: wouldChange,
        review_codes: codes,
        review_reasons: reasons,
        total_reconciliation: review.total_reconciliation,
        updated: didUpdate,
      });
    } catch (err) {
      errors.push({
        bill_id: bill.bill_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (mode === 'update' && updated > 0) {
    cacheInvalidate('analytics');
  }

  return {
    start_date: startIso,
    end_date: endIso,
    mode,
    scanned: bills.length,
    eligible: results.length,
    would_update: wouldUpdate,
    updated,
    marked_need_review: markedNeedReview,
    cleared_to_completed: clearedToCompleted,
    skipped,
    results,
    errors,
  };
}
