import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
it('aggregates totals, vendors, months, avg confidence, review count', async () => {
  const app = await buildApp();
  await prisma.invoice.createMany({ data: [
    { fileName: 'a', storedPath: '/a', fileHash: 'h1', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 100, confidence: 0.9, invoiceDate: new Date('2026-01-10') },
    { fileName: 'b', storedPath: '/b', fileHash: 'h2', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 50, confidence: 0.6, invoiceDate: new Date('2026-01-20') },
    { fileName: 'c', storedPath: '/c', fileHash: 'h3', status: 'COMPLETED', vendorName: 'Globex', totalAmount: 200, confidence: 0.95, invoiceDate: new Date('2026-02-02') },
  ] });
  const b = (await app.inject({ url: '/api/analytics' })).json();
  expect(b.totalSpend).toBe(350); expect(b.completedCount).toBe(3);
  expect(b.byVendor[0]).toMatchObject({ name: 'Globex', amount: 200 });
  expect(b.byMonth.find((m: any) => m.label === '2026-01').amount).toBe(150);
  expect(b.avgConfidence).toBeCloseTo((0.9 + 0.6 + 0.95) / 3, 2);
  expect(b.needsReview).toBe(1);
  await app.close();
});
