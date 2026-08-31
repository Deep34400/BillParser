/**
 * Human-review flag generation — advisory warnings for the UI / NEED_REVIEW status.
 * These never mutate parsed_data or block storage.
 *
 * CURRENT POLICY (temporary): only "No GSTIN and no PAN" triggers NEED_REVIEW.
 * Other heuristics / validation merges are commented out until re-enabled.
 */
import type { ParsedInvoiceData } from '../types/invoice.js';
import { reconcileInvoiceTotal, type TotalReconciliation } from './reconcileTotal.js';
// import { looksLikeTableHeader } from './normalize/vendor.js';
// import { validateParsedInvoice } from './validate.js';

// function roundMoney(n: number): number {
//   return Math.round(n * 100) / 100;
// }

// function sumLineItems(parsed: ParsedInvoiceData): number {
//   const parts = (parsed.parts_line_items ?? []).reduce((a, p) => a + (p.taxable_amount ?? 0), 0);
//   const labour = (parsed.labour_service_line_items ?? []).reduce((a, l) => a + (l.labour_charges ?? 0), 0);
//   return roundMoney(parts + labour);
// }

// const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

// /** GST / GSTIN / tax-rate messages — do not surface on Needs review. */
// function isGstRelatedReviewMessage(message: string): boolean {
//   return /gstin|\bcgst\b|\bsgst\b|\bigst\b|indian gst|gst amount|gst rate|gst regime|tax percentage|tax_percentage/i
//     .test(message);
// }

// function pushUnique(reasons: string[], message: string): void {
//   if (isGstRelatedReviewMessage(message)) return;
//
//   const norm = message.toLowerCase().replace(/\s+/g, ' ').trim();
//   if (reasons.some((r) => r.toLowerCase().replace(/\s+/g, ' ').trim() === norm)) return;
//
//   if (/\bpan\b/i.test(message) && /format|invalid/i.test(message)
//     && reasons.some((r) => /\bpan\b/i.test(r) && /invalid|format/i.test(r))) return;
//   if (/line item/i.test(message)
//     && reasons.some((r) => /line item/i.test(r))) return;
//   if (/company_name|company name|vendor/i.test(message)
//     && reasons.some((r) => /vendor|company/i.test(r))) return;
//   if (/grand_total|total amount not found/i.test(message)
//     && reasons.some((r) => /total amount not found|grand_total/i.test(r))) return;
//
//   reasons.push(message);
// }

export interface ReviewResult {
  reasons: string[];
  total_reconciliation: TotalReconciliation | null;
}

export function computeReview(parsed: ParsedInvoiceData): ReviewResult {
  const reasons: string[] = [];

  const gstin = parsed.gstin?.replace(/\s/g, '') ?? '';
  const pan = parsed.pan?.replace(/\s/g, '') ?? '';

  if (!gstin && !pan) {
    reasons.push('No GSTIN or PAN detected — likely a handwritten/informal bill. Verify vendor details manually.');
  }

  const recon = reconcileInvoiceTotal(parsed);
  if (!recon.matched && recon.reason) {
    reasons.push(recon.reason);
  }

  return { reasons, total_reconciliation: recon };
}

/** @deprecated Use computeReview() for new code — kept for backward-compatible call sites. */
export function computeReviewReasons(parsed: ParsedInvoiceData): string[] {
  return computeReview(parsed).reasons;
}
