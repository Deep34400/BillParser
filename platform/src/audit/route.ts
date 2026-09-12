/**
 * Audit Routes — HTTP endpoints for querying audit logs.
 */
import type { FastifyInstance } from 'fastify';
import { getAuditLogs } from './service.js';

export async function auditRoutes(app: FastifyInstance) {

  /** GET /api/audit/logs — paginated audit log. */
  app.get('/api/audit/logs', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });

      const qs = req.query as Record<string, string | undefined>;
      const result = await getAuditLogs({
        orgId: req.orgId,
        userId: qs.userId,
        action: qs.action,
        resourceType: qs.resourceType,
        resourceId: qs.resourceId,
        limit: Number(qs.limit) || 50,
        offset: Number(qs.offset) || 0,
      });

      return { success: true, data: result.logs, metadata: { total: result.total } };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });
}
