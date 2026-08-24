/**
 * Human-review flag generation — advisory warnings for the UI.
 * These never mutate parsed_data or block storage.
 *
 * Merges validation failures into reviewReasons for the frontend
 * "Needs review" banner. GST / GSTIN / CGST-SGST-IGST checks are
 * intentionally excluded from Needs review for now.
 */
import type { ParsedInvoiceData } from '../types/invoice.js';
import { looksLikeTableHeader } from './normalize/vendor.js';
import { validateParsedInvoice } from './validate.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumLineItems(parsed: ParsedInvoiceData): number {
  const parts = (parsed.parts_line_items ?? []).reduce((a, p) => a + (p.taxable_amount ?? 0), 0);
  const labour = (parsed.labour_service_line_items ?? []).reduce((a, l) => a + (l.labour_charges ?? 0), 0);
  return roundMoney(parts + labour);
}

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** GST / GSTIN / tax-rate messages — do not surface on Needs review. */
function isGstRelatedReviewMessage(message: string): boolean {
  return /gstin|\bcgst\b|\bsgst\b|\bigst\b|indian gst|gst amount|gst rate|gst regime|tax percentage|tax_percentage/i
    .test(message);
}

function pushUnique(reasons: string[], message: string): void {
  if (isGstRelatedReviewMessage(message)) return;

  const norm = message.toLowerCase().replace(/\s+/g, ' ').trim();
  if (reasons.some((r) => r.toLowerCase().replace(/\s+/g, ' ').trim() === norm)) return;

  // Skip near-duplicates for the same field topic already covered
  if (/\bpan\b/i.test(message) && /format|invalid/i.test(message)
    && reasons.some((r) => /\bpan\b/i.test(r) && /invalid|format/i.test(r))) return;
  if (/line item/i.test(message)
    && reasons.some((r) => /line item/i.test(r))) return;
  if (/company_name|company name|vendor/i.test(message)
    && reasons.some((r) => /vendor|company/i.test(r))) return;
  if (/grand_total|total amount not found/i.test(message)
    && reasons.some((r) => /total amount not found|grand_total/i.test(r))) return;

  reasons.push(message);
}

export function computeReviewReasons(parsed: ParsedInvoiceData): string[] {
  const reasons: string[] = [];

  const gstin = parsed.gstin?.replace(/\s/g, '') ?? '';
  const pan = parsed.pan?.replace(/\s/g, '') ?? '';
  const name = parsed.company_name?.trim() ?? '';

  // Keep handwritten/informal bill flag; other GSTIN/GST amount checks stay off Needs review.
  if (!gstin && !pan) {
    reasons.push('No GSTIN or PAN detected — likely a handwritten/informal bill. Verify vendor details manually.');
  } else if (pan && !PAN_RE.test(pan.toUpperCase())) {
    reasons.push('PAN format looks invalid — verify.');
  }

  if (!name || looksLikeTableHeader(name)) {
    reasons.push('Vendor/company name unclear — confirm the workshop name.');
  }

  const parts = parsed.parts_line_items ?? [];
  const labour = parsed.labour_service_line_items ?? [];
  if (parts.length === 0 && labour.length === 0) {
    reasons.push('No line items extracted — check the itemised charges.');
  }

  const grand = parsed.totals_and_tax_summary?.grand_total_invoice;
  if (grand == null || grand <= 0) {
    reasons.push('Total amount not found — verify the bill total.');
  } else {
    const t = parsed.totals_and_tax_summary;
    const totalTax = roundMoney(
      (t?.parts_cgst_amount ?? 0) + (t?.parts_sgst_amount ?? 0) + (t?.parts_igst_amount ?? 0) +
      (t?.labour_cgst_amount ?? 0) + (t?.labour_sgst_amount ?? 0) + (t?.labour_igst_amount ?? 0),
    );
    const lineSum = sumLineItems(parsed);
    if (totalTax === 0 && lineSum > grand + 1) {
      reasons.push(
        `Line items sum to ₹${lineSum.toLocaleString('en-IN')} but printed total is ₹${grand.toLocaleString('en-IN')} — verify amounts.`,
      );
    }
  }

  // Surface validation failures on the UI banner — except GST-related ones.
  for (const issue of validateParsedInvoice(parsed)) {
    pushUnique(reasons, issue.message);
  }

  return reasons;
}
