import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
async function seed() {
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'ha', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 100, invoiceDate: new Date('2026-01-05') } });
  await prisma.invoice.create({ data: { fileName: 'b.pdf', storedPath: '/b', fileHash: 'hb', status: 'FAILED', vendorName: 'Globex', totalAmount: 50, invoiceDate: new Date('2026-02-05') } });
}
it('lists, filters by status, searches by vendor, sorts by total', async () => {
  const app = await buildApp(); await seed();
  expect((await app.inject({ url: '/api/invoices' })).json().invoices).toHaveLength(2);
  expect((await app.inject({ url: '/api/invoices?status=FAILED' })).json().invoices).toHaveLength(1);
  expect((await app.inject({ url: '/api/invoices?q=acme' })).json().invoices[0].vendorName).toBe('Acme');
  const sorted = (await app.inject({ url: '/api/invoices?sort=total&dir=desc' })).json().invoices;
  expect(sorted[0].totalAmount).toBe(100);
  await app.close();
});
it('detail returns line items + run summaries', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'c.pdf', storedPath: '/c', fileHash: 'hc' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'X', amount: 5 } });
  const res = await app.inject({ url: `/api/invoices/${inv.id}` });
  expect(res.json().lineItems).toHaveLength(1);
  expect(res.json()).toHaveProperty('runs');
  expect((await app.inject({ url: '/api/invoices/nope' })).statusCode).toBe(404);
  await app.close();
});
