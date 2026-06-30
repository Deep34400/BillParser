import type { ParsedInvoiceData, ValidationIssue } from './types.js';
import { toNum } from './coerce.js';
import { partsTaxableMismatch, roundMoney, columnNet } from '../billing/normalize.js';

export function validateParsedInvoice(data: ParsedInvoiceData, markdown?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!data.company_name && !data.invoice_number && !data.gstin) {
    issues.push({ path: 'parsed_data', message: 'Missing company_name, invoice_number, and gstin', severity: 'warning' });
  }

  if (data.gstin && !/^\d{2}[A-Z0-9]{13}$/.test(data.gstin.replace(/\s/g, ''))) {
    issues.push({ path: 'parsed_data.gstin', message: 'GSTIN format looks invalid', severity: 'warning' });
  }

  if (data.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(data.pan.replace(/\s/g, ''))) {
    issues.push({ path: 'parsed_data.pan', message: 'PAN format looks invalid', severity: 'warning' });
  }

  const parts = data.parts_line_items ?? [];
  const labour = data.labour_service_line_items ?? [];
  if (parts.length === 0 && labour.length === 0) {
    issues.push({ path: 'parsed_data.line_items', message: 'No parts or labour line items extracted', severity: 'warning' });
  }

  for (let i = 0; i < parts.length; i++) {
    const li = parts[i];
    const p = `parsed_data.parts_line_items[${i}]`;
    if (li.tax_percentage != null && (li.tax_percentage < 0 || li.tax_percentage > 28)) {
      issues.push({ path: `${p}.tax_percentage`, message: 'Tax percentage outside 0–28 GST range', severity: 'warning' });
    }
    if (li.hsn_sac_code && /^\d{1,2}$/.test(li.hsn_sac_code)) {
      issues.push({ path: `${p}.hsn_sac_code`, message: 'HSN/SAC looks like a tax rate, not a code', severity: 'warning' });
    }
    if (partsTaxableMismatch(li)) {
      const expected = roundMoney((li.quantity ?? 0) * (li.rate ?? 0));
      issues.push({
        path: `${p}.taxable_amount`,
        message: `taxable_amount ${li.taxable_amount} ≠ quantity × rate (${expected})`,
        severity: 'warning',
      });
    }
    if (li.quantity != null && li.rate == null && li.taxable_amount == null) {
      issues.push({ path: p, message: 'Parts row missing rate and taxable_amount', severity: 'warning' });
    }
  }

  for (let i = 0; i < labour.length; i++) {
    const li = labour[i];
    const p = `parsed_data.labour_service_line_items[${i}]`;
    if (li.tax_percentage != null && (li.tax_percentage < 0 || li.tax_percentage > 28)) {
      issues.push({ path: `${p}.tax_percentage`, message: 'Tax percentage outside 0–28 GST range', severity: 'warning' });
    }
    if (li.labour_charges == null) {
      issues.push({ path: `${p}.labour_charges`, message: 'Labour row missing labour_charges', severity: 'warning' });
    }
  }

  const t = data.totals_and_tax_summary;
  if (t) {
    const cgst = (t.parts_cgst_amount ?? 0) + (t.labour_cgst_amount ?? 0);
    const sgst = (t.parts_sgst_amount ?? 0) + (t.labour_sgst_amount ?? 0);
    const igst = (t.parts_igst_amount ?? 0) + (t.labour_igst_amount ?? 0);
    if (cgst > 0 && igst > 0) {
      issues.push({ path: 'parsed_data.totals_and_tax_summary', message: 'Both CGST/SGST and IGST amounts present — check GST regime', severity: 'warning' });
    }
    // Warn when rate is printed but amount missing — do not auto-calculate GST.
    const rateAmtPairs = [
      ['parts_cgst_rate', 'parts_cgst_amount'], ['parts_sgst_rate', 'parts_sgst_amount'], ['parts_igst_rate', 'parts_igst_amount'],
      ['labour_cgst_rate', 'labour_cgst_amount'], ['labour_sgst_rate', 'labour_sgst_amount'], ['labour_igst_rate', 'labour_igst_amount'],
    ] as const;
    for (const [rateKey, amtKey] of rateAmtPairs) {
      if (t[rateKey] != null && t[amtKey] == null) {
        issues.push({ path: `parsed_data.totals_and_tax_summary.${amtKey}`, message: `GST rate ${t[rateKey]}% printed but amount missing`, severity: 'warning' });
      }
    }
    if (t.parts_total != null && parts.length > 0) {
      const sum = roundMoney(parts.reduce((a, p) => a + (p.taxable_amount ?? 0), 0));
      if (Math.abs(sum - t.parts_total) > Math.max(1, t.parts_total * 0.02)) {
        issues.push({ path: 'parsed_data.totals_and_tax_summary.parts_total', message: `parts_total ${t.parts_total} ≠ sum of line taxable (${sum})`, severity: 'warning' });
      }
    }
    if (t.labour_total != null && labour.length > 0) {
      const sum = roundMoney(labour.reduce((a, l) => a + (l.labour_charges ?? 0), 0));
      if (Math.abs(sum - t.labour_total) > Math.max(1, t.labour_total * 0.02)) {
        issues.push({ path: 'parsed_data.totals_and_tax_summary.labour_total', message: `labour_total ${t.labour_total} ≠ sum of labour_charges (${sum})`, severity: 'warning' });
      }
    }
    if (t.grand_total_invoice != null && t.sub_total_calculated != null) {
      const diff = Math.abs(t.grand_total_invoice - t.sub_total_calculated);
      const isRounded = Math.round(t.sub_total_calculated) === t.grand_total_invoice;
      const pNet = columnNet(t, 'parts');
      const lNet = columnNet(t, 'labour');
      const fromColumns = pNet != null && lNet != null ? roundMoney(pNet + lNet) : null;
      const columnsMatch = fromColumns != null && (
        Math.abs(fromColumns - t.grand_total_invoice) <= 1 || Math.round(fromColumns) === t.grand_total_invoice
      );
      if (!isRounded && !columnsMatch && diff > Math.max(2, t.grand_total_invoice * 0.02)) {
        issues.push({
          path: 'parsed_data.totals_and_tax_summary',
          message: 'grand_total_invoice differs from sub_total_calculated (often sub_total is pre-discount sum — check footer)',
          severity: 'warning',
        });
      }
    }
  }

  if (markdown && data.confidence != null && data.confidence > 0.9) {
    const mdHasGstin = /GSTIN|GST\s*IN/i.test(markdown);
    if (data.gstin && !mdHasGstin) {
      issues.push({ path: 'parsed_data.gstin', message: 'GSTIN in JSON but not found in OCR text', severity: 'warning' });
    }
  }

  const conf = toNum(data.confidence);
  if (conf != null && (conf < 0 || conf > 1)) {
    issues.push({ path: 'parsed_data.confidence', message: 'confidence must be between 0 and 1', severity: 'error' });
  }

  return issues;
}

export function hasValidationErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
