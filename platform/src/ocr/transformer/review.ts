/**
 * Human-review flag generation — advisory warnings for the UI / NEED_REVIEW status.
 * These never mutate parsed_data or block storage.
 *
 * Active rules → stable review_codes for filtering:
 *   MISSING_TAX_ID       — no GSTIN and no PAN
 *   TOTAL_MISMATCH       — line-recomputed total vs grand_total_invoice (> ₹2)
 *   PARTS_BASE_MISMATCH  — Σ parts (qty×rate) vs parts_total (> ₹2)
 *   LABOUR_BASE_MISMATCH — Σ labour_charges vs labour_total (> ₹2)
 */
import type { ParsedInvoiceData } from '../types/invoice.js';
import { reconcileInvoiceTotal, sumPartsBase, type TotalReconciliation } from './reconcileTotal.js';
import type { ReviewReasonCode } from './reviewCodes.js';

const TOLERANCE = 2;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function labourBase(parsed: ParsedInvoiceData): number {
  return roundMoney(
    (parsed.labour_service_line_items ?? []).reduce((sum, l) => sum + (l.labour_charges ?? 0), 0),
  );
}

export interface ReviewResult {
  reasons: string[];
  codes: ReviewReasonCode[];
  total_reconciliation: TotalReconciliation | null;
}

export function computeReview(parsed: ParsedInvoiceData): ReviewResult {
  const reasons: string[] = [];
  const codes: ReviewReasonCode[] = [];

  const gstin = parsed.gstin?.replace(/\s/g, '') ?? '';
  const pan = parsed.pan?.replace(/\s/g, '') ?? '';

  if (!gstin && !pan) {
    codes.push('MISSING_TAX_ID');
    reasons.push('No GSTIN or PAN detected — likely a handwritten/informal bill. Verify vendor details manually.');
  }

  const t = parsed.totals_and_tax_summary;
  const pBase = sumPartsBase(parsed.parts_line_items ?? []);
  const lBase = labourBase(parsed);

  if (t?.parts_total != null && (parsed.parts_line_items?.length ?? 0) > 0) {
    const diff = roundMoney(Math.abs(pBase - t.parts_total));
    if (diff > TOLERANCE) {
      codes.push('PARTS_BASE_MISMATCH');
      reasons.push(
        `Parts base ₹${pBase.toLocaleString('en-IN')} ≠ parts_total ₹${t.parts_total.toLocaleString('en-IN')} (diff ₹${diff.toLocaleString('en-IN')}).`,
      );
    }
  }

  if (t?.labour_total != null && (parsed.labour_service_line_items?.length ?? 0) > 0) {
    const diff = roundMoney(Math.abs(lBase - t.labour_total));
    if (diff > TOLERANCE) {
      codes.push('LABOUR_BASE_MISMATCH');
      reasons.push(
        `Labour base ₹${lBase.toLocaleString('en-IN')} ≠ labour_total ₹${t.labour_total.toLocaleString('en-IN')} (diff ₹${diff.toLocaleString('en-IN')}).`,
      );
    }
  }

  const recon = reconcileInvoiceTotal(parsed);
  if (!recon.matched && recon.reason) {
    codes.push('TOTAL_MISMATCH');
    reasons.push(recon.reason);
  }

  return { reasons, codes, total_reconciliation: recon };
}

/** @deprecated Use computeReview() for new code — kept for backward-compatible call sites. */
export function computeReviewReasons(parsed: ParsedInvoiceData): string[] {
  return computeReview(parsed).reasons;
}
