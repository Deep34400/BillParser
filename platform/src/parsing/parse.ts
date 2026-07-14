import type {
  InvoiceSchemaOutput, ParsedInvoiceData, PartsLineItem, LabourServiceLineItem,
  ServiceDetails, VehicleDetails, TotalsAndTaxSummary, ParseResult,
} from './types.js';
import { prepareLlmJson, prepareLlmJsonWithRepair, toNum, toStr, toNullableNum, toNullableStr } from './coerce.js';
import { validateParsedInvoice } from './validate.js';
import { parseLegacyCanonical } from './legacy.js';
import { enrichParsedInvoice } from '../billing/normalize.js';

function coerceServiceDetails(o: unknown): ServiceDetails | null | undefined {
  if (o == null) return o === null ? null : undefined;
  if (typeof o !== 'object') return undefined;
  const x = o as Record<string, unknown>;
  return {
    last_service: toNullableStr(x.last_service),
    service_type: toNullableStr(x.service_type),
    next_service_due: toNullableStr(x.next_service_due),
  };
}

function coerceVehicleDetails(o: unknown): VehicleDetails | null | undefined {
  if (o == null) return o === null ? null : undefined;
  if (typeof o !== 'object') return undefined;
  const x = o as Record<string, unknown>;
  return {
    chassis_number: toNullableStr(x.chassis_number),
    registration_number: toNullableStr(x.registration_number),
    mileage_odometer_reading: toNullableNum(x.mileage_odometer_reading) ?? undefined,
  };
}

function coercePartsLineItem(o: unknown): PartsLineItem {
  const x = (o && typeof o === 'object') ? o as Record<string, unknown> : {};
  return {
    rate: toNullableNum(x.rate) ?? undefined,
    quantity: toNullableNum(x.quantity) ?? undefined,
    hsn_sac_code: toNullableStr(x.hsn_sac_code),
    tax_percentage: toNullableNum(x.tax_percentage) ?? undefined,
    taxable_amount: toNullableNum(x.taxable_amount) ?? undefined,
    item_name_description: toNullableStr(x.item_name_description),
    part_number_item_code: toNullableStr(x.part_number_item_code),
  };
}

function coerceLabourLineItem(o: unknown): LabourServiceLineItem {
  const x = (o && typeof o === 'object') ? o as Record<string, unknown> : {};
  return {
    labour_code: toNullableStr(x.labour_code),
    hsn_sac_code: toNullableStr(x.hsn_sac_code),
    labour_charges: toNullableNum(x.labour_charges) ?? undefined,
    tax_percentage: toNullableNum(x.tax_percentage) ?? undefined,
    labour_description: toNullableStr(x.labour_description),
  };
}

function coerceTotals(o: unknown): TotalsAndTaxSummary | null | undefined {
  if (o == null) return o === null ? null : undefined;
  if (typeof o !== 'object') return undefined;
  const x = o as Record<string, unknown>;
  const fields = [
    'parts_total', 'labour_total', 'parts_discount', 'labour_discount',
    'parts_cgst_rate', 'parts_igst_rate', 'parts_sgst_rate',
    'labour_cgst_rate', 'labour_igst_rate', 'labour_sgst_rate',
    'parts_cgst_amount', 'parts_igst_amount', 'parts_sgst_amount',
    'labour_cgst_amount', 'labour_igst_amount', 'labour_sgst_amount',
    'sub_total_calculated', 'grand_total_invoice',
    'parts_special_discount', 'labour_special_discount', 'deductibles', 'salvage',
  ] as const;
  const out: TotalsAndTaxSummary = {};
  for (const k of fields) out[k] = toNullableNum(x[k]) ?? undefined;
  return out;
}

export function coerceParsedInvoiceData(o: Record<string, unknown>): ParsedInvoiceData {
  return {
    irn: toNullableStr(o.irn),
    pan: toNullableStr(o.pan),
    gstin: toNullableStr(o.gstin),
    company_name: toNullableStr(o.company_name),
    invoice_date: toNullableStr(o.invoice_date),
    invoice_time: toNullableStr(o.invoice_time),
    invoice_number: toNullableStr(o.invoice_number),
    service_details: coerceServiceDetails(o.service_details),
    vehicle_details: coerceVehicleDetails(o.vehicle_details),
    parts_line_items: Array.isArray(o.parts_line_items)
      ? o.parts_line_items.map(coercePartsLineItem) : [],
    labour_service_line_items: Array.isArray(o.labour_service_line_items)
      ? o.labour_service_line_items.map(coerceLabourLineItem) : [],
    totals_and_tax_summary: coerceTotals(o.totals_and_tax_summary),
    confidence: toNum(o.confidence),
  };
}

function unwrapSchemaPayload(obj: Record<string, unknown>): ParsedInvoiceData | null {
  const output = obj.output as InvoiceSchemaOutput['output'] | undefined;
  const entry = output?.entries?.[0];
  if (entry?.parsed_data && typeof entry.parsed_data === 'object') {
    return coerceParsedInvoiceData(entry.parsed_data as Record<string, unknown>);
  }
  if (obj.parsed_data && typeof obj.parsed_data === 'object') {
    return coerceParsedInvoiceData(obj.parsed_data as Record<string, unknown>);
  }
  if (obj.company_name != null || obj.parts_line_items != null || obj.gstin != null) {
    return coerceParsedInvoiceData(obj);
  }
  return null;
}

function isLegacyCanonical(obj: Record<string, unknown>): boolean {
  return obj.vendorName != null || Array.isArray(obj.lineItems);
}

/**
 * Parse LLM output → validated ParsedInvoiceData.
 * Supports: new schema wrapper, flat parsed_data, and legacy canonical JSON.
 */
function parseJsonObject(raw: string): Record<string, unknown> {
  const prepared = prepareLlmJson(raw);
  try {
    return JSON.parse(prepared) as Record<string, unknown>;
  } catch (e1: unknown) {
    try {
      return JSON.parse(prepareLlmJsonWithRepair(raw)) as Record<string, unknown>;
    } catch (e2: unknown) {
      const msg = String((e1 as Error)?.message ?? e1);
      const pos = /position (\d+)/.exec(msg)?.[1];
      const snippet = pos
        ? prepared.slice(Math.max(0, Number(pos) - 40), Number(pos) + 40)
        : prepared.slice(0, 200);
      throw new Error(
        `Failed to parse structured JSON: ${msg}. ` +
        `Near error: …${snippet}… Raw (first 300): ${raw.slice(0, 300)}`,
      );
    }
  }
}

export function parseStructuredOutput(raw: string, markdown?: string): ParseResult {
  const obj = parseJsonObject(raw);

  const schemaParsed = unwrapSchemaPayload(obj);
  if (schemaParsed) {
    const parsed = enrichParsedInvoice(schemaParsed, markdown);
    const validation = validateParsedInvoice(parsed, markdown);
    return { parsed, raw: obj, format: 'schema', validation };
  }

  if (isLegacyCanonical(obj)) {
    const legacy = parseLegacyCanonical(prepareLlmJson(raw), markdown);
    return {
      parsed: legacyToSchema(legacy),
      raw: obj,
      format: 'legacy',
      validation: validateParsedInvoice(legacyToSchema(legacy), markdown),
    };
  }

  throw new Error('Unrecognized invoice JSON shape — expected output.entries[0].parsed_data');
}

/** Bridge legacy canonical fields into schema shape for validation/storage. */
function legacyToSchema(legacy: ReturnType<typeof parseLegacyCanonical>): ParsedInvoiceData {
  return {
    company_name: legacy.vendorName ?? null,
    gstin: legacy.vendorTaxId ?? null,
    invoice_number: legacy.invoiceNumber ?? null,
    invoice_date: legacy.invoiceDate ?? null,
    confidence: legacy.confidence ?? null,
    parts_line_items: legacy.lineItems
      .filter((li) => li.amount != null && li.labourAmount == null)
      .map((li) => ({
        item_name_description: li.description ?? null,
        part_number_item_code: li.sku ?? null,
        hsn_sac_code: li.hsnSac ?? null,
        quantity: li.quantity ?? null,
        rate: li.unitPrice ?? null,
        taxable_amount: li.amount ?? null,
        tax_percentage: li.taxRate ?? null,
      })),
    labour_service_line_items: legacy.lineItems
      .filter((li) => li.labourAmount != null)
      .map((li) => ({
        labour_description: li.description ?? null,
        labour_code: li.sku ?? null,
        hsn_sac_code: li.hsnSac ?? null,
        labour_charges: li.labourAmount ?? null,
        tax_percentage: li.taxRate ?? null,
      })),
    totals_and_tax_summary: {
      sub_total_calculated: legacy.subtotal ?? null,
      grand_total_invoice: legacy.totalAmount ?? null,
      parts_discount: legacy.discountAmount ?? null,
      parts_cgst_amount: legacy.cgstAmount ?? null,
      parts_sgst_amount: legacy.sgstAmount ?? null,
      parts_igst_amount: legacy.igstAmount ?? null,
    },
  };
}
