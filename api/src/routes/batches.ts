import type { FastifyInstance } from 'fastify';
import { prisma } from '../config/db.js';

// Per-batch processing roll-up: total invoices and how many are COMPLETED / FAILED /
// still in flight (PENDING or PROCESSING). Powers the batch dropdown + progress banner.
export async function batchesRoutes(app: FastifyInstance) {
  app.get('/api/batches', async () => {
    const batches = await prisma.batch.findMany({ orderBy: { createdAt: 'desc' } });
    const grouped = await prisma.invoice.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { not: null } },
      _count: { _all: true },
    });
    return {
      batches: batches.map((b) => {
        let total = 0, completed = 0, failed = 0, processing = 0;
        for (const g of grouped) {
          if (g.batchId !== b.id) continue;
          const c = g._count._all;
          total += c;
          if (g.status === 'COMPLETED') completed += c;
          else if (g.status === 'FAILED') failed += c;
          else processing += c; // PENDING or PROCESSING
        }
        return { id: b.id, name: b.name, createdAt: b.createdAt, total, completed, failed, processing };
      }),
    };
  });
}
