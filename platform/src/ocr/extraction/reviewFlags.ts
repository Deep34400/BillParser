import type { ParsedInvoiceData } from '../parsing/types.js';
import { looksLikeTableHeader } from './vendorExtract.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumLineItems(parsed: ParsedInvoiceData): number {
  const parts = (parsed.parts_line_items ?? []).reduce((a, p) => a + (p.taxable_amount ?? 0), 0);
  const labour = (parsed.labour_service_line_items ?? []).reduce((a, l) => a + (l.labour_charges ?? 0), 0);
  return roundMoney(parts + labour);
}

const GSTIN_RE = /^\d{2}[A-Z0-9]{13}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/**
 * Human-review reasons for a parsed bill. These surface as a UI warning banner so an
 * operator can reconcile fields the OCR could not confirm — especially handwritten /
 * informal bills that carry no GSTIN or PAN.
 *
 * These are advisory only: they never mutate parsed_data or block storage.
 */
export function computeReviewReasons(parsed: ParsedInvoiceData): string[] {
  const reasons: string[] = [];

  const gstin = parsed.gstin?.replace(/\s/g, '') ?? '';
  const pan = parsed.pan?.replace(/\s/g, '') ?? '';
  const name = parsed.company_name?.trim() ?? '';

  const hasGstin = !!gstin;
  const hasPan = !!pan;

  // Only warn about tax identifiers when BOTH are missing (handwritten/informal bill).
  // If either a GSTIN or a PAN is present, that is sufficient — no missing-id warning.
  if (!hasGstin && !hasPan) {
    reasons.push('No GSTIN or PAN detected — likely a handwritten/informal bill. Verify vendor details manually.');
  } else {
    // A present identifier that is clearly malformed still deserves a flag.
    if (hasGstin && !GSTIN_RE.test(gstin.toUpperCase())) reasons.push('GSTIN format looks invalid — verify.');
    if (hasPan && !PAN_RE.test(pan.toUpperCase())) reasons.push('PAN format looks invalid — verify.');
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
    // Informal/no-tax cash memos: OCR line-sum often exceeds printed TOTAL (duplicate rows).
    if (totalTax === 0 && lineSum > grand + 1) {
      reasons.push(
        `Line items sum to ₹${lineSum.toLocaleString('en-IN')} but printed total is ₹${grand.toLocaleString('en-IN')} — verify amounts.`,
      );
    }
  }

  return reasons;
}
