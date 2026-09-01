/**
 * AzAPI OCR provider — sync multipart POST, returns structured invoice JSON.
 * Response `parsed_data` uses the same field names as ParsedInvoiceData.
 */
import type { ParsedInvoiceData, TotalsAndTaxSummary } from '../types/invoice.js';
import type { OcrStepCost, LlmUsage } from '../types/provider.js';
import type { SingleResult } from './llmSingle.js';

const AZAPI_TIMEOUT_MS = 180_000;

export interface AzapiRawResponse {
  status?: string;
  message?: string;
  requestid?: string;
  sequenceid?: string;
  output?: {
    entries?: Array<{
      id?: string;
      parsed_data?: Record<string, unknown>;
    }>;
  };
}

/**
 * Map raw AzAPI response to ParsedInvoiceData.
 * Exported for unit testing.
 */
export function mapAzapiResponse(raw: unknown): { parsed: ParsedInvoiceData; documentId: string | null } {
  const r = raw as AzapiRawResponse;
  const status = String(r?.status ?? '').toLowerCase();
  if (status && status !== 'success') {
    throw new Error(`AzAPI OCR failed: ${r?.message || status}`);
  }

  const entry = r?.output?.entries?.[0];
  const data = entry?.parsed_data;
  if (!data || typeof data !== 'object') {
    throw new Error('AzAPI OCR returned no parsed data');
  }

  const totalsRaw = (data.totals_and_tax_summary ?? {}) as Record<string, unknown>;
  const grandTotal = totalsRaw.grand_total_invoice ?? totalsRaw.grand_total_calculated ?? totalsRaw.grand_total;

  const totals: TotalsAndTaxSummary = {
    parts_total: num(totalsRaw.parts_total),
    labour_total: num(totalsRaw.labour_total),
    parts_discount: num(totalsRaw.parts_discount),
    labour_discount: num(totalsRaw.labour_discount),
    parts_special_discount: num(totalsRaw.parts_special_discount),
    labour_special_discount: num(totalsRaw.labour_special_discount),
    parts_cgst_rate: num(totalsRaw.parts_cgst_rate ?? totalsRaw.cgst_rate),
    parts_sgst_rate: num(totalsRaw.parts_sgst_rate ?? totalsRaw.sgst_rate),
    parts_igst_rate: num(totalsRaw.parts_igst_rate ?? totalsRaw.igst_rate),
    parts_cgst_amount: num(totalsRaw.parts_cgst_amount ?? totalsRaw.cgst_amount),
    parts_sgst_amount: num(totalsRaw.parts_sgst_amount ?? totalsRaw.sgst_amount),
    parts_igst_amount: num(totalsRaw.parts_igst_amount ?? totalsRaw.igst_amount),
    labour_cgst_rate: num(totalsRaw.labour_cgst_rate ?? totalsRaw.cgst_rate_labour_charges),
    labour_sgst_rate: num(totalsRaw.labour_sgst_rate ?? totalsRaw.sgst_rate_labour_charges),
    labour_igst_rate: num(totalsRaw.labour_igst_rate ?? totalsRaw.igst_rate_labour_charges),
    labour_cgst_amount: num(totalsRaw.labour_cgst_amount ?? totalsRaw.cgst_amount_labour_charges),
    labour_sgst_amount: num(totalsRaw.labour_sgst_amount ?? totalsRaw.sgst_amount_labour_charges),
    labour_igst_amount: num(totalsRaw.labour_igst_amount ?? totalsRaw.igst_amount_labour_charges),
    deductibles: num(totalsRaw.deductibles),
    salvage: num(totalsRaw.salvage),
    grand_total_invoice: num(grandTotal),
  };

  const serviceRaw = (data.service_details ?? data.job_card_details ?? null) as Record<string, unknown> | null;
  const vehicleRaw = (data.vehicle_details ?? null) as Record<string, unknown> | null;

  const parsed: ParsedInvoiceData = {
    company_name: str(data.company_name),
    invoice_number: str(data.invoice_number),
    invoice_date: str(data.invoice_date),
    gstin: str(data.gstin),
    pan: str(data.pan),
    vehicle_details: vehicleRaw ? {
      registration_number: str(vehicleRaw.registration_number),
      chassis_number: str(vehicleRaw.chassis_number),
      mileage_odometer_reading: num(vehicleRaw.mileage_odometer_reading),
    } : undefined,
    service_details: serviceRaw ? {
      service_type: str(serviceRaw.service_type),
      next_service_due: str(serviceRaw.next_service_due),
    } : undefined,
    parts_line_items: Array.isArray(data.parts_line_items)
      ? (data.parts_line_items as Record<string, unknown>[]).map((row) => ({
          item_name_description: str(row.item_name_description ?? row.part_description),
          part_number_item_code: str(row.part_number_item_code ?? row.part_code),
          hsn_sac_code: str(row.hsn_sac_code),
          quantity: num(row.quantity),
          rate: num(row.rate),
          taxable_amount: num(row.taxable_amount ?? row.net_amount ?? row.amount),
          tax_percentage: num(row.tax_percentage),
        }))
      : [],
    labour_service_line_items: Array.isArray(data.labour_service_line_items)
      ? (data.labour_service_line_items as Record<string, unknown>[]).map((row) => ({
          labour_description: str(row.labour_description),
          labour_code: str(row.labour_code),
          hsn_sac_code: str(row.hsn_sac_code),
          labour_charges: num(row.labour_charges),
          tax_percentage: num(row.tax_percentage),
        }))
      : [],
    totals_and_tax_summary: totals,
  };

  const documentId = entry?.id || r?.requestid || r?.sequenceid || null;
  return { parsed, documentId };
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  return String(v);
}

/**
 * Call AzAPI sync OCR endpoint.
 * POST multipart form with `file` field → returns structured invoice JSON.
 */
export async function azapiSingle(buf: Buffer, url: string, token: string): Promise<SingleResult> {
  const start = Date.now();

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)]), 'invoice.pdf');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AZAPI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: token },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`AzAPI OCR request failed: ${err instanceof Error ? err.message : 'unknown'}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AzAPI OCR HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const raw: unknown = await res.json();
  const { parsed, documentId } = mapAzapiResponse(raw);
  const latency = Date.now() - start;

  const usage: LlmUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const cost: OcrStepCost = {
    provider: 'azapi',
    model: 'azapi-ocr',
    usage,
    cost_usd: 0,
    input_cost_usd: 0,
    output_cost_usd: 0,
    latency_ms: latency,
  };

  const rawOcr = JSON.stringify({ ...raw as object, _azapi_document_id: documentId });

  return { parsed, rawOcr, cost };
}
