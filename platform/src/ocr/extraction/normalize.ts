import type { ParsedInvoiceData, PartsLineItem, LabourServiceLineItem, VehicleDetails } from '../parsing/types.js';
import { resolveBillSummary, columnNet } from './billSummary.js';
import { resolveVendorFromMarkdown, isJunkVendorName } from './vendorExtract.js';
import { normalizeInvoiceDateFields } from './dateExtract.js';

// ── Vehicle registration normalization ──────────────────────────

const INDIAN_REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$|^\d{2}BH\d{4}[A-Z]$/;

const REG_LABEL_RE =
  /\b(?:reg(?:istration)?\.?\s*(?:no|number)?|vehicle\s*(?:reg(?:istration)?)?\.?\s*(?:no|number)?|veh\.?\s*no)\.?\s*[:\-/]?\s*([A-Z0-9][A-Z0-9\s]{2,14})/gi;

export function normalizeRegistrationNumber(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return INDIAN_REG_RE.test(compact) ? compact : null;
}

function cleanRegCapture(raw: string): string {
  return raw.split(/[(,;\n|]/)[0].trim();
}

export function extractRegistrationFromMarkdown(markdown?: string | null): string | null {
  if (!markdown) return null;
  for (const m of markdown.matchAll(REG_LABEL_RE)) {
    const candidate = normalizeRegistrationNumber(cleanRegCapture(m[1]));
    if (candidate) return candidate;
  }
  for (const line of markdown.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length < 6 || t.length > 16) continue;
    const candidate = normalizeRegistrationNumber(t);
    if (candidate) return candidate;
  }
  return null;
}

export function normalizeVehicleDetails(
  vehicle: VehicleDetails | null | undefined,
  markdown?: string | null,
): VehicleDetails | null {
  const vd = vehicle ?? {};
  const fromParsed = normalizeRegistrationNumber(vd.registration_number);
  const fromMarkdown = extractRegistrationFromMarkdown(markdown);
  return {
    ...vd,
    registration_number: fromParsed ?? fromMarkdown ?? vd.registration_number ?? null,
    chassis_number: vd.chassis_number?.trim() || vd.chassis_number || null,
    mileage_odometer_reading: vd.mileage_odometer_reading ?? null,
  };
}

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

// ── Core normalize logic ────────────────────────────────────────

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

/** Strip junk from company_name: newlines, trailing GST labels, table noise. */
function cleanCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Always drop junk — even when there is no OCR markdown (Gemini single mode).
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

/** If invoice_number is missing, try Job Card No., Tax Invoice No., etc. from markdown. */
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

/** Derive seller PAN from Indian GSTIN (chars 3–12) when PAN was not printed/extracted. */
function fillPanFromGstin(pan: string | null | undefined, gstin: string | null | undefined): string | null {
  if (pan?.trim()) return pan.trim().toUpperCase();
  const g = gstin?.replace(/\s/g, '').toUpperCase() ?? '';
  if (g.length !== 15) return pan ?? null;
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(g)) return pan ?? null;
  return g.slice(2, 12);
}

/**
 * Post-parse cleanup: fix parts taxable from qty×rate, resolve bill summary via single pipeline.
 */
export function enrichParsedInvoice(data: ParsedInvoiceData, markdown?: string): ParsedInvoiceData {
  const vendorResolved = resolveVendorFromMarkdown(data, markdown);
  const dates = normalizeInvoiceDateFields(vendorResolved, markdown);
  const vehicle = normalizeVehicleDetails(vendorResolved.vehicle_details, markdown);
  const withDates = {
    ...vendorResolved,
    ...dates,
    vehicle_details: vehicle,
    company_name: cleanCompanyName(vendorResolved.company_name),
    invoice_number: fallbackInvoiceNumber(vendorResolved.invoice_number, markdown),
    pan: fillPanFromGstin(vendorResolved.pan, vendorResolved.gstin),
  };
  const labourRaw = filterLabourLineItems(
    (withDates.labour_service_line_items ?? []).map(normalizeLabourLineItem),
  );
  const summary = resolveBillSummary(withDates, markdown);
  const parts = alignPartsTaxableToGross(
    (withDates.parts_line_items ?? []).map(normalizePartsLineItem),
    summary.parts_total,
  );
  const labour = alignLabourChargesToGross(labourRaw, summary.labour_total, summary.labour_discount);
  const enriched = { ...withDates, parts_line_items: parts, labour_service_line_items: labour };
  return {
    ...enriched,
    totals_and_tax_summary: resolveBillSummary(enriched, markdown),
  };
}
