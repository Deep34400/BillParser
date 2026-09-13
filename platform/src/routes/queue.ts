import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import {
  OCR_QUEUE_NAME,
  getQueueInstance,
  isQueueInitialized,
} from '../queue/ocrQueue.js';

export async function queueRoutes(app: FastifyInstance) {
  /**
   * GET /api/queue/stats — pg-boss OCR queue monitoring.
   */
  app.get('/api/queue/stats', { preHandler: requireAdmin }, async () => {
    const boss = getQueueInstance();

    if (!isQueueInitialized() || !boss) {
      return {
        success: true,
        data: {
          initialized: false,
          queue: OCR_QUEUE_NAME,
          pending: 0,
          active: 0,
        },
      };
    }

    const pending = await boss.getQueueSize(OCR_QUEUE_NAME);
    const inFlight = await boss.getQueueSize(OCR_QUEUE_NAME, { before: 'completed' });
    const active = Math.max(0, inFlight - pending);

    return {
      success: true,
      data: {
        initialized: true,
        queue: OCR_QUEUE_NAME,
        pending,
        active,
      },
    };
  });
}
