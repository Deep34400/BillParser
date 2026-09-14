import type { ParsedInvoiceData, PartsLineItem, LabourServiceLineItem, TotalsAndTaxSummary } from '../../shared/types.js';

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function asNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function asParts(raw: unknown): PartsLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      item_name_description: asStr(r.item_name_description ?? r.description ?? r.name),
      part_number_item_code: asStr(r.part_number_item_code ?? r.part_number ?? r.sku),
      quantity: asNum(r.quantity ?? r.qty),
      rate: asNum(r.rate ?? r.unitPrice ?? r.unit_price),
      taxable_amount: asNum(r.taxable_amount ?? r.amount ?? r.lineTotal),
      hsn_sac_code: asStr(r.hsn_sac_code ?? r.hsnSac ?? r.hsn),
      tax_percentage: asNum(r.tax_percentage ?? r.taxRate),
    };
  });
}

function asLabour(raw: unknown): LabourServiceLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      labour_description: asStr(r.labour_description ?? r.description ?? r.name),
      labour_code: asStr(r.labour_code ?? r.code),
      labour_charges: asNum(r.labour_charges ?? r.amount ?? r.rate),
      hsn_sac_code: asStr(r.hsn_sac_code ?? r.hsnSac ?? r.hsn),
      tax_percentage: asNum(r.tax_percentage ?? r.taxRate),
    };
  });
}

function asTotals(raw: unknown): TotalsAndTaxSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  return {
    parts_total: asNum(t.parts_total),
    labour_total: asNum(t.labour_total),
    parts_discount: asNum(t.parts_discount),
    labour_discount: asNum(t.labour_discount),
    sub_total_calculated: asNum(t.sub_total_calculated ?? t.subtotal),
    grand_total_invoice: asNum(t.grand_total_invoice ?? t.grand_total ?? t.total),
    parts_cgst_amount: asNum(t.parts_cgst_amount),
    parts_sgst_amount: asNum(t.parts_sgst_amount),
    parts_igst_amount: asNum(t.parts_igst_amount),
    labour_cgst_amount: asNum(t.labour_cgst_amount),
    labour_sgst_amount: asNum(t.labour_sgst_amount),
    labour_igst_amount: asNum(t.labour_igst_amount),
  };
}

/** Coerce loose JSON (API paste or parsed_data) into ParsedInvoiceData. */
export function coerceCompareInvoice(raw: unknown): ParsedInvoiceData {
  if (!raw || typeof raw !== 'object') return {};
  const d = raw as Record<string, unknown>;
  const nested = (d.parsed_data && typeof d.parsed_data === 'object')
    ? d.parsed_data as Record<string, unknown>
    : d;
  const vehicle = (nested.vehicle_details && typeof nested.vehicle_details === 'object')
    ? nested.vehicle_details as Record<string, unknown>
    : {};

  return {
    company_name: asStr(nested.company_name ?? nested.vendorName ?? nested.vendor_name),
    gstin: asStr(nested.gstin ?? nested.vendor_gstin ?? nested.vendorTaxId),
    pan: asStr(nested.pan),
    invoice_number: asStr(nested.invoice_number ?? nested.invoiceNumber),
    invoice_date: asStr(nested.invoice_date ?? nested.invoiceDate),
    irn: asStr(nested.irn),
    vehicle_details: {
      registration_number: asStr(vehicle.registration_number ?? nested.registration_number ?? nested.registrationNumber),
      chassis_number: asStr(vehicle.chassis_number ?? nested.chassis_number),
      mileage_odometer_reading: asNum(vehicle.mileage_odometer_reading ?? nested.odometer_reading),
    },
    parts_line_items: asParts(nested.parts_line_items ?? nested.parts),
    labour_service_line_items: asLabour(nested.labour_service_line_items ?? nested.labour),
    totals_and_tax_summary: asTotals(nested.totals_and_tax_summary ?? nested.totals) ?? {
      grand_total_invoice: asNum(nested.grand_total_amount ?? nested.totalAmount ?? nested.total),
      parts_total: asNum(nested.parts_amount ?? nested.parts_total),
      labour_total: asNum(nested.labour_amount ?? nested.labour_total),
    },
  };
}

export function invoiceHasContent(parsed: ParsedInvoiceData): boolean {
  const t = parsed.totals_and_tax_summary;
  return Boolean(
    parsed.company_name
    || parsed.invoice_number
    || (parsed.parts_line_items?.length ?? 0) > 0
    || (parsed.labour_service_line_items?.length ?? 0) > 0
    || t?.grand_total_invoice != null
    || t?.parts_total != null,
  );
}
