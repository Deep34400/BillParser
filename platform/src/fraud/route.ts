import type { FastifyInstance } from 'fastify';
import {
  detectDuplicateInvoices,
  detectGstAnomalies,
  detectPriceAnomalies,
  detectOdometerInconsistency,
  runAllChecks,
} from './service.js';
import { success, serverError } from '../shared/apiResponse.js';
import { cacheGet, cacheSet } from '../shared/cache.js';

const CACHE_TTL = 300_000; // 5 minutes

export async function fraudRoutes(app: FastifyInstance) {
  app.get('/api/fraud/scan', async (_req, reply) => {
    try {
      const cached = cacheGet<ReturnType<typeof runAllChecks> extends Promise<infer T> ? T : never>('fraud:scan');
      if (cached) return success(cached, `${cached.length} alert(s) found`, { total: cached.length, by_type: groupBy(cached, 'type'), by_severity: groupBy(cached, 'severity') });
      const alerts = await runAllChecks();
      cacheSet('fraud:scan', alerts, CACHE_TTL);
      return success(alerts, `${alerts.length} alert(s) found`, {
        total: alerts.length,
        by_type: groupBy(alerts, 'type'),
        by_severity: groupBy(alerts, 'severity'),
      });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/duplicates', async (_req, reply) => {
    try {
      const alerts = await detectDuplicateInvoices();
      return success(alerts, '', { total: alerts.length });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/gst-anomalies', async (_req, reply) => {
    try {
      const alerts = await detectGstAnomalies();
      return success(alerts, '', { total: alerts.length });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/price-anomalies', async (_req, reply) => {
    try {
      const alerts = await detectPriceAnomalies();
      return success(alerts, '', { total: alerts.length });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });

  app.get('/api/fraud/odometer', async (_req, reply) => {
    try {
      const alerts = await detectOdometerInconsistency();
      return success(alerts, '', { total: alerts.length });
    } catch (err) {
      return reply.code(500).send(serverError());
    }
  });
}

function groupBy<T>(items: T[], key: keyof T): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const k = String(item[key]);
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}
