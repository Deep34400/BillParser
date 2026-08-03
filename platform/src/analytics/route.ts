/**
 * Analytics Routes — thin HTTP controller.
 * Separate paginated endpoints for each view. 5-min server cache.
 */
import type { FastifyInstance } from 'fastify';
import {
  computeKpis, getVehicleSpend, getCostPerKm, getOcrCostSummary,
  type KpiResult, type VehicleSpendSummary, type CostPerKmResult, type OcrCostSummary,
} from './service.js';
import { cacheGet, cacheSet } from '../shared/cache.js';

const CACHE_TTL = 300_000;
const DEFAULT_LIMIT = 20;

function pagination(query: Record<string, string>) {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

export async function analyticsRoutes(app: FastifyInstance) {

  // KPIs — lightweight summary numbers only (no lists)
  app.get('/api/analytics/kpis', async () => {
    const cached = cacheGet<KpiResult>('analytics:kpis');
    if (cached) return {
      totalSpend: cached.totalSpend,
      completedCount: cached.completedCount,
      needsReview: cached.needsReview,
      totalParts: cached.totalParts,
      totalLabour: cached.totalLabour,
      totalTax: cached.totalTax,
      avgConfidence: cached.avgConfidence,
      vendorCount: cached.vendorCount,
      vehicleCount: cached.vehicleCount,
    };
    const result = await computeKpis();
    cacheSet('analytics:kpis', result, CACHE_TTL);
    return {
      totalSpend: result.totalSpend,
      completedCount: result.completedCount,
      needsReview: result.needsReview,
      totalParts: result.totalParts,
      totalLabour: result.totalLabour,
      totalTax: result.totalTax,
      avgConfidence: result.avgConfidence,
      vendorCount: result.vendorCount,
      vehicleCount: result.vehicleCount,
    };
  });

  // Workshops — paginated, with search
  app.get('/api/analytics/workshops', async (req) => {
    const qs = req.query as Record<string, string>;
    const q = qs.q?.toLowerCase();
    const { limit, offset } = pagination(qs);
    const cached = cacheGet<KpiResult>('analytics:kpis');
    const kpis = cached ?? await computeKpis();
    if (!cached) cacheSet('analytics:kpis', kpis, CACHE_TTL);
    let list = kpis.byVendor;
    if (q) list = list.filter((v) => v.name.toLowerCase().includes(q));
    return { workshops: list.slice(offset, offset + limit), total: list.length };
  });

  // Vehicles — paginated, with search
  app.get('/api/analytics/vehicles', async (req) => {
    const qs = req.query as Record<string, string>;
    const q = qs.q?.toLowerCase();
    const { limit, offset } = pagination(qs);
    const cacheKey = 'analytics:vehicles';
    let data = cacheGet<VehicleSpendSummary[]>(cacheKey);
    if (!data) {
      data = await getVehicleSpend();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    if (q) data = data.filter((v) => (v.registration_number ?? v.vehicle_id).toLowerCase().includes(q));
    return { vehicles: data.slice(offset, offset + limit), total: data.length };
  });

  // Months — paginated (usually small, ~24 months)
  app.get('/api/analytics/months', async (req) => {
    const qs = req.query as Record<string, string>;
    const { limit, offset } = pagination(qs);
    const cached = cacheGet<KpiResult>('analytics:kpis');
    const kpis = cached ?? await computeKpis();
    if (!cached) cacheSet('analytics:kpis', kpis, CACHE_TTL);
    return { months: kpis.byMonth.slice(offset, offset + limit), total: kpis.byMonth.length };
  });

  // Cost per km — paginated, with search
  app.get('/api/analytics/costkm', async (req) => {
    const qs = req.query as Record<string, string>;
    const q = qs.q?.toLowerCase();
    const { limit, offset } = pagination(qs);
    const cacheKey = 'analytics:costkm';
    let data = cacheGet<CostPerKmResult[]>(cacheKey);
    if (!data) {
      data = await getCostPerKm();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    if (q) {
      data = data.filter((v) =>
        (v.registration_number ?? '').toLowerCase().includes(q)
        || (v.vehicle_id ?? '').toLowerCase().includes(q));
    }
    return { costPerKm: data.slice(offset, offset + limit), total: data.length };
  });

  // API costs — small fixed response (no pagination needed)
  app.get('/api/analytics/costs', async () => {
    const cacheKey = 'analytics:costs';
    let data = cacheGet<OcrCostSummary>(cacheKey);
    if (!data) {
      data = await getOcrCostSummary();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    return data;
  });

  // Combined endpoint (deprecated — UI should use individual endpoints)
  app.get('/api/analytics', async () => {
    const kpis = await computeKpis();
    cacheSet('analytics:kpis', kpis, CACHE_TTL);
    const [vehicleSpend, costPerKm, ocrCosts] = await Promise.all([
      getVehicleSpend(), getCostPerKm(), getOcrCostSummary(),
    ]);
    return { ...kpis, vehicleSpend, costPerKm, ocrCosts };
  });

  app.get('/api/batches', async () => ({ batches: [] }));
}
