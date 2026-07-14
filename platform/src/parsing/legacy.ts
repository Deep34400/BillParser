import type { CanonicalResult } from '../providers/types.js';

const toNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const toStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const approx = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);

function correctTotal(subtotal?: number, discount?: number, taxTotal?: number, total?: number): number | undefined {
  if (subtotal == null || !discount) return total;
  const t = taxTotal ?? 0;
  const noDiscount = round2(subtotal + t);
  if (total == null || approx(total, noDiscount)) return round2(subtotal - discount + t);
  return total;
}

function taxTotalOf(cgst?: number, sgst?: number, igst?: number, taxAmount?: number): number | undefined {
  return [cgst, sgst, igst].some((x) => x != null) ? (cgst ?? 0) + (sgst ?? 0) + (igst ?? 0) : taxAmount;
}

type GstBag = { cgst?: number; sgst?: number; igst?: number };
function gstRegime(markdown?: string): 'igst' | 'cgstsgst' | null {
  if (!markdown) return null;
  const hasIgst = /IGST/i.test(markdown);
  const hasCgstSgst = /CGST/i.test(markdown) || /SGST/i.test(markdown);
  if (hasIgst && !hasCgstSgst) return 'igst';
  if (hasCgstSgst && !hasIgst) return 'cgstsgst';
  return null;
}
function applyRegime<T extends GstBag>(bag: T, regime: 'igst' | 'cgstsgst' | null): T {
  if (!regime) return bag;
  if (regime === 'igst') {
    if (bag.cgst == null && bag.sgst == null) return bag;
    const igst = round2((bag.cgst ?? 0) + (bag.sgst ?? 0) + (bag.igst ?? 0));
    return { ...bag, igst, cgst: undefined, sgst: undefined };
  }
  if (bag.igst == null) return bag;
  const half = round2(((bag.cgst ?? 0) + (bag.sgst ?? 0) + bag.igst) / 2);
  return { ...bag, cgst: half, sgst: half, igst: undefined };
}

/** Legacy flat canonical JSON (vendorName, lineItems, …) — kept for backward compatibility. */
export function parseLegacyCanonical(raw: string, markdown?: string): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  const json = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;
  const o = JSON.parse(json) as Record<string, unknown>;
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];

  const subtotal = toNum(o.subtotal);
  const taxAmount = toNum(o.taxAmount);
  const discountAmount = toNum(o.discountAmount);
  const cgstAmount = toNum(o.cgstAmount);
  const sgstAmount = toNum(o.sgstAmount);
  const igstAmount = toNum(o.igstAmount);
  let totalAmount = toNum(o.totalAmount);
  let netAmount = toNum(o.netAmount);

  const overallTax = taxTotalOf(cgstAmount, sgstAmount, igstAmount, taxAmount);
  totalAmount = correctTotal(subtotal, discountAmount, overallTax, totalAmount);
  if (subtotal != null && discountAmount) {
    const noDiscount = round2(subtotal + (overallTax ?? 0));
    if (netAmount == null || approx(netAmount, noDiscount)) {
      netAmount = Math.round(subtotal - discountAmount + (overallTax ?? 0));
    }
  }

  const regime = gstRegime(markdown);
  const gst = applyRegime({ cgst: cgstAmount, sgst: sgstAmount, igst: igstAmount }, regime);

  const rawCols = Array.isArray(o.summaryColumns) ? o.summaryColumns : [];
  const summaryColumns = rawCols
    .map((c: any) => {
      const st = toNum(c.subtotal);
      const discount = toNum(c.discount);
      const cgst = toNum(c.cgst);
      const sgst = toNum(c.sgst);
      const igst = toNum(c.igst);
      const total = correctTotal(st, discount, taxTotalOf(cgst, sgst, igst), toNum(c.total));
      return applyRegime({ label: toStr(c.label), subtotal: st, discount, cgst, sgst, igst, total }, regime);
    })
    .filter((c) => [c.subtotal, c.discount, c.cgst, c.sgst, c.igst, c.total].some((v) => v != null));

  return {
    vendorName: toStr(o.vendorName), vendorAddress: toStr(o.vendorAddress), vendorTaxId: toStr(o.vendorTaxId),
    invoiceNumber: toStr(o.invoiceNumber), poNumber: toStr(o.poNumber),
    invoiceDate: toStr(o.invoiceDate), dueDate: toStr(o.dueDate),
    currency: toStr(o.currency), subtotal, taxAmount,
    totalAmount, paymentTerms: toStr(o.paymentTerms),
    discountAmount, cgstAmount: gst.cgst, sgstAmount: gst.sgst,
    igstAmount: gst.igst, netAmount,
    summaryColumns: summaryColumns.length ? summaryColumns : undefined,
    confidence: toNum(o.confidence),
    lineItems: items.map((it: any, i: number) => {
      let hsnSac = toStr(it.hsnSac);
      let taxRate = toNum(it.taxRate);
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
