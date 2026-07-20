import type { FastifyInstance } from 'fastify';
import { listBills } from '../models/bills.js';
import {
  getVehicleSpend,
  getCostPerKm,
  getOcrCostSummary,
} from '../services/analytics/analyticsService.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { isJunkVendorName } from '../billing/vendorExtract.js';

const CACHE_TTL = 30_000;

/**
 * Compute KPI + vendor + month from bills (no extra DB call).
 */
function computeKpis(bills: import('../models/types.js').BillDoc[]) {
  let totalSpend = 0, completedCount = 0, confidenceSum = 0, needsReview = 0;
  let totalParts = 0, totalLabour = 0, totalTax = 0;
  const vendorTotals = new Map<string, number>();
  const monthTotals = new Map<string, number>();

  for (const bill of bills) {
    if (bill.ocr_status === 'OCR_COMPLETED' || bill.ocr_status === 'VERIFIED') {
      completedCount++;
      const amount = bill.grand_total_amount ?? 0;
      totalSpend += amount;
      totalParts += bill.parts_amount ?? 0;
      totalLabour += bill.labour_amount ?? 0;
      totalTax += bill.total_tax_amount ?? 0;
      if (bill.confidence_score != null) confidenceSum += bill.confidence_score;
      if ((bill.confidence_score ?? 1) < 0.75 && bill.ocr_status !== 'VERIFIED') needsReview++;

      const vendor = bill.vendor_name ?? bill.company_name ?? 'Unknown';
      // Skip junk names (raw JSON blobs, "Invoice" titles) so analytics stay clean
      if (!isJunkVendorName(vendor)) {
        vendorTotals.set(vendor, (vendorTotals.get(vendor) ?? 0) + amount);
      }

      if (bill.invoice_date) {
        const mk = bill.invoice_date.slice(0, 7);
        monthTotals.set(mk, (monthTotals.get(mk) ?? 0) + amount);
      }
    }
  }

  return {
    totalSpend, completedCount, needsReview, totalParts, totalLabour, totalTax,
    avgConfidence: completedCount > 0 ? Math.round((confidenceSum / completedCount) * 100) / 100 : 0,
    byVendor: Array.from(vendorTotals.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    byMonth: Array.from(monthTotals.entries()).map(([label, amount]) => ({ label, amount })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export async function analyticsRoutes(app: FastifyInstance) {
  /**
   * GET /api/analytics/kpis — KPIs + vendor list + month list (fast, cached).
   */
  app.get('/api/analytics/kpis', async () => {
    const cached = cacheGet<ReturnType<typeof computeKpis> & { vendorCount: number; vehicleCount: number }>('analytics:kpis');
    if (cached) return cached;

    const bills = await listBills({ limit: 10000 });
    const kpis = computeKpis(bills);
    const vehicleIds = new Set<string>();
    for (const b of bills) {
      const vid = b.vehicle_id ?? b.registration_number;
      if (vid) vehicleIds.add(vid);
    }
    const result = { ...kpis, vendorCount: kpis.byVendor.length, vehicleCount: vehicleIds.size };
    cacheSet('analytics:kpis', result, CACHE_TTL);
    return result;
  });

  /**
   * GET /api/analytics/vehicles — vehicle spend breakdown.
   */
  app.get('/api/analytics/vehicles', async (req) => {
    const q = (req.query as Record<string, string>).q?.toLowerCase();
    const cacheKey = 'analytics:vehicles';
    let data = cacheGet<Awaited<ReturnType<typeof getVehicleSpend>>>(cacheKey);
    if (!data) {
      data = await getVehicleSpend();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    if (q) data = data.filter((v) => (v.registration_number ?? v.vehicle_id).toLowerCase().includes(q));
    return { vehicles: data };
  });

  /**
   * GET /api/analytics/workshops — workshop/vendor breakdown.
   */
  app.get('/api/analytics/workshops', async (req) => {
    const q = (req.query as Record<string, string>).q?.toLowerCase();
    const cached = cacheGet<ReturnType<typeof computeKpis>>('analytics:kpis');
    let byVendor: { name: string; amount: number }[];
    if (cached) {
      byVendor = cached.byVendor;
    } else {
      const bills = await listBills({ limit: 10000 });
      byVendor = computeKpis(bills).byVendor;
    }
    if (q) byVendor = byVendor.filter((v) => v.name.toLowerCase().includes(q));
    return { workshops: byVendor };
  });

  /**
   * GET /api/analytics/months — monthly spend.
   */
  app.get('/api/analytics/months', async () => {
    const cached = cacheGet<ReturnType<typeof computeKpis>>('analytics:kpis');
    if (cached) return { months: cached.byMonth };
    const bills = await listBills({ limit: 10000 });
    return { months: computeKpis(bills).byMonth };
  });

  /**
   * GET /api/analytics/costkm — cost per km.
   */
  app.get('/api/analytics/costkm', async () => {
    const cacheKey = 'analytics:costkm';
    let data = cacheGet<Awaited<ReturnType<typeof getCostPerKm>>>(cacheKey);
    if (!data) {
      data = await getCostPerKm();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    return { costPerKm: data };
  });

  /**
   * GET /api/analytics/costs — OCR cost summary.
   */
  app.get('/api/analytics/costs', async () => {
    const cacheKey = 'analytics:costs';
    let data = cacheGet<Awaited<ReturnType<typeof getOcrCostSummary>>>(cacheKey);
    if (!data) {
      data = await getOcrCostSummary();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    return data;
  });

  /**
   * GET /api/analytics — legacy combined endpoint (kept for backward compat).
   * Now just calls the individual functions with cache.
   */
  app.get('/api/analytics', async () => {
    const bills = await listBills({ limit: 10000 });
    const kpis = computeKpis(bills);
    const vehicleIds = new Set<string>();
    for (const b of bills) { const vid = b.vehicle_id ?? b.registration_number; if (vid) vehicleIds.add(vid); }

    const [vehicleSpend, costPerKm, ocrCosts] = await Promise.all([
      getVehicleSpend(), getCostPerKm(), getOcrCostSummary(),
    ]);

    return {
      ...kpis,
      vendorCount: kpis.byVendor.length,
      vehicleCount: vehicleIds.size,
      vehicleSpend,
      costPerKm,
      ocrCosts,
    };
  });

  app.get('/api/batches', async () => ({ batches: [] }));
}
