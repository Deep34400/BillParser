import type { ParsedInvoiceData, PartsLineItem, LabourServiceLineItem } from '../parsing/types.js';
import { resolveBillSummary, columnNet } from './billSummary.js';

export { extractSummaryFromMarkdown, applyFooterFromMarkdown, stripCalculatedFooterAmounts, extractGatePassAmount, footerMissingInMarkdown, clearUntrustedZeroDiscounts, isCalculatedGstAmount, footerColumnAmounts } from './footerExtract.js';
export { resolveBillSummary, columnNet } from './billSummary.js';

/** Round to 2 decimal places — invoice money fields. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Tolerance for qty × rate vs printed taxable (₹0.05 or 2%). */
export function taxableTolerance(expected: number): number {
  return Math.max(0.05, Math.abs(expected) * 0.02);
}

/** True when qty × rate disagrees with printed taxable beyond tolerance. */
export function partsTaxableMismatch(li: PartsLineItem): boolean {
  const qty = li.quantity;
  const rate = li.rate;
  const taxable = li.taxable_amount;
  if (qty == null || rate == null || taxable == null) return false;
  const expected = roundMoney(qty * rate);
  return Math.abs(taxable - expected) > taxableTolerance(expected);
}

/** Normalize one parts row: fill taxable from qty×rate when missing; snap when close. */
export function normalizePartsLineItem(li: PartsLineItem): PartsLineItem {
  const qty = li.quantity;
  const rate = li.rate;
  let taxable = li.taxable_amount;
  if (qty != null && rate != null) {
    const expected = roundMoney(qty * rate);
    if (taxable == null) return { ...li, taxable_amount: expected };
    if (Math.abs(taxable - expected) <= taxableTolerance(expected)) {
      return { ...li, taxable_amount: expected };
    }
  }
  return { ...li, taxable_amount: taxable ?? undefined };
}

/** Labour rows use labour_charges directly — never derive from qty/rate. */
export function normalizeLabourLineItem(li: LabourServiceLineItem): LabourServiceLineItem {
  return { ...li, labour_charges: li.labour_charges ?? undefined };
}

/** When footer has gross parts_total, show qty×rate on lines (discount is footer-only). */
function alignPartsTaxableToGross(parts: PartsLineItem[], partsTotal?: number | null): PartsLineItem[] {
  if (partsTotal == null || partsTotal <= 0 || !parts.length) return parts;
  const grossSum = roundMoney(parts.reduce((a, p) => {
    if (p.quantity != null && p.rate != null) return a + roundMoney(p.quantity * p.rate);
    return a + (p.taxable_amount ?? 0);
  }, 0));
  if (Math.abs(grossSum - partsTotal) > 2) return parts;
  return parts.map((p) => {
    if (p.quantity != null && p.rate != null) {
      return { ...p, taxable_amount: roundMoney(p.quantity * p.rate) };
    }
    return p;
  });
}

/** When footer has gross labour_total, show gross on line (discount is footer-only). */
function alignLabourChargesToGross(
  items: LabourServiceLineItem[],
  labourTotal?: number | null,
  labourDiscount?: number | null,
): LabourServiceLineItem[] {
  if (labourTotal == null || labourTotal <= 0 || items.length !== 1) return items;
  const li = items[0];
  const charges = li.labour_charges;
  if (charges == null) return [{ ...li, labour_charges: labourTotal }];
  const disc = labourDiscount ?? 0;
  if (Math.abs(charges + disc - labourTotal) < 2) {
    return [{ ...li, labour_charges: labourTotal }];
  }
  return items;
}

/**
 * Post-parse cleanup: fix parts taxable from qty×rate, resolve bill summary via single pipeline.
 */
export function enrichParsedInvoice(data: ParsedInvoiceData, markdown?: string): ParsedInvoiceData {
  const labourRaw = (data.labour_service_line_items ?? []).map(normalizeLabourLineItem);
  const summary = resolveBillSummary(data, markdown);
  const parts = alignPartsTaxableToGross(
    (data.parts_line_items ?? []).map(normalizePartsLineItem),
    summary.parts_total,
  );
  const labour = alignLabourChargesToGross(labourRaw, summary.labour_total, summary.labour_discount);
  const enriched = { ...data, parts_line_items: parts, labour_service_line_items: labour };
  return {
    ...enriched,
    totals_and_tax_summary: resolveBillSummary(enriched, markdown),
  };
}
