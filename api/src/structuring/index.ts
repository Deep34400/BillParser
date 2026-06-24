import type { CanonicalResult } from '../providers/types.js';
import type { StructuringModel } from './types.js';
import { getSetting, getCredentials } from '../settings/store.js';
import { DEFAULTS } from '../settings/defaults.js';
import { anthropicModel } from './anthropic.js';
import { openaiModel } from './openai.js';
import { mistralStructModel } from './mistral.js';
import { ollamaStructModel } from './ollama.js';

const toNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const toStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));

const round2 = (n: number) => Math.round(n * 100) / 100;
const approx = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);

// Correct a forgotten discount. The model often reports the tax-inclusive total as
// subtotal + tax, skipping the "less discount" line. When a discount exists and the given
// total matches the un-discounted sum (or is missing), recompute as subtotal - discount + tax.
// Only acts when a discount is present, so totals that legitimately differ from subtotal+tax
// (shipping, other charges) are left untouched.
function correctTotal(subtotal?: number, discount?: number, taxTotal?: number, total?: number): number | undefined {
  if (subtotal == null || !discount) return total;
  const t = taxTotal ?? 0;
  const noDiscount = round2(subtotal + t);
  if (total == null || approx(total, noDiscount)) return round2(subtotal - discount + t);
  return total;
}

// Sum of GST components when any are present, else the single taxAmount figure.
function taxTotalOf(cgst?: number, sgst?: number, igst?: number, taxAmount?: number): number | undefined {
  return [cgst, sgst, igst].some((x) => x != null) ? (cgst ?? 0) + (sgst ?? 0) + (igst ?? 0) : taxAmount;
}

export function normalizeStructured(raw: string): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  const json = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch (e: any) {
    throw new Error(
      `Failed to parse structured JSON from model output: ${String(e?.message ?? e)}. ` +
        `Raw output (first 300 chars): ${raw.slice(0, 300)}`,
    );
  }
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];

  const subtotal = toNum(o.subtotal);
  const taxAmount = toNum(o.taxAmount);
  const discountAmount = toNum(o.discountAmount);
  const cgstAmount = toNum(o.cgstAmount);
  const sgstAmount = toNum(o.sgstAmount);
  const igstAmount = toNum(o.igstAmount);
  let totalAmount = toNum(o.totalAmount);
  let netAmount = toNum(o.netAmount);

  // Apply the forgotten-discount correction to the overall total, and to the rounded net bill.
  const overallTax = taxTotalOf(cgstAmount, sgstAmount, igstAmount, taxAmount);
  totalAmount = correctTotal(subtotal, discountAmount, overallTax, totalAmount);
  if (subtotal != null && discountAmount) {
    const noDiscount = round2(subtotal + (overallTax ?? 0));
    if (netAmount == null || approx(netAmount, noDiscount)) {
      netAmount = Math.round(subtotal - discountAmount + (overallTax ?? 0));
    }
  }

  // Columnwise summary (Parts/Labour/…). Coerce each column, correct its discounted total,
  // and drop columns with no amounts. The scalar fields above remain the overall totals.
  const rawCols = Array.isArray(o.summaryColumns) ? o.summaryColumns : [];
  const summaryColumns = rawCols
    .map((c: any) => {
      const subtotal = toNum(c.subtotal);
      const discount = toNum(c.discount);
      const cgst = toNum(c.cgst);
      const sgst = toNum(c.sgst);
      const igst = toNum(c.igst);
      const total = correctTotal(subtotal, discount, taxTotalOf(cgst, sgst, igst), toNum(c.total));
      return { label: toStr(c.label), subtotal, discount, cgst, sgst, igst, total };
    })
    .filter((c) => [c.subtotal, c.discount, c.cgst, c.sgst, c.igst, c.total].some((v) => v != null));

  return {
    vendorName: toStr(o.vendorName), vendorAddress: toStr(o.vendorAddress), vendorTaxId: toStr(o.vendorTaxId),
    invoiceNumber: toStr(o.invoiceNumber), poNumber: toStr(o.poNumber),
    invoiceDate: toStr(o.invoiceDate), dueDate: toStr(o.dueDate),
    currency: toStr(o.currency), subtotal, taxAmount,
    totalAmount, paymentTerms: toStr(o.paymentTerms),
    discountAmount, cgstAmount, sgstAmount,
    igstAmount, netAmount,
    summaryColumns: summaryColumns.length ? summaryColumns : undefined,
    confidence: toNum(o.confidence),
    lineItems: items.map((it: any, i: number) => {
      let hsnSac = toStr(it.hsnSac);
      let taxRate = toNum(it.taxRate);
      // GST rates are percentages (≤28% in India). A "tax rate" above 100 is never a real
      // rate — it is almost always an HSN/SAC code the model mis-mapped from the adjacent
      // HSN/SAC column. Recover it into hsnSac when empty, and drop the bogus rate either way.
      if (taxRate != null && taxRate > 100) {
        if (hsnSac == null) hsnSac = String(taxRate);
        taxRate = undefined;
      }
      return {
        lineNumber: i + 1, description: toStr(it.description), sku: toStr(it.sku), hsnSac,
        quantity: toNum(it.quantity), unitPrice: toNum(it.unitPrice), amount: toNum(it.amount),
        labourAmount: toNum(it.labourAmount), taxRate,
      };
    }),
  };
}

export async function getStructuringModel(): Promise<{ model: StructuringModel; creds: Record<string, string> }> {
  const provider = await getSetting('structuring_provider', DEFAULTS.structuring_provider);
  const model = await getSetting('structuring_model', DEFAULTS.structuring_model);
  const creds = (await getCredentials(`structuring_${provider}`)) ?? (await getCredentials(provider)) ?? {};
  const impl: Record<string, (m: string) => StructuringModel> = {
    anthropic: anthropicModel, openai: openaiModel, mistral: mistralStructModel,
    ollama: ollamaStructModel,
  };
  const factory = impl[provider];
  if (!factory) throw new Error(`Unknown structuring provider: ${provider}`);
  return { model: factory(model), creds };
}
