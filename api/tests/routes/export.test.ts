import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
it('exports header csv with content-type and rows', async () => {
  const app = await buildApp();
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 10 } });
  const res = await app.inject({ url: '/api/invoices/export/csv' });
  expect(res.headers['content-type']).toContain('text/csv');
  expect(res.body).toContain('vendorName');
  expect(res.body).toContain('Acme');
  // GST breakdown columns present in the header row
  expect(res.body).toContain('discountAmount');
  expect(res.body).toContain('cgstAmount');
  expect(res.body).toContain('netAmount');
  await app.close();
});
it('exports line items csv with HSN/SAC', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h2', vendorName: 'Acme' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'Widget', hsnSac: '8409', amount: 5, labourAmount: 550 } });
  const res = await app.inject({ url: '/api/invoices/export/line-items.csv' });
  expect(res.body).toContain('Widget');
  expect(res.body).toContain('hsnSac');
  expect(res.body).toContain('8409');
  expect(res.body).toContain('labourAmount');
  expect(res.body).toContain('550');
  await app.close();
});
