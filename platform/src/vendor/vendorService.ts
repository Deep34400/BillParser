/**
 * Vendor Service — matching + upsert logic.
 *
 * Called AFTER OCR completes. Consumes ParsedInvoiceData (already produced).
 * No LLM calls. No AI. Simple field-based matching.
 *
 * Matching priority: GSTIN → PAN → Legal Name
 */
import { v4 as uuid } from 'uuid';
import { extractVendorFields } from './vendorMapper.js';
import {
  createVendor, updateVendor,
  findByGstin, findByPan, findByLegalName,
} from './vendorRepository.js';
import type { VendorDoc } from './vendorTypes.js';
import type { ParsedInvoiceData } from '../shared/types.js';

/**
 * Find or create a vendor from parsed invoice data, then return its vendor_id.
 * Returns null if parsed data has no usable vendor identifier.
 */
export async function upsertVendorFromInvoice(
  billId: string,
  parsed: ParsedInvoiceData,
): Promise<string | null> {
  const fields = extractVendorFields(parsed);
  if (!fields.hasIdentifier) return null;

  const existing = await matchExistingVendor(fields.gstin, fields.pan, fields.legal_name);

  if (existing) {
    await updateVendor(existing.vendor_id, {
      invoice_count: existing.invoice_count + 1,
      last_seen: new Date().toISOString(),
    });
    return existing.vendor_id;
  }

  const now = new Date().toISOString();
  const vendor: VendorDoc = {
    vendor_id: uuid(),
    legal_name: fields.legal_name,
    display_name: fields.display_name,
    gstin: fields.gstin,
    pan: fields.pan,
    invoice_count: 1,
    first_seen: now,
    last_seen: now,
    parser_name: null,
    created_at: now,
    updated_at: now,
  };

  await createVendor(vendor);
  return vendor.vendor_id;
}

async function matchExistingVendor(
  gstin: string | null,
  pan: string | null,
  legalName: string | null,
): Promise<VendorDoc | null> {
  if (gstin) {
    const v = await findByGstin(gstin);
    if (v) return v;
  }
  if (pan) {
    const v = await findByPan(pan);
    if (v) return v;
  }
  if (legalName) {
    const v = await findByLegalName(legalName);
    if (v) return v;
  }
  return null;
}
