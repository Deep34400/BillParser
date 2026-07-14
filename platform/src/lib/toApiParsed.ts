/**
 * Stable OCR response shape — source of truth.
 * Preserved exactly from the original system. Do not rename fields or change nesting.
 */
import type {
  ParsedInvoiceData, TotalsAndTaxSummary, PartsLineItem, LabourServiceLineItem,
  ServiceDetails, VehicleDetails,
} from '../models/types.js';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function resolveSideRates(
  cgstRate: number | null, sgstRate: number | null, igstRate: number | null,
  cgstAmt: number | null, sgstAmt: number | null, igstAmt: number | null,
): { cgst: number | null; sgst: number | null; igst: number | null } {
  const hasIgst = (igstAmt ?? 0) > 0;
  const hasCgstSgst = (cgstAmt ?? 0) > 0 || (sgstAmt ?? 0) > 0;
  if (hasIgst && !hasCgstSgst) return { cgst: null, sgst: null, igst: igstRate };
  if (hasCgstSgst && !hasIgst) return { cgst: cgstRate, sgst: sgstRate, igst: null };
  if (!hasIgst && !hasCgstSgst) return { cgst: null, sgst: null, igst: null };
  return { cgst: cgstRate, sgst: sgstRate, igst: igstRate };
}

function shapeTotals(t: TotalsAndTaxSummary | null | undefined) {
  t = t ?? {};
  const pr = resolveSideRates(
    num(t.parts_cgst_rate), num(t.parts_sgst_rate), num(t.parts_igst_rate),
    num(t.parts_cgst_amount), num(t.parts_sgst_amount), num(t.parts_igst_amount),
  );
  const lr = resolveSideRates(
    num(t.labour_cgst_rate), num(t.labour_sgst_rate), num(t.labour_igst_rate),
    num(t.labour_cgst_amount), num(t.labour_sgst_amount), num(t.labour_igst_amount),
  );
  return {
    parts_total: num(t.parts_total),
    labour_total: num(t.labour_total),
    parts_discount: num(t.parts_discount),
    labour_discount: num(t.labour_discount),
    parts_cgst_rate: pr.cgst,
    parts_igst_rate: pr.igst,
    parts_sgst_rate: pr.sgst,
    labour_cgst_rate: lr.cgst,
    labour_igst_rate: lr.igst,
    labour_sgst_rate: lr.sgst,
    parts_cgst_amount: num(t.parts_cgst_amount),
    parts_igst_amount: num(t.parts_igst_amount),
    parts_sgst_amount: num(t.parts_sgst_amount),
    labour_cgst_amount: num(t.labour_cgst_amount),
    labour_igst_amount: num(t.labour_igst_amount),
    labour_sgst_amount: num(t.labour_sgst_amount),
    sub_total_calculated: num(t.sub_total_calculated),
    grand_total_invoice: num(t.grand_total_invoice),
    parts_special_discount: num(t.parts_special_discount),
    labour_special_discount: num(t.labour_special_discount),
    deductibles: num(t.deductibles),
    salvage: num(t.salvage),
  };
}

function shapeParts(p: PartsLineItem) {
  return {
    rate: num(p.rate),
    quantity: num(p.quantity),
    hsn_sac_code: str(p.hsn_sac_code),
    tax_percentage: num(p.tax_percentage),
    taxable_amount: num(p.taxable_amount),
    item_name_description: str(p.item_name_description),
    part_number_item_code: str(p.part_number_item_code),
  };
}

function shapeLabour(l: LabourServiceLineItem) {
  return {
    labour_code: str(l.labour_code),
    hsn_sac_code: str(l.hsn_sac_code),
    labour_charges: num(l.labour_charges),
    tax_percentage: num(l.tax_percentage),
    labour_description: str(l.labour_description),
  };
}

export function toApiParsed(d: ParsedInvoiceData | null | undefined) {
  d = d ?? {};
  const sd = (d.service_details ?? {}) as ServiceDetails;
  const vd = (d.vehicle_details ?? {}) as VehicleDetails;
  return {
    irn: str(d.irn),
    pan: str(d.pan),
    gstin: str(d.gstin),
    company_name: str(d.company_name),
    invoice_date: str(d.invoice_date),
    invoice_time: str(d.invoice_time),
    invoice_number: str(d.invoice_number),
    service_details: {
      last_service: str(sd.last_service),
      service_type: str(sd.service_type),
      next_service_due: str(sd.next_service_due),
    },
    vehicle_details: {
      chassis_number: str(vd.chassis_number),
      registration_number: str(vd.registration_number),
      mileage_odometer_reading: num(vd.mileage_odometer_reading),
    },
    parts_line_items: (d.parts_line_items ?? []).map(shapeParts),
    labour_service_line_items: (d.labour_service_line_items ?? []).map(shapeLabour),
    totals_and_tax_summary: shapeTotals(d.totals_and_tax_summary),
  };
}
