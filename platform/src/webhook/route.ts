/**
 * Webhook Routes — HTTP endpoints for webhook management.
 */
import type { FastifyInstance } from 'fastify';
import {
  createEndpoint, listEndpoints, toggleEndpoint, adminToggleEndpoint, removeEndpoint, getDeliveryLog,
  getAdminDeliveryLog, getAdminDeliveryStats, retryDelivery,
} from './service.js';
import { getWebhook } from './repository.js';
import { WEBHOOK_EVENTS } from './models/index.js';
import { validateBody, webhookCreateBodySchema } from '../shared/validation.js';
import { ValidationError } from '../shared/errors.js';
import { requireAdmin } from '../middleware/auth.js';

export async function webhookRoutes(app: FastifyInstance) {

  /** GET /api/webhooks — list webhook endpoints for the current user. */
  app.get('/api/webhooks', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const endpoints = await listEndpoints(req.appUser.user_id);
      return { success: true, data: endpoints, metadata: { availableEvents: WEBHOOK_EVENTS } };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  /** POST /api/webhooks — create a webhook endpoint. */
  app.post('/api/webhooks', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });

      const body = validateBody(webhookCreateBodySchema, req.body);

      const endpoint = await createEndpoint(req.appUser.user_id, body.url, body.events, body.description);
      return { success: true, data: endpoint };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** PATCH /api/webhooks/:id/toggle — enable/disable a webhook. */
  app.patch('/api/webhooks/:id/toggle', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });

      const { id } = req.params as { id: string };
      const body = req.body as { active: boolean };
      await toggleEndpoint(id, req.appUser.user_id, body.active);
      return { success: true };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/webhooks/:id/deliveries — recent delivery attempts for an endpoint. */
  app.get('/api/webhooks/:id/deliveries', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });

      const { id } = req.params as { id: string };
      const ep = await getWebhook(id);
      if (!ep || ep.user_id !== req.appUser.user_id) {
        return reply.code(404).send({ success: false, message: 'Webhook endpoint not found' });
      }

      const query = req.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const deliveries = await getDeliveryLog(id, Number.isFinite(limit) ? limit : 50);
      return { success: true, data: deliveries };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  /** DELETE /api/webhooks/:id — remove a webhook endpoint. */
  app.delete('/api/webhooks/:id', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });

      const { id } = req.params as { id: string };
      await removeEndpoint(id, req.appUser.user_id);
      return { success: true };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  // ─── Admin: cross-user webhook monitoring ─────────────────────────────

  /** GET /api/admin/webhooks/deliveries — all delivery attempts (admin only). */
  app.get('/api/admin/webhooks/deliveries', { preHandler: requireAdmin }, async (req) => {
    const query = req.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 100;
    const deliveries = await getAdminDeliveryLog(Number.isFinite(limit) ? limit : 100);
    return { success: true, data: deliveries };
  });

  /** GET /api/admin/webhooks/stats — success/fail aggregates last 7 days (admin only). */
  app.get('/api/admin/webhooks/stats', { preHandler: requireAdmin }, async () => {
    const stats = await getAdminDeliveryStats();
    return { success: true, data: stats };
  });

  /** POST /api/admin/webhooks/deliveries/:id/retry — retry a failed delivery (admin only). */
  app.post('/api/admin/webhooks/deliveries/:id/retry', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await retryDelivery(id);
      return { success: true, message: 'Retry scheduled' };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** PATCH /api/admin/webhooks/:id/toggle — pause or enable any user's endpoint (admin only). */
  app.patch('/api/admin/webhooks/:id/toggle', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const { id } = req.params as { id: string };
      const body = req.body as { active: boolean };
      await adminToggleEndpoint(id, req.appUser.user_id, body.active);
      return { success: true, message: body.active ? 'Enabled — failed events will retry' : 'Paused' };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });
}
