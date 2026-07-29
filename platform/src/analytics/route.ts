/**
 * Analytics Routes — thin HTTP controller.
 * All aggregation logic lives in service.ts. This file only handles:
 *   - Caching (server-side TTL)
 *   - Search filtering (query param)
 *   - Formatting the HTTP response
 */
import type { FastifyInstance } from 'fastify';
import {
  computeKpis, getVehicleSpend, getCostPerKm, getOcrCostSummary,
  type KpiResult, type VehicleSpendSummary, type CostPerKmResult, type OcrCostSummary,
} from './service.js';
import { cacheGet, cacheSet } from '../shared/cache.js';

const CACHE_TTL = 300_000; // 5 minutes — aggregation is expensive at scale

export async function analyticsRoutes(app: FastifyInstance) {

  app.get('/api/analytics/kpis', async () => {
    const cached = cacheGet<KpiResult>('analytics:kpis');
    if (cached) return cached;
    const result = await computeKpis();
    cacheSet('analytics:kpis', result, CACHE_TTL);
    return result;
  });

  app.get('/api/analytics/vehicles', async (req) => {
    const q = (req.query as Record<string, string>).q?.toLowerCase();
    const cacheKey = 'analytics:vehicles';
    let data = cacheGet<VehicleSpendSummary[]>(cacheKey);
    if (!data) {
      data = await getVehicleSpend();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    if (q) data = data.filter((v) => (v.registration_number ?? v.vehicle_id).toLowerCase().includes(q));
    return { vehicles: data };
  });

  app.get('/api/analytics/workshops', async (req) => {
    const q = (req.query as Record<string, string>).q?.toLowerCase();
    const cached = cacheGet<KpiResult>('analytics:kpis');
    const byVendor = cached ? cached.byVendor : (await computeKpis()).byVendor;
    const filtered = q ? byVendor.filter((v) => v.name.toLowerCase().includes(q)) : byVendor;
    return { workshops: filtered };
  });

  app.get('/api/analytics/months', async () => {
    const cached = cacheGet<KpiResult>('analytics:kpis');
    const byMonth = cached ? cached.byMonth : (await computeKpis()).byMonth;
    return { months: byMonth };
  });

  app.get('/api/analytics/costkm', async (req) => {
    const q = (req.query as Record<string, string>).q?.toLowerCase();
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
    return { costPerKm: data };
  });

  app.get('/api/analytics/costs', async () => {
    const cacheKey = 'analytics:costs';
    let data = cacheGet<OcrCostSummary>(cacheKey);
    if (!data) {
      data = await getOcrCostSummary();
      cacheSet(cacheKey, data, CACHE_TTL);
    }
    return data;
  });

  app.get('/api/analytics', async () => {
    const kpis = await computeKpis();
    const [vehicleSpend, costPerKm, ocrCosts] = await Promise.all([
      getVehicleSpend(), getCostPerKm(), getOcrCostSummary(),
    ]);
    return { ...kpis, vehicleSpend, costPerKm, ocrCosts };
  });

  app.get('/api/batches', async () => ({ batches: [] }));
}
