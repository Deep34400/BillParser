import type { FastifyInstance } from 'fastify';
import { prisma } from '../config/db.js';
const THRESHOLD = 0.75;
export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics', async () => {
    const done = await prisma.invoice.findMany({ where: { status: 'COMPLETED' } });
    const totalSpend = done.reduce((s, i) => s + (i.totalAmount ?? 0), 0);
    const confs = done.map((i) => i.confidence).filter((c): c is number => typeof c === 'number');
    const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
    const needsReview = done.filter((i) => !i.verified && typeof i.confidence === 'number' && i.confidence < THRESHOLD).length;
    const vendorMap = new Map<string, number>();
    const monthMap = new Map<string, number>();
    for (const i of done) {
      if (i.vendorName) vendorMap.set(i.vendorName, (vendorMap.get(i.vendorName) ?? 0) + (i.totalAmount ?? 0));
      if (i.invoiceDate) { const k = i.invoiceDate.toISOString().slice(0, 7); monthMap.set(k, (monthMap.get(k) ?? 0) + (i.totalAmount ?? 0)); }
    }
    const byVendor = [...vendorMap].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8);
    const byMonth = [...monthMap].map(([label, amount]) => ({ label, amount })).sort((a, b) => a.label.localeCompare(b.label));
    return { totalSpend, completedCount: done.length, avgConfidence, needsReview, byVendor, byMonth };
  });
}
