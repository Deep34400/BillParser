/**
 * Analytics Service — aggregation and business logic.
 * All data comes through repository.ts. No direct Firestore access.
 */
import { fetchAllBills, type BillDoc } from './repository.js';
import { getSettings } from '../shared/settings.js';
import { toNum } from '../shared/numbers.js';
import { isJunkVendorName } from '../ocr/transformer/normalize/vendor.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KpiResult {
  totalSpend: number;
  completedCount: number;
  needsReview: number;
  totalParts: number;
  totalLabour: number;
  totalTax: number;
  avgConfidence: number;
  vendorCount: number;
  vehicleCount: number;
  totalInvoiceCount: number;
  avgProcessingTimeMs: number | null;
  byVendor: { name: string; amount: number; parts_amount: number; labour_amount: number }[];
  byMonth: { label: string; amount: number; count: number }[];
}

export interface VehicleSpendSummary {
  vehicle_id: string;
  registration_number: string | null;
  total_bills: number;
  total_amount: number;
  parts_amount: number;
  labour_amount: number;
  total_tax: number;
}

export interface CostPerKmResult {
  vehicle_id: string;
  registration_number: string | null;
  total_spend: number;
  km_range: number | null;
  cost_per_km: number | null;
}

export interface OcrCostSummary {
  total_ocr_count: number;
  total_extraction_cost_usd: number;
  total_structuring_cost_usd: number;
  total_cost_usd: number;
  total_extraction_tokens: number;
  total_structuring_tokens: number;
  total_tokens: number;
  avg_cost_per_ocr_usd: number;
  avg_tokens_per_ocr: number;
  by_provider: { provider: string; cost_usd: number; tokens: number; count: number }[];
  /**
   * Rupee totals summed per bill at the rate frozen when each was processed, so
   * changing the configured rate never restates history. The client must not
   * re-derive these from the USD figures with a single global rate.
   */
  total_cost_inr: number;
  avg_cost_per_ocr_inr: number;
  by_provider_inr: Record<string, number>;
}

// ─── KPI Aggregation ────────────────────────────────────────────────────────

export async function computeKpis(): Promise<KpiResult> {
  const bills = await fetchAllBills();

  let totalSpend = 0, completedCount = 0, confidenceSum = 0, needsReview = 0;
  let totalParts = 0, totalLabour = 0, totalTax = 0;
  let latencySum = 0, latencyCount = 0;
  const vendorTotals = new Map<string, { amount: number; parts: number; labour: number }>();
  const monthTotals = new Map<string, { amount: number; count: number }>();
  const vehicleIds = new Set<string>();

  for (const bill of bills) {
    const vid = bill.vehicle_id ?? bill.registration_number;
    if (vid) vehicleIds.add(vid);

    if (bill.total_latency_ms != null && bill.total_latency_ms > 0) {
      latencySum += bill.total_latency_ms;
      latencyCount++;
    }

    if (bill.ocr_status === 'OCR_COMPLETED' || bill.ocr_status === 'VERIFIED') {
      completedCount++;
      const amount = toNum(bill.grand_total_amount) ?? 0;
      const parts = toNum(bill.parts_amount) ?? 0;
      const labour = toNum(bill.labour_amount) ?? 0;
      totalSpend += amount;
      totalParts += parts;
      totalLabour += labour;
      totalTax += toNum(bill.total_tax_amount) ?? 0;
      if (bill.confidence_score != null) confidenceSum += bill.confidence_score;

      const vendor = bill.vendor_name ?? bill.company_name ?? 'Unknown';
      if (!isJunkVendorName(vendor)) {
        const prev = vendorTotals.get(vendor) ?? { amount: 0, parts: 0, labour: 0 };
        vendorTotals.set(vendor, {
          amount: prev.amount + amount,
          parts: prev.parts + parts,
          labour: prev.labour + labour,
        });
      }

      if (bill.invoice_date) {
        const mk = bill.invoice_date.slice(0, 7);
        const prev = monthTotals.get(mk) ?? { amount: 0, count: 0 };
        monthTotals.set(mk, { amount: prev.amount + amount, count: prev.count + 1 });
      }
    }
    if (bill.ocr_status === 'NEED_REVIEW') needsReview++;
  }

  return {
    totalSpend, completedCount, needsReview, totalParts, totalLabour, totalTax,
    avgConfidence: completedCount > 0 ? Math.round((confidenceSum / completedCount) * 100) / 100 : 0,
    vendorCount: vendorTotals.size,
    vehicleCount: vehicleIds.size,
    totalInvoiceCount: bills.length,
    avgProcessingTimeMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
    byVendor: Array.from(vendorTotals.entries())
      .map(([name, v]) => ({ name, amount: v.amount, parts_amount: v.parts, labour_amount: v.labour }))
      .sort((a, b) => b.amount - a.amount),
    byMonth: Array.from(monthTotals.entries())
      .map(([label, v]) => ({ label, amount: v.amount, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// ─── Vehicle Spend ──────────────────────────────────────────────────────────

export async function getVehicleSpend(vehicleId?: string): Promise<VehicleSpendSummary[]> {
  let bills = await fetchAllBills();
  if (vehicleId) bills = bills.filter((b) => b.vehicle_id === vehicleId || b.registration_number === vehicleId);

  const byVehicle = new Map<string, VehicleSpendSummary>();

  for (const bill of bills) {
    const vid = bill.vehicle_id ?? bill.registration_number ?? 'unknown';
    const existing = byVehicle.get(vid) ?? {
      vehicle_id: vid,
      registration_number: bill.registration_number ?? null,
      total_bills: 0, total_amount: 0, parts_amount: 0, labour_amount: 0, total_tax: 0,
    };
    existing.total_bills++;
    existing.total_amount += toNum(bill.grand_total_amount) ?? 0;
    existing.parts_amount += toNum(bill.parts_amount) ?? 0;
    existing.labour_amount += toNum(bill.labour_amount) ?? 0;
    existing.total_tax += toNum(bill.total_tax_amount) ?? 0;
    byVehicle.set(vid, existing);
  }

  return Array.from(byVehicle.values()).sort((a, b) => b.total_amount - a.total_amount);
}

// ─── Cost Per Km ────────────────────────────────────────────────────────────

export async function getCostPerKm(): Promise<CostPerKmResult[]> {
  const bills = await fetchAllBills();
  const withOdo = bills.filter((b) => b.odometer_reading && b.odometer_reading > 0);

  const byVehicle = new Map<string, BillDoc[]>();
  for (const bill of withOdo) {
    const vid = bill.vehicle_id ?? bill.registration_number ?? 'unknown';
    const entry = byVehicle.get(vid) ?? [];
    entry.push(bill);
    byVehicle.set(vid, entry);
  }

  const results: CostPerKmResult[] = [];
  for (const [vid, group] of byVehicle) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.odometer_reading ?? 0) - (b.odometer_reading ?? 0));
    const minOdo = group[0].odometer_reading ?? 0;
    const maxOdo = group[group.length - 1].odometer_reading ?? 0;
    const kmRange = maxOdo - minOdo;
    const totalSpend = group.reduce((s, b) => s + (b.grand_total_amount ?? 0), 0);

    results.push({
      vehicle_id: vid,
      registration_number: group[0].registration_number ?? null,
      total_spend: totalSpend,
      km_range: kmRange > 0 ? kmRange : null,
      cost_per_km: kmRange > 0 ? Math.round((totalSpend / kmRange) * 100) / 100 : null,
    });
  }

  return results;
}

// ─── OCR Cost Summary ───────────────────────────────────────────────────────

export async function getOcrCostSummary(): Promise<OcrCostSummary> {
  const bills = await fetchAllBills();
  const completed = bills.filter((b) => b.ocr_status === 'OCR_COMPLETED' || b.ocr_status === 'VERIFIED');

  let extCost = 0, strCost = 0, totCost = 0, totInr = 0;
  let extTokens = 0, strTokens = 0, totTokens = 0;
  let ocrCount = 0;
  const byProvider = new Map<string, { cost_usd: number; tokens: number; count: number }>();
  const byProviderInr = new Map<string, number>();
  // Bills predating the frozen-rate column carry none; fall back to the current
  // setting rather than dropping them from the rupee total.
  const fallbackFx = (await getSettings()).usdToInr ?? 96;

  for (const b of completed) {
    if (b.total_cost_usd == null) continue;
    ocrCount++;
    extCost += b.extraction_cost_usd ?? 0;
    strCost += b.structuring_cost_usd ?? 0;
    totCost += b.total_cost_usd ?? 0;
    const fx = b.fx_rate_usd_inr ?? fallbackFx;
    totInr += (b.total_cost_usd ?? 0) * fx;
    extTokens += b.extraction_tokens ?? 0;
    strTokens += b.structuring_tokens ?? 0;
    totTokens += b.total_tokens ?? 0;

    for (const p of [b.extraction_provider, b.structuring_provider]) {
      if (!p) continue;
      const e = byProvider.get(p) ?? { cost_usd: 0, tokens: 0, count: 0 };
      e.count++;
      byProvider.set(p, e);
    }
    if (b.extraction_provider) {
      const e = byProvider.get(b.extraction_provider)!;
      e.cost_usd += b.extraction_cost_usd ?? 0;
      e.tokens += b.extraction_tokens ?? 0;
      byProviderInr.set(b.extraction_provider,
        (byProviderInr.get(b.extraction_provider) ?? 0) + (b.extraction_cost_usd ?? 0) * fx);
    }
    if (b.structuring_provider) {
      const e = byProvider.get(b.structuring_provider)!;
      e.cost_usd += b.structuring_cost_usd ?? 0;
      e.tokens += b.structuring_tokens ?? 0;
      byProviderInr.set(b.structuring_provider,
        (byProviderInr.get(b.structuring_provider) ?? 0) + (b.structuring_cost_usd ?? 0) * fx);
    }
  }

  return {
    total_ocr_count: ocrCount,
    total_extraction_cost_usd: Math.round(extCost * 10000) / 10000,
    total_structuring_cost_usd: Math.round(strCost * 10000) / 10000,
    total_cost_usd: Math.round(totCost * 10000) / 10000,
    total_extraction_tokens: extTokens,
    total_structuring_tokens: strTokens,
    total_tokens: totTokens,
    total_cost_inr: Math.round(totInr * 100) / 100,
    avg_cost_per_ocr_inr: ocrCount > 0 ? Math.round((totInr / ocrCount) * 100) / 100 : 0,
    by_provider_inr: Object.fromEntries(
      Array.from(byProviderInr.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    avg_cost_per_ocr_usd: ocrCount > 0 ? Math.round((totCost / ocrCount) * 10000) / 10000 : 0,
    avg_tokens_per_ocr: ocrCount > 0 ? Math.round(totTokens / ocrCount) : 0,
    by_provider: Array.from(byProvider.entries()).map(([provider, v]) => ({
      provider,
      cost_usd: Math.round(v.cost_usd * 10000) / 10000,
      tokens: v.tokens,
      count: v.count,
    })),
  };
}
