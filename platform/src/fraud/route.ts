/**
 * Fraud Routes — paginated, cached, production-ready.
 *
 * GET /api/fraud/summary  — lightweight counts per check type (instant after first scan)
 * GET /api/fraud/scan     — full scan (populates cache for summary + individual endpoints)
 * GET /api/fraud/duplicates?limit=20&offset=0
 * GET /api/fraud/gst-anomalies?limit=20&offset=0
 * GET /api/fraud/price-anomalies?limit=20&offset=0
 * GET /api/fraud/odometer?limit=20&offset=0
 */
import type { FastifyInstance } from 'fastify';
import {
  detectDuplicateInvoices,
  detectGstAnomalies,
  detectPriceAnomalies,
  detectOdometerInconsistency,
  runAllChecks,
  type FraudAlert,
} from './service.js';
import { success, serverError } from '../shared/apiResponse.js';
import { cacheGet, cacheSet } from '../shared/cache.js';

const CACHE_TTL = 300_000; // 5 min — same as analytics
const DEFAULT_LIMIT = 20;

function pagination(query: Record<string, string>) {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

function paginate(alerts: FraudAlert[], limit: number, offset: number) {
  return { alerts: alerts.slice(offset, offset + limit), total: alerts.length };
}

function groupBy<T>(items: T[], key: keyof T): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const k = String(item[key]);
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}

export async function fraudRoutes(app: FastifyInstance) {

  // Summary — lightweight counts (no alert bodies). Instant if cache is warm.
  app.get('/api/fraud/summary', async (_req, reply) => {
    try {
      const cached = cacheGet<FraudAlert[]>('fraud:scan');
      if (cached) {
        return {
          total: cached.length,
          by_type: groupBy(cached, 'type'),
          by_severity: groupBy(cached, 'severity'),
          cached: true,
        };
      }
      const alerts = await runAllChecks();
      cacheSet('fraud:scan', alerts, CACHE_TTL);
      return {
        total: alerts.length,
        by_type: groupBy(alerts, 'type'),
        by_severity: groupBy(alerts, 'severity'),
        cached: false,
      };
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  // Full scan — runs all checks, populates cache, returns paginated results
  app.get('/api/fraud/scan', async (req, reply) => {
    try {
      const { limit, offset } = pagination(req.query as Record<string, string>);
      let alerts = cacheGet<FraudAlert[]>('fraud:scan');
      if (!alerts) {
        alerts = await runAllChecks();
        cacheSet('fraud:scan', alerts, CACHE_TTL);
      }
      const page = paginate(alerts, limit, offset);
      return success(page.alerts, `${page.total} alert(s) found`, {
        total: page.total,
        showing: page.alerts.length,
        offset,
        by_type: groupBy(alerts, 'type'),
        by_severity: groupBy(alerts, 'severity'),
      });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  // Individual endpoints — use cached full scan when available, else run specific check
  app.get('/api/fraud/duplicates', async (req, reply) => {
    try {
      const { limit, offset } = pagination(req.query as Record<string, string>);
      let alerts = getTypeFromCache('DUPLICATE_INVOICE');
      if (!alerts) alerts = await detectDuplicateInvoices();
      const page = paginate(alerts, limit, offset);
      return success(page.alerts, '', { total: page.total, showing: page.alerts.length, offset });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/gst-anomalies', async (req, reply) => {
    try {
      const { limit, offset } = pagination(req.query as Record<string, string>);
      let alerts = getTypeFromCache('GST_MISMATCH');
      if (!alerts) alerts = await detectGstAnomalies();
      const page = paginate(alerts, limit, offset);
      return success(page.alerts, '', { total: page.total, showing: page.alerts.length, offset });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/price-anomalies', async (req, reply) => {
    try {
      const { limit, offset } = pagination(req.query as Record<string, string>);
      let alerts = getTypeFromCache('PRICE_ANOMALY');
      if (!alerts) alerts = await detectPriceAnomalies();
      const page = paginate(alerts, limit, offset);
      return success(page.alerts, '', { total: page.total, showing: page.alerts.length, offset });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/odometer', async (req, reply) => {
    try {
      const { limit, offset } = pagination(req.query as Record<string, string>);
      let alerts = getTypeFromCache('ODOMETER_INCONSISTENCY');
      if (!alerts) alerts = await detectOdometerInconsistency();
      const page = paginate(alerts, limit, offset);
      return success(page.alerts, '', { total: page.total, showing: page.alerts.length, offset });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });
}

function getTypeFromCache(type: string): FraudAlert[] | null {
  const all = cacheGet<FraudAlert[]>('fraud:scan');
  if (!all) return null;
  return all.filter((a) => a.type === type);
}
