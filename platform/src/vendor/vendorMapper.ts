/**
 * Vendor Mapper — extracts vendor-relevant fields from ParsedInvoiceData.
 * No AI, no LLM calls. Pure field extraction + basic cleanup.
 */
import type { ParsedInvoiceData } from '../shared/types.js';

export interface ExtractedVendorFields {
  legal_name: string | null;
  display_name: string | null;
  gstin: string | null;
  pan: string | null;
  /** True if at least one usable identifier (GSTIN, PAN, or legal_name) exists. */
  hasIdentifier: boolean;
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z]$/;

function trimOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Extract PAN from a valid 15-char GSTIN (characters 3–12). */
function panFromGstin(gstin: string | null): string | null {
  if (!gstin || !GSTIN_RE.test(gstin)) return null;
  return gstin.slice(2, 12);
}

export function extractVendorFields(parsed: ParsedInvoiceData): ExtractedVendorFields {
  const legalName = trimOrNull(parsed.company_name);
  const gstin = trimOrNull(parsed.gstin);
  const pan = trimOrNull(parsed.pan) ?? panFromGstin(gstin);

  const hasIdentifier = !!(gstin || pan || legalName);

  return {
    legal_name: legalName,
    display_name: legalName,
    gstin,
    pan,
    hasIdentifier,
  };
}
