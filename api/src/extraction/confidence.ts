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
