/**
 * Analytics Service — aggregation queries over bills.
 * Reads through the models layer (works in both LOCAL_DEV and production).
 */
import { listBills } from '../models/bills.js';
import type { BillDoc } from '../models/types.js';

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

async function allBills(): Promise<BillDoc[]> {
  return listBills({ limit: 10000 });
}

export async function getVehicleSpend(vehicleId?: string): Promise<VehicleSpendSummary[]> {
  let bills = await allBills();
  if (vehicleId) bills = bills.filter((b) => b.vehicle_id === vehicleId || b.registration_number === vehicleId);

  const byVehicle = new Map<string, VehicleSpendSummary>();

  for (const bill of bills) {
    const vid = bill.vehicle_id ?? bill.registration_number ?? 'unknown';
    const existing = byVehicle.get(vid) ?? {
      vehicle_id: vid,
      registration_number: bill.registration_number ?? null,
      total_bills: 0,
      total_amount: 0,
      parts_amount: 0,
      labour_amount: 0,
      total_tax: 0,
    };
    existing.total_bills++;
    existing.total_amount += bill.grand_total_amount ?? 0;
    existing.parts_amount += bill.parts_amount ?? 0;
    existing.labour_amount += bill.labour_amount ?? 0;
    existing.total_tax += bill.total_tax_amount ?? 0;
    byVehicle.set(vid, existing);
  }

  return Array.from(byVehicle.values()).sort((a, b) => b.total_amount - a.total_amount);
}

export async function getCostPerKm(): Promise<CostPerKmResult[]> {
  const bills = await allBills();
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
}

export async function getOcrCostSummary(): Promise<OcrCostSummary> {
  const bills = await allBills();
  const completed = bills.filter((b) => b.ocr_status === 'OCR_COMPLETED' || b.ocr_status === 'VERIFIED');

  let extCost = 0, strCost = 0, totCost = 0;
  let extTokens = 0, strTokens = 0, totTokens = 0;
  let ocrCount = 0;
  const byProvider = new Map<string, { cost_usd: number; tokens: number; count: number }>();

  for (const b of completed) {
    if (b.total_cost_usd == null) continue;
    ocrCount++;
    extCost += b.extraction_cost_usd ?? 0;
    strCost += b.structuring_cost_usd ?? 0;
    totCost += b.total_cost_usd ?? 0;
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
    }
    if (b.structuring_provider) {
      const e = byProvider.get(b.structuring_provider)!;
      e.cost_usd += b.structuring_cost_usd ?? 0;
      e.tokens += b.structuring_tokens ?? 0;
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
