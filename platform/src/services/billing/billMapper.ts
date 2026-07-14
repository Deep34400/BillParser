/**
 * Map parsed OCR data into a BillDoc for Firestore storage.
 * Preserves GST values as-is from OCR — no forced calculations.
 */
import type { BillDoc, ParsedInvoiceData, BillType } from '../../models/types.js';
import type { OcrCostInfo } from '../../providers/types.js';
import { computeReviewReasons } from '../../billing/reviewFlags.js';

const SCHEMA_VERSION = 1;

/** True when parsed data actually carries content (skip review flags for the empty placeholder bill). */
function hasParsedContent(parsed: ParsedInvoiceData): boolean {
  return !!(
    parsed.company_name || parsed.gstin || parsed.invoice_number ||
    (parsed.parts_line_items?.length ?? 0) > 0 ||
    (parsed.labour_service_line_items?.length ?? 0) > 0 ||
    parsed.totals_and_tax_summary?.grand_total_invoice != null
  );
}

export function mapParsedToBill(
  billId: string,
  parsed: ParsedInvoiceData,
  opts: {
    fileUrl?: string;
    storagePath?: string;
    rawOcrReference?: string;
    billType?: BillType;
    fleetId?: string;
    vehicleId?: string;
    costInfo?: OcrCostInfo;
  } = {},
): BillDoc {
  const t = parsed.totals_and_tax_summary;
  const vd = parsed.vehicle_details;
  const now = new Date().toISOString();

  const totalTax = sum(
    t?.parts_cgst_amount, t?.parts_sgst_amount, t?.parts_igst_amount,
    t?.labour_cgst_amount, t?.labour_sgst_amount, t?.labour_igst_amount,
  );

  return {
    bill_id: billId,
    fleet_id: opts.fleetId ?? null,
    vehicle_id: opts.vehicleId ?? null,

    bill_type: opts.billType ?? 'MAINTENANCE',
    bill_category: null,

    vendor_name: parsed.company_name ?? null,
    vendor_gstin: parsed.gstin ?? null,

    company_name: parsed.company_name ?? null,
    gstin: parsed.gstin ?? null,
    pan: parsed.pan ?? null,
    irn: parsed.irn ?? null,

    invoice_number: parsed.invoice_number ?? null,
    invoice_date: parsed.invoice_date ?? null,
    invoice_time: parsed.invoice_time ?? null,

    subtotal_amount: t?.sub_total_calculated ?? null,
    parts_amount: t?.parts_total ?? null,
    labour_amount: t?.labour_total ?? null,

    parts_cgst_amount: t?.parts_cgst_amount ?? null,
    parts_sgst_amount: t?.parts_sgst_amount ?? null,
    parts_igst_amount: t?.parts_igst_amount ?? null,
    parts_cgst_rate: t?.parts_cgst_rate ?? null,
    parts_sgst_rate: t?.parts_sgst_rate ?? null,
    parts_igst_rate: t?.parts_igst_rate ?? null,

    labour_cgst_amount: t?.labour_cgst_amount ?? null,
    labour_sgst_amount: t?.labour_sgst_amount ?? null,
    labour_igst_amount: t?.labour_igst_amount ?? null,
    labour_cgst_rate: t?.labour_cgst_rate ?? null,
    labour_sgst_rate: t?.labour_sgst_rate ?? null,
    labour_igst_rate: t?.labour_igst_rate ?? null,

    total_tax_amount: totalTax,
    grand_total_amount: t?.grand_total_invoice ?? null,

    deductibles: t?.deductibles ?? null,
    salvage: t?.salvage ?? null,

    odometer_reading: vd?.mileage_odometer_reading ?? null,
    registration_number: vd?.registration_number ?? null,
    chassis_number: vd?.chassis_number ?? null,

    ocr_status: 'OCR_COMPLETED',
    processing_status: null,
    confidence_score: parsed.confidence ?? null,

    review_reasons: hasParsedContent(parsed) ? computeReviewReasons(parsed) : null,

    file_url: opts.fileUrl ?? null,
    storage_path: opts.storagePath ?? null,

    raw_ocr_reference: opts.rawOcrReference ?? null,
    parsed_data: parsed,

    extraction_cost_usd: opts.costInfo?.extraction?.cost_usd ?? null,
    structuring_cost_usd: opts.costInfo?.structuring?.cost_usd ?? null,
    total_cost_usd: opts.costInfo?.total_cost_usd ?? null,
    extraction_tokens: opts.costInfo?.extraction?.usage.total_tokens ?? null,
    structuring_tokens: opts.costInfo?.structuring?.usage.total_tokens ?? null,
    total_tokens: opts.costInfo?.total_tokens ?? null,
    extraction_provider: opts.costInfo?.extraction?.provider ?? null,
    structuring_provider: opts.costInfo?.structuring?.provider ?? null,
    extraction_model: opts.costInfo?.extraction?.model ?? null,
    structuring_model: opts.costInfo?.structuring?.model ?? null,
    extraction_latency_ms: opts.costInfo?.extraction?.latency_ms ?? null,
    structuring_latency_ms: opts.costInfo?.structuring?.latency_ms ?? null,
    total_latency_ms: (opts.costInfo?.extraction?.latency_ms ?? 0) + (opts.costInfo?.structuring?.latency_ms ?? 0) || null,

    schema_version: SCHEMA_VERSION,

    created_at: now,
    updated_at: now,
  };
}

function sum(...vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}
