import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
it('exports header csv with content-type and rows', async () => {
  const app = await buildApp();
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 10 } });
  const res = await app.inject({ url: '/api/invoices/export/csv' });
  expect(res.headers['content-type']).toContain('text/csv');
  expect(res.body).toContain('vendorName');
  expect(res.body).toContain('Acme');
  await app.close();
});
it('exports line items csv', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h2', vendorName: 'Acme' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'Widget', amount: 5 } });
  const res = await app.inject({ url: '/api/invoices/export/line-items.csv' });
  expect(res.body).toContain('Widget');
  await app.close();
});
