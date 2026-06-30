import type { CanonicalResult } from '../providers/types.js';
import { PROVIDER_REFERENCE } from '../providers/reference.js';
const HEADER_KEYS: (keyof CanonicalResult)[] = ['vendorName', 'invoiceNumber', 'invoiceDate', 'totalAmount', 'currency', 'subtotal'];
export function deriveConfidence(r: Pick<CanonicalResult, 'confidence' | 'lineItems'> & Partial<CanonicalResult>): number {
  if (typeof r.confidence === 'number' && r.confidence > 0) return Math.min(1, r.confidence);
  const present = HEADER_KEYS.filter((k) => r[k] !== undefined && r[k] !== null).length;
  const headerScore = present / HEADER_KEYS.length;
  const itemScore = (r.lineItems?.length ?? 0) > 0 ? 1 : 0;
  return Math.round((headerScore * 0.7 + itemScore * 0.3) * 100) / 100;
}
export function estimateCost(provider: string, pages: number): number | undefined {
  const ref = PROVIDER_REFERENCE[provider];
  return ref ? (pages * ref.costPer1k) / 1000 : undefined;
}

// Split a stored total cost back into its extraction (OCR) and structuring (LLM) parts.
// Extraction is the per-page provider estimate; structuring is whatever remains of the
// total (it was added in at extraction time from the LLM's token usage).
export function splitCost(
  provider: string | null | undefined,
  pageCount: number | null | undefined,
  total: number | null | undefined,
): { extractionCost: number | null; structuringCost: number | null } {
  if (total === null || total === undefined) return { extractionCost: null, structuringCost: null };
  const extractionCost = (provider ? estimateCost(provider, pageCount ?? 0) : 0) ?? 0;
  return { extractionCost, structuringCost: Math.max(0, total - extractionCost) };
}
