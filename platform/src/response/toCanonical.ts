import type { CanonicalResult, CanonicalLineItem, SummaryColumn } from '../providers/types.js';
import type { ParsedInvoiceData } from '../parsing/types.js';
import { parseInvoiceDate, toNum } from '../parsing/coerce.js';
import { parseLegacyCanonical } from '../parsing/legacy.js';

function fixLineTax(hsnSac?: string, taxRate?: number): { hsnSac?: string; taxRate?: number } {
  let hsn = hsnSac;
  let rate = taxRate;
  if (rate != null && rate > 100) {
    if (!hsn) hsn = String(rate);
    rate = undefined;
  }
  return { hsnSac: hsn, taxRate: rate };
}

/** Map central schema → DB/API canonical shape (backward compatible). */
export function toCanonicalResult(parsed: ParsedInvoiceData, markdown?: string): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const t = parsed.totals_and_tax_summary;
  const lineItems: CanonicalLineItem[] = [];
  let n = 0;

  for (const p of parsed.parts_line_items ?? []) {
    const { hsnSac, taxRate } = fixLineTax(p.hsn_sac_code ?? undefined, p.tax_percentage ?? undefined);
    lineItems.push({
      lineNumber: ++n,
      description: p.item_name_description ?? undefined,
      sku: p.part_number_item_code ?? undefined,
      hsnSac,
      quantity: p.quantity ?? undefined,
      unitPrice: p.rate ?? undefined,
      amount: p.taxable_amount ?? undefined,
      taxRate,
    });
  }

  for (const l of parsed.labour_service_line_items ?? []) {
    const { hsnSac, taxRate } = fixLineTax(l.hsn_sac_code ?? undefined, l.tax_percentage ?? undefined);
    lineItems.push({
      lineNumber: ++n,
      description: l.labour_description ?? undefined,
      sku: l.labour_code ?? undefined,
      hsnSac,
      labourAmount: l.labour_charges ?? undefined,
      taxRate,
    });
  }

  const summaryColumns: SummaryColumn[] = [];
  if (t && (t.parts_total != null || t.labour_total != null)) {
    if (t.parts_total != null || t.parts_cgst_amount != null) {
      summaryColumns.push({
        label: 'Parts',
        subtotal: t.parts_total ?? undefined,
        discount: t.parts_discount ?? undefined,
        cgst: t.parts_cgst_amount ?? undefined,
        sgst: t.parts_sgst_amount ?? undefined,
        igst: t.parts_igst_amount ?? undefined,
        total: t.parts_total != null
          ? (t.parts_total - (t.parts_discount ?? 0) - (t.parts_special_discount ?? 0)
            + (t.parts_cgst_amount ?? 0) + (t.parts_sgst_amount ?? 0) + (t.parts_igst_amount ?? 0))
          : undefined,
      });
    }
    if (t.labour_total != null || t.labour_cgst_amount != null) {
      summaryColumns.push({
        label: 'Labour',
        subtotal: t.labour_total ?? undefined,
        discount: t.labour_discount ?? undefined,
        cgst: t.labour_cgst_amount ?? undefined,
        sgst: t.labour_sgst_amount ?? undefined,
        igst: t.labour_igst_amount ?? undefined,
        total: t.labour_total != null
          ? (t.labour_total - (t.labour_discount ?? 0) - (t.labour_special_discount ?? 0)
            + (t.labour_cgst_amount ?? 0) + (t.labour_sgst_amount ?? 0) + (t.labour_igst_amount ?? 0))
          : undefined,
      });
    }
  }

  const cgstSum = (t?.parts_cgst_amount ?? 0) + (t?.labour_cgst_amount ?? 0);
  const sgstSum = (t?.parts_sgst_amount ?? 0) + (t?.labour_sgst_amount ?? 0);
  const igstSum = (t?.parts_igst_amount ?? 0) + (t?.labour_igst_amount ?? 0);
  const discSum = (t?.parts_discount ?? 0) + (t?.labour_discount ?? 0)
    + (t?.parts_special_discount ?? 0) + (t?.labour_special_discount ?? 0);
  const hasCgst = t?.parts_cgst_amount != null || t?.labour_cgst_amount != null;
  const hasSgst = t?.parts_sgst_amount != null || t?.labour_sgst_amount != null;
  const hasIgst = t?.parts_igst_amount != null || t?.labour_igst_amount != null;
  const hasDisc = t?.parts_discount != null || t?.labour_discount != null;
  const cgstAmount = hasCgst ? cgstSum : undefined;
  const sgstAmount = hasSgst ? sgstSum : undefined;
  const igstAmount = hasIgst ? igstSum : undefined;
  const discountAmount = hasDisc ? discSum : undefined;
  const taxAmount = hasCgst || hasSgst || hasIgst ? cgstSum + sgstSum + igstSum : undefined;

  const vehicle = parsed.vehicle_details;
  const service = parsed.service_details;
  const vendorAddress = vehicle?.registration_number
    ? `Reg: ${vehicle.registration_number}${vehicle.chassis_number ? `, Chassis: ${vehicle.chassis_number}` : ''}${vehicle.mileage_odometer_reading != null ? `, Odometer: ${vehicle.mileage_odometer_reading}` : ''}`
    : undefined;
  const paymentTerms = service?.service_type
    ? [service.service_type, service.next_service_due ? `Next: ${service.next_service_due}` : null].filter(Boolean).join(' · ')
    : undefined;

  return {
    vendorName: parsed.company_name ?? undefined,
    vendorAddress,
    vendorTaxId: parsed.gstin ?? parsed.pan ?? undefined,
    invoiceNumber: parsed.invoice_number ?? undefined,
    invoiceDate: parseInvoiceDate(parsed.invoice_date) ?? undefined,
    subtotal: t?.sub_total_calculated ?? undefined,
    discountAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxAmount,
    totalAmount: t?.grand_total_invoice ?? undefined,
    netAmount: t?.grand_total_invoice ?? undefined,
    summaryColumns: summaryColumns.length ? summaryColumns : undefined,
    paymentTerms,
    currency: parsed.gstin ? 'INR' : undefined,
    confidence: parsed.confidence ?? undefined,
    lineItems,
  };
}

/** Build full schema wrapper for storage in rawJson. */
export function wrapParsedData(parsed: ParsedInvoiceData, id?: string) {
  return {
    output: {
      entries: [{ id: id ?? null, parsed_data: parsed }],
    },
  };
}

export { parseLegacyCanonical };
