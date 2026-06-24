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

  // Correct a forgotten discount: the model often reports totalAmount/netAmount as
  // subtotal + tax, skipping the "less discount" line. When a discount is present and the
  // model's figure matches the un-discounted sum, replace it with subtotal - discount + tax.
  // Only fires when a discount exists, so non-GST invoices (which may carry shipping/other
  // charges that legitimately make total != subtotal + tax) are left untouched.
  if (subtotal != null && discountAmount) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const taxTotal = [cgstAmount, sgstAmount, igstAmount].some((x) => x != null)
      ? (cgstAmount ?? 0) + (sgstAmount ?? 0) + (igstAmount ?? 0)
      : (taxAmount ?? 0);
    const noDiscount = round2(subtotal + taxTotal);
    const withDiscount = round2(subtotal - discountAmount + taxTotal);
    const approx = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);
    if (totalAmount == null || approx(totalAmount, noDiscount)) totalAmount = withDiscount;
    if (netAmount == null || approx(netAmount, noDiscount)) netAmount = Math.round(withDiscount);
  }

  return {
    vendorName: toStr(o.vendorName), vendorAddress: toStr(o.vendorAddress), vendorTaxId: toStr(o.vendorTaxId),
    invoiceNumber: toStr(o.invoiceNumber), poNumber: toStr(o.poNumber),
    invoiceDate: toStr(o.invoiceDate), dueDate: toStr(o.dueDate),
    currency: toStr(o.currency), subtotal, taxAmount,
    totalAmount, paymentTerms: toStr(o.paymentTerms),
    discountAmount, cgstAmount, sgstAmount,
    igstAmount, netAmount,
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
