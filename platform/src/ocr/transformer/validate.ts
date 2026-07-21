/**
 * Structural / business-rule validation for ParsedInvoiceData.
 * Produces warning/error ValidationIssue[] — never mutates parsed data.
 */
import type {
  ParsedInvoiceData,
  PartsLineItem,
  LabourServiceLineItem,
  TotalsAndTaxSummary,
} from '../types/invoice.js';
import type { ValidationIssue } from '../types/parser.js';
import { toNum } from '../parser/parser.js';
import { partsTaxableMismatch, roundMoney, columnNet } from './normalize/index.js';

/** Full GST rates allowed on line items / IGST footer. */
const FULL_GST_RATES = new Set([0, 3, 5, 12, 18, 28]);
/** CGST/SGST half-rates (intra-state). */
const HALF_GST_RATES = new Set([0, 1.5, 2.5, 6, 9, 14]);

const INDIAN_REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$|^\d{2}BH\d{4}[A-Z]$/;
const GST_TOLERANCE = 1;

function warn(path: string, message: string): ValidationIssue {
  return { path, message, severity: 'warning' };
}

function error(path: string, message: string): ValidationIssue {
  return { path, message, severity: 'error' };
}

function isValidFullGstRate(rate: number): boolean {
  return FULL_GST_RATES.has(rate);
}

function isValidHalfGstRate(rate: number): boolean {
  return HALF_GST_RATES.has(rate);
}

function isValidIndianReg(raw: string): boolean {
  return INDIAN_REG_RE.test(raw.replace(/\s+/g, '').toUpperCase());
}

/** Parse DD/MM/YYYY (or similar) → Date, or null if invalid. */
function parseInvoiceDate(raw: string): Date | null {
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(raw.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// ── Document ────────────────────────────────────────────────────

function checkDocumentFields(data: ParsedInvoiceData, issues: ValidationIssue[]): void {
  if (!data.company_name?.trim()) {
    issues.push(warn('parsed_data.company_name', 'Company name is missing'));
  }
  if (!data.invoice_number?.trim()) {
    issues.push(warn('parsed_data.invoice_number', 'Invoice number is missing'));
  }
  if (!data.invoice_date?.trim()) {
    issues.push(warn('parsed_data.invoice_date', 'Invoice date is missing'));
  }
  if (!data.gstin?.trim()) {
    issues.push(warn('parsed_data.gstin', 'GSTIN is missing'));
  }
  const reg = data.vehicle_details?.registration_number?.trim();
  if (!reg) {
    issues.push(warn('parsed_data.vehicle_details.registration_number', 'Vehicle registration is missing'));
  }
}

// ── Invoice date ────────────────────────────────────────────────

function checkInvoiceDate(data: ParsedInvoiceData, issues: ValidationIssue[]): void {
  const raw = data.invoice_date?.trim();
  if (!raw) return;
  const d = parseInvoiceDate(raw);
  if (!d) {
    issues.push(warn('parsed_data.invoice_date', 'Invoice date looks invalid'));
    return;
  }
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (d.getTime() > today.getTime()) {
    issues.push(warn('parsed_data.invoice_date', 'Invoice date is in the future'));
  }
}

// ── Vehicle ─────────────────────────────────────────────────────

function checkVehicle(data: ParsedInvoiceData, issues: ValidationIssue[]): void {
  const reg = data.vehicle_details?.registration_number?.trim();
  if (!reg) return;
  if (!isValidIndianReg(reg)) {
    issues.push(warn(
      'parsed_data.vehicle_details.registration_number',
      `Vehicle registration looks invalid: ${reg}`,
    ));
  }
}

// ── Parts line items ────────────────────────────────────────────

function checkPartsLineItems(parts: PartsLineItem[], issues: ValidationIssue[]): void {
  for (let i = 0; i < parts.length; i++) {
    const li = parts[i];
    const p = `parsed_data.parts_line_items[${i}]`;

    if (li.tax_percentage != null && (li.tax_percentage < 0 || li.tax_percentage > 28)) {
      issues.push(warn(`${p}.tax_percentage`, 'Tax percentage outside 0–28 GST range'));
    }
    if (li.tax_percentage != null && !isValidFullGstRate(li.tax_percentage)) {
      issues.push(warn(
        `${p}.tax_percentage`,
        `Tax percentage ${li.tax_percentage}% is not among valid Indian GST rates (0, 3, 5, 12, 18, 28)`,
      ));
    }

    if (li.hsn_sac_code && /^\d{1,2}$/.test(li.hsn_sac_code)) {
      issues.push(warn(`${p}.hsn_sac_code`, 'HSN/SAC looks like a tax rate, not a code'));
    } else if (li.hsn_sac_code?.trim()) {
      const digits = li.hsn_sac_code.replace(/\D/g, '');
      if (digits.length > 0 && ![4, 6, 8].includes(digits.length)) {
        issues.push(warn(`${p}.hsn_sac_code`, 'HSN/SAC should generally be 4, 6, or 8 digits'));
      }
    }

    if (partsTaxableMismatch(li)) {
      const expected = roundMoney((li.quantity ?? 0) * (li.rate ?? 0));
      issues.push(warn(
        `${p}.taxable_amount`,
        `taxable_amount ${li.taxable_amount} ≠ quantity × rate (${expected})`,
      ));
    }

    if (li.quantity != null && li.rate == null && li.taxable_amount == null) {
      issues.push(warn(p, 'Parts row missing rate and taxable_amount'));
    }
    if (li.quantity != null && li.quantity < 0) {
      issues.push(warn(`${p}.quantity`, 'Quantity is negative'));
    }
    if (li.rate != null && li.rate < 0) {
      issues.push(warn(`${p}.rate`, 'Rate is negative'));
    }
    if (li.taxable_amount != null && li.taxable_amount < 0) {
      issues.push(warn(`${p}.taxable_amount`, 'Taxable amount is negative'));
    }
    if (li.quantity === 0 && li.rate != null) {
      issues.push(warn(`${p}.quantity`, 'Quantity is zero when rate exists'));
    }
  }
}

// ── Labour line items ───────────────────────────────────────────

function checkLabourLineItems(labour: LabourServiceLineItem[], issues: ValidationIssue[]): void {
  for (let i = 0; i < labour.length; i++) {
    const li = labour[i];
    const p = `parsed_data.labour_service_line_items[${i}]`;

    if (li.tax_percentage != null && (li.tax_percentage < 0 || li.tax_percentage > 28)) {
      issues.push(warn(`${p}.tax_percentage`, 'Tax percentage outside 0–28 GST range'));
    }
    if (li.tax_percentage != null && !isValidFullGstRate(li.tax_percentage)) {
      issues.push(warn(
        `${p}.tax_percentage`,
        `Tax percentage ${li.tax_percentage}% is not among valid Indian GST rates (0, 3, 5, 12, 18, 28)`,
      ));
    }

    if (li.hsn_sac_code && /^\d{1,2}$/.test(li.hsn_sac_code)) {
      issues.push(warn(`${p}.hsn_sac_code`, 'HSN/SAC looks like a tax rate, not a code'));
    } else if (li.hsn_sac_code?.trim()) {
      const digits = li.hsn_sac_code.replace(/\D/g, '');
      if (digits.length > 0 && ![4, 6, 8].includes(digits.length)) {
        issues.push(warn(`${p}.hsn_sac_code`, 'HSN/SAC should generally be 4, 6, or 8 digits'));
      }
    }

    if (li.labour_charges == null) {
      issues.push(warn(`${p}.labour_charges`, 'Labour row missing labour_charges'));
    } else if (li.labour_charges < 0) {
      issues.push(warn(`${p}.labour_charges`, 'Labour charges are negative'));
    }
  }
}

// ── GST footer (parts + labour × cgst/sgst/igst) ────────────────

function checkGstFooter(t: TotalsAndTaxSummary, issues: ValidationIssue[]): void {
  const cgst = (t.parts_cgst_amount ?? 0) + (t.labour_cgst_amount ?? 0);
  const igst = (t.parts_igst_amount ?? 0) + (t.labour_igst_amount ?? 0);
  if (cgst > 0 && igst > 0) {
    issues.push(warn(
      'parsed_data.totals_and_tax_summary',
      'Both CGST/SGST and IGST amounts present — check GST regime',
    ));
  }

  const rateAmtPairs = [
    ['parts_cgst_rate', 'parts_cgst_amount'],
    ['parts_sgst_rate', 'parts_sgst_amount'],
    ['parts_igst_rate', 'parts_igst_amount'],
    ['labour_cgst_rate', 'labour_cgst_amount'],
    ['labour_sgst_rate', 'labour_sgst_amount'],
    ['labour_igst_rate', 'labour_igst_amount'],
  ] as const;

  for (const [rateKey, amtKey] of rateAmtPairs) {
    if (t[rateKey] != null && t[amtKey] == null) {
      issues.push(warn(
        `parsed_data.totals_and_tax_summary.${amtKey}`,
        `GST rate ${t[rateKey]}% printed but amount missing`,
      ));
    }
  }

  // Valid rates: IGST = full slab; CGST/SGST = half slab
  const rateChecks: Array<{ key: keyof TotalsAndTaxSummary; half: boolean }> = [
    { key: 'parts_cgst_rate', half: true },
    { key: 'parts_sgst_rate', half: true },
    { key: 'parts_igst_rate', half: false },
    { key: 'labour_cgst_rate', half: true },
    { key: 'labour_sgst_rate', half: true },
    { key: 'labour_igst_rate', half: false },
  ];
  for (const { key, half } of rateChecks) {
    const rate = t[key];
    if (typeof rate !== 'number') continue;
    const ok = half ? isValidHalfGstRate(rate) : isValidFullGstRate(rate);
    if (!ok) {
      issues.push(warn(
        `parsed_data.totals_and_tax_summary.${key}`,
        `${key} ${rate}% is not a valid Indian GST rate`,
      ));
    }
  }

  // CGST == SGST (rate and amount) per side
  for (const side of ['parts', 'labour'] as const) {
    const cgstRate = t[`${side}_cgst_rate`];
    const sgstRate = t[`${side}_sgst_rate`];
    if (cgstRate != null && sgstRate != null && cgstRate !== sgstRate) {
      issues.push(warn(
        `parsed_data.totals_and_tax_summary.${side}_cgst_rate`,
        `${side} CGST rate (${cgstRate}) should equal SGST rate (${sgstRate}) — CGST == SGST`,
      ));
    }
    const cgstAmt = t[`${side}_cgst_amount`];
    const sgstAmt = t[`${side}_sgst_amount`];
    if (cgstAmt != null && sgstAmt != null && Math.abs(cgstAmt - sgstAmt) > GST_TOLERANCE) {
      issues.push(warn(
        `parsed_data.totals_and_tax_summary.${side}_cgst_amount`,
        `${side} CGST amount (${cgstAmt}) should equal SGST amount (${sgstAmt}) — CGST == SGST`,
      ));
    }
  }

  // Expected GST amount = taxable × rate / 100 (± ₹1)
  for (const side of ['parts', 'labour'] as const) {
    const sub = t[`${side}_total`];
    if (sub == null || sub <= 0) continue;
    const disc = (t[`${side}_discount`] ?? 0) + (t[`${side}_special_discount`] ?? 0);
    const taxable = roundMoney(sub - disc);
    if (taxable <= 0) continue;

    for (const kind of ['cgst', 'sgst', 'igst'] as const) {
      const rate = t[`${side}_${kind}_rate`];
      const amount = t[`${side}_${kind}_amount`];
      if (rate == null || amount == null) continue;
      const expected = roundMoney(taxable * rate / 100);
      if (Math.abs(amount - expected) > GST_TOLERANCE) {
        issues.push(warn(
          `parsed_data.totals_and_tax_summary.${side}_${kind}_amount`,
          `GST amount mismatch: expected ${expected} (taxable × ${rate}%), got ${amount}`,
        ));
      }
    }
  }
}

// ── Amounts / totals ────────────────────────────────────────────

function checkAmounts(
  t: TotalsAndTaxSummary,
  parts: PartsLineItem[],
  labour: LabourServiceLineItem[],
  issues: ValidationIssue[],
): void {
  const moneyKeys: (keyof TotalsAndTaxSummary)[] = [
    'parts_total', 'labour_total', 'parts_discount', 'labour_discount',
    'parts_special_discount', 'labour_special_discount',
    'parts_cgst_amount', 'parts_sgst_amount', 'parts_igst_amount',
    'labour_cgst_amount', 'labour_sgst_amount', 'labour_igst_amount',
    'sub_total_calculated', 'grand_total_invoice', 'deductibles', 'salvage',
  ];
  for (const k of moneyKeys) {
    const v = t[k];
    if (typeof v === 'number' && v < 0) {
      issues.push(warn(`parsed_data.totals_and_tax_summary.${k}`, `${k} is negative`));
    }
  }

  if (t.parts_total != null && parts.length > 0) {
    const sum = roundMoney(parts.reduce((a, p) => a + (p.taxable_amount ?? 0), 0));
    if (Math.abs(sum - t.parts_total) > Math.max(1, t.parts_total * 0.02)) {
      issues.push(warn(
        'parsed_data.totals_and_tax_summary.parts_total',
        `parts_total ${t.parts_total} ≠ sum of line taxable (${sum})`,
      ));
    }
  }

  if (t.labour_total != null && labour.length > 0) {
    const sum = roundMoney(labour.reduce((a, l) => a + (l.labour_charges ?? 0), 0));
    if (Math.abs(sum - t.labour_total) > Math.max(1, t.labour_total * 0.02)) {
      issues.push(warn(
        'parsed_data.totals_and_tax_summary.labour_total',
        `labour_total ${t.labour_total} ≠ sum of labour_charges (${sum})`,
      ));
    }
  }

  const partsDisc = (t.parts_discount ?? 0) + (t.parts_special_discount ?? 0);
  const labourDisc = (t.labour_discount ?? 0) + (t.labour_special_discount ?? 0);
  if (t.parts_total != null && partsDisc > t.parts_total + GST_TOLERANCE) {
    issues.push(warn(
      'parsed_data.totals_and_tax_summary.parts_discount',
      'Parts discount exceeds parts subtotal',
    ));
  }
  if (t.labour_total != null && labourDisc > t.labour_total + GST_TOLERANCE) {
    issues.push(warn(
      'parsed_data.totals_and_tax_summary.labour_discount',
      'Labour discount exceeds labour subtotal',
    ));
  }

  if (t.grand_total_invoice != null && t.sub_total_calculated != null) {
    const diff = Math.abs(t.grand_total_invoice - t.sub_total_calculated);
    const isRounded = Math.round(t.sub_total_calculated) === t.grand_total_invoice;
    const pNet = columnNet(t, 'parts');
    const lNet = columnNet(t, 'labour');
    const fromColumns = pNet != null && lNet != null ? roundMoney(pNet + lNet) : null;
    const columnsMatch = fromColumns != null && (
      Math.abs(fromColumns - t.grand_total_invoice) <= 1
      || Math.round(fromColumns) === t.grand_total_invoice
    );
    if (!isRounded && !columnsMatch && diff > Math.max(2, t.grand_total_invoice * 0.02)) {
      issues.push(warn(
        'parsed_data.totals_and_tax_summary',
        'grand_total_invoice differs from sub_total_calculated (often sub_total is pre-discount sum — check footer)',
      ));
    }

    const totalDisc = partsDisc + labourDisc;
    if (
      t.grand_total_invoice + GST_TOLERANCE < t.sub_total_calculated
      && totalDisc + GST_TOLERANCE < (t.sub_total_calculated - t.grand_total_invoice)
    ) {
      issues.push(warn(
        'parsed_data.totals_and_tax_summary.grand_total_invoice',
        'Grand total is smaller than subtotal without enough discount to explain it',
      ));
    }
  }
}

// ── OCR consistency ─────────────────────────────────────────────

function checkOcrConsistency(data: ParsedInvoiceData, markdown: string, issues: ValidationIssue[]): void {
  if (data.confidence == null || data.confidence <= 0.9) return;

  const mdNorm = markdown.replace(/\s+/g, '').toUpperCase();
  // GSTIN value should appear in OCR text (detects LLM hallucination)
  if (data.gstin) {
    const g = data.gstin.replace(/\s/g, '').toUpperCase();
    if (!mdNorm.includes(g)) {
      issues.push(warn('parsed_data.gstin', 'GSTIN in JSON but not found in OCR text'));
    }
  }

  if (data.invoice_number?.trim()) {
    const inv = data.invoice_number.replace(/\s+/g, '').toUpperCase();
    if (!mdNorm.includes(inv)) {
      issues.push(warn('parsed_data.invoice_number', 'Invoice number not found in OCR text'));
    }
  }

  const reg = data.vehicle_details?.registration_number?.trim();
  if (reg) {
    const r = reg.replace(/\s+/g, '').toUpperCase();
    if (!mdNorm.includes(r)) {
      issues.push(warn(
        'parsed_data.vehicle_details.registration_number',
        'Vehicle registration not found in OCR text',
      ));
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────

export function validateParsedInvoice(data: ParsedInvoiceData, markdown?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Existing combined missing-fields check
  if (!data.company_name && !data.invoice_number && !data.gstin) {
    issues.push(warn('parsed_data', 'Missing company_name, invoice_number, and gstin'));
  }

  checkDocumentFields(data, issues);

  if (data.gstin && !/^\d{2}[A-Z0-9]{13}$/.test(data.gstin.replace(/\s/g, ''))) {
    issues.push(warn('parsed_data.gstin', 'GSTIN format looks invalid'));
  }
  if (data.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(data.pan.replace(/\s/g, ''))) {
    issues.push(warn('parsed_data.pan', 'PAN format looks invalid'));
  }

  checkInvoiceDate(data, issues);
  checkVehicle(data, issues);

  const parts = data.parts_line_items ?? [];
  const labour = data.labour_service_line_items ?? [];
  if (parts.length === 0 && labour.length === 0) {
    issues.push(warn('parsed_data.line_items', 'No parts or labour line items extracted'));
  }

  checkPartsLineItems(parts, issues);
  checkLabourLineItems(labour, issues);

  const t = data.totals_and_tax_summary;
  if (t) {
    checkGstFooter(t, issues);
    checkAmounts(t, parts, labour, issues);
  }

  if (markdown) {
    checkOcrConsistency(data, markdown, issues);
  }

  const conf = toNum(data.confidence);
  if (conf != null && (conf < 0 || conf > 1)) {
    issues.push(error('parsed_data.confidence', 'confidence must be between 0 and 1'));
  }

  return issues;
}

export function hasValidationErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
