/**
 * Vendor Routes — thin controller for the Vendor Registry.
 * All business logic lives in vendorService.ts.
 */
import type { FastifyInstance } from 'fastify';
import { getVendor, listVendors, searchVendors } from './vendorRepository.js';

export async function vendorRoutes(app: FastifyInstance) {
  /** GET /api/vendors — list all vendors (sorted by invoice_count desc). */
  app.get('/api/vendors', async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    if (q && q.trim().length > 0) {
      const results = await searchVendors(q.trim(), Number(limit) || 20);
      return { vendors: results };
    }
    const vendors = await listVendors({ limit: Number(limit) || 100 });
    return { vendors };
  });

  /** GET /api/vendors/:id — single vendor detail. */
  app.get('/api/vendors/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const vendor = await getVendor(id);
    if (!vendor) return reply.code(404).send({ error: 'Vendor not found' });
    return { vendor };
  });
}
