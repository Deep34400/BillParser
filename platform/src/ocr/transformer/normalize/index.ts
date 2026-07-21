/**
 * Post-parse enrichment pipeline — the single entry point for normalizing
 * ParsedInvoiceData after LLM parsing.
 *
 * Pipeline: vendor → date → vehicle → company name → invoice number → PAN →
 *           labour filter → bill summary → parts alignment → labour alignment
 */
import type { ParsedInvoiceData, PartsLineItem, LabourServiceLineItem } from '../../types/invoice.js';
import { resolveBillSummary, columnNet } from './totals.js';
import { resolveVendorFromMarkdown, isJunkVendorName, isLlmJsonBlob } from './vendor.js';
import { normalizeInvoiceDateFields } from './date.js';
import { normalizeVehicleDetails } from './vehicle.js';

// Re-exports for backward compatibility (used by validate.ts, tests, etc.)
export { resolveBillSummary, columnNet } from './totals.js';
export { fillMissingGstAmounts } from './totals.js';
export { resolveVendorFromMarkdown, isJunkVendorName, isLlmJsonBlob, looksLikeTableHeader } from './vendor.js';
export { normalizeVehicleDetails, normalizeRegistrationNumber, extractRegistrationFromMarkdown } from './vehicle.js';
export { normalizeInvoiceDateFields, extractInvoiceDateFromMarkdown } from './date.js';
export {
  extractSummaryFromMarkdown, applyFooterFromMarkdown, stripCalculatedFooterAmounts,
  extractGatePassAmount, footerMissingInMarkdown, clearUntrustedZeroDiscounts,
  isCalculatedGstAmount, footerColumnAmounts, extractCashMemoTotal,
} from './footer.js';

// ── Labour line item filtering ──────────────────────────────────

const LABOUR_SECTION_HEADER_RE =
  /\b(oil|parts|labour|labor|service|misc|other|sub[\s-]?total)\s+charges?\b/i;

export function isLabourSectionHeader(desc: string | null | undefined): boolean {
  const t = desc?.trim();
  if (!t) return false;
  return LABOUR_SECTION_HEADER_RE.test(t) || /^charges$/i.test(t);
}

function hasLabourIdentifiers(li: LabourServiceLineItem): boolean {
  return Boolean(li.labour_code?.trim()) || Boolean(li.hsn_sac_code?.trim());
}

export function filterLabourLineItems(items: LabourServiceLineItem[]): LabourServiceLineItem[] {
  return items.filter((li) => {
    const desc = li.labour_description?.trim() ?? '';
    if (isLabourSectionHeader(desc)) return false;
    const charges = li.labour_charges ?? 0;
    if (charges !== 0) return true;
    if (hasLabourIdentifiers(li)) return true;
    return desc.length > 0 && !isLabourSectionHeader(desc);
  });
}

// ── Core normalize helpers ──────────────────────────────────────

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function taxableTolerance(expected: number): number {
  return Math.max(0.05, Math.abs(expected) * 0.02);
}

export function partsTaxableMismatch(li: PartsLineItem): boolean {
  const qty = li.quantity;
  const rate = li.rate;
  const taxable = li.taxable_amount;
  if (qty == null || rate == null || taxable == null) return false;
  const expected = roundMoney(qty * rate);
  return Math.abs(taxable - expected) > taxableTolerance(expected);
}

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

export function normalizeLabourLineItem(li: LabourServiceLineItem): LabourServiceLineItem {
  return { ...li, labour_charges: li.labour_charges ?? undefined };
}

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

function cleanCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (isJunkVendorName(name)) return null;
  let s = name
    .replace(/\r?\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*(IGST|CGST|SGST|GST|@\s*\d+%?|Dealer|Authorised|Signatory)\s*$/i, '')
    .trim();
  if (s.length < 2) return null;
  if (isJunkVendorName(s)) return null;
  return s;
}

function fallbackInvoiceNumber(current: string | null | undefined, markdown?: string): string | null {
  if (current) return current;
  if (!markdown) return null;
  const patterns = [
    /Tax\s+Invoice\s+No\.?\s*[\/\-]?\s*(?:Sales\s+Invoice)?\s*([A-Z0-9][A-Z0-9\-\/()]+)/i,
    /Invoice\s+No\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/()]+)/i,
    /Job\s*Card\s*No\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /Proforma\s*(?:Invoice)?\s*No\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
    /Bill\s*No\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)/i,
  ];
  for (const re of patterns) {
    const m = markdown.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function fillPanFromGstin(pan: string | null | undefined, gstin: string | null | undefined): string | null {
  if (pan?.trim()) return pan.trim().toUpperCase();
  const g = gstin?.replace(/\s/g, '').toUpperCase() ?? '';
  if (g.length !== 15) return pan ?? null;
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(g)) return pan ?? null;
  return g.slice(2, 12);
}

// ── Main enrichment entry point ─────────────────────────────────

export function enrichParsedInvoice(data: ParsedInvoiceData, markdown?: string): ParsedInvoiceData {
  const ocrMarkdown = markdown && !isLlmJsonBlob(markdown) ? markdown : undefined;

  const vendorResolved = resolveVendorFromMarkdown(data, ocrMarkdown);
  const dates = normalizeInvoiceDateFields(vendorResolved, ocrMarkdown);
  const vehicle = normalizeVehicleDetails(vendorResolved.vehicle_details, ocrMarkdown);
  const withDates = {
    ...vendorResolved,
    ...dates,
    vehicle_details: vehicle,
    company_name: cleanCompanyName(vendorResolved.company_name),
    invoice_number: fallbackInvoiceNumber(vendorResolved.invoice_number, ocrMarkdown),
    pan: fillPanFromGstin(vendorResolved.pan, vendorResolved.gstin),
  };
  const labourRaw = filterLabourLineItems(
    (withDates.labour_service_line_items ?? []).map(normalizeLabourLineItem),
  );
  const summary = resolveBillSummary(withDates, ocrMarkdown);
  const parts = alignPartsTaxableToGross(
    (withDates.parts_line_items ?? []).map(normalizePartsLineItem),
    summary.parts_total,
  );
  const labour = alignLabourChargesToGross(labourRaw, summary.labour_total, summary.labour_discount);
  const enriched = { ...withDates, parts_line_items: parts, labour_service_line_items: labour };
  return {
    ...enriched,
    totals_and_tax_summary: resolveBillSummary(enriched, ocrMarkdown),
  };
}
