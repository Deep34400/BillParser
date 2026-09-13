/**
 * Webhook Routes — HTTP endpoints for webhook management.
 */
import type { FastifyInstance } from 'fastify';
import { createEndpoint, listEndpoints, toggleEndpoint, removeEndpoint, getDeliveryLog } from './service.js';
import { getWebhook } from './repository.js';
import { WEBHOOK_EVENTS } from './models/index.js';

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

      const body = req.body as { url: string; events: string[]; description?: string };
      if (!body.url) return reply.code(400).send({ success: false, message: 'url is required' });
      if (!body.events?.length) return reply.code(400).send({ success: false, message: 'events array is required' });

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
}
