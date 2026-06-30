import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/db.js';
import * as run from '../../src/extraction/run.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); vi.spyOn(run, 'runExtraction').mockResolvedValue(); });

it('reextract sets PENDING and calls runExtraction with provider', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'ha', status: 'COMPLETED' } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/reextract`, payload: { provider: 'azure' } });
  expect(res.statusCode).toBe(202);
  expect(run.runExtraction).toHaveBeenCalledWith(inv.id, 'azure');
  await app.close();
});
it('cancel marks an in-flight invoice FAILED with "Cancelled by user"', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hcancel', status: 'PROCESSING' } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/cancel` });
  expect(res.statusCode).toBe(202);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id } });
  expect(got!.status).toBe('FAILED');
  expect(got!.error).toBe('Cancelled by user');
  await app.close();
});
it('cancel does not clobber an already-completed invoice', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hdone', status: 'COMPLETED' } });
  await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/cancel` });
  const got = await prisma.invoice.findUnique({ where: { id: inv.id } });
  expect(got!.status).toBe('COMPLETED'); // unchanged
  await app.close();
});
it('patch edits fields, replaces items, marks verified', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hb' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'old', amount: 1 } });
  const res = await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: {
    vendorName: 'New Co', totalAmount: 200, lineItems: [{ lineNumber: 1, description: 'new', amount: 200 }] } });
  expect(res.statusCode).toBe(200);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: true } });
  expect(got!.vendorName).toBe('New Co'); expect(got!.verified).toBe(true); expect(got!.editedAt).not.toBeNull();
  expect(got!.lineItems[0].description).toBe('new');
  await app.close();
});
it('patch persists GST breakdown fields and per-line HSN/SAC', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hgst' } });
  const res = await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: {
    subtotal: 2666, discountAmount: 266.6, cgstAmount: 215.95, sgstAmount: 215.95, totalAmount: 2831.3, netAmount: 3997,
    lineItems: [
      { lineNumber: 1, description: 'Gasket', hsnSac: '8409', amount: 9.32 },
      { lineNumber: 2, description: 'OUT SIDE LABOUR', hsnSac: '998729', labourAmount: 550 },
    ] } });
  expect(res.statusCode).toBe(200);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: { orderBy: { lineNumber: 'asc' } } } });
  expect(got!.discountAmount).toBe(266.6);
  expect(got!.cgstAmount).toBe(215.95);
  expect(got!.sgstAmount).toBe(215.95);
  expect(got!.netAmount).toBe(3997);
  expect(got!.lineItems[0].hsnSac).toBe('8409');
  expect(got!.lineItems[1].labourAmount).toBe(550);
  await app.close();
});
it('patch persists the columnwise summary JSON', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hcols' } });
  const summaryColumns = [
    { label: 'Parts', subtotal: 70766.7, discount: 7076.72, igst: 11464.19, total: 75154.17 },
    { label: 'Labour', subtotal: 30450, discount: 10950, igst: 3510, total: 23010 },
  ];
  const res = await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: { netAmount: 98164, summaryColumns } });
  expect(res.statusCode).toBe(200);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id } });
  expect(got!.summaryColumns).toEqual(summaryColumns);
  await app.close();
});
it('apply-run copies a run snapshot onto the invoice', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hc' } });
  const run1 = await prisma.extractionRun.create({ data: { invoiceId: inv.id, provider: 'azure', status: 'COMPLETED', confidence: 0.9,
    fieldsSnapshot: { vendorName: 'Snap Co', totalAmount: 77 }, itemsSnapshot: [{ lineNumber: 1, description: 'snap', amount: 77 }] } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/apply-run`, payload: { runId: run1.id } });
  expect(res.statusCode).toBe(200);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: true } });
  expect(got!.vendorName).toBe('Snap Co'); expect(got!.activeRunId).toBe(run1.id); expect(got!.lineItems[0].description).toBe('snap');
  await app.close();
});
it('delete cascades, bulk delete removes many', async () => {
  const app = await buildApp();
  const a = await prisma.invoice.create({ data: { fileName: 'a', storedPath: '/a', fileHash: 'h1' } });
  const b = await prisma.invoice.create({ data: { fileName: 'b', storedPath: '/b', fileHash: 'h2' } });
  expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${a.id}` })).statusCode).toBe(200);
  await app.inject({ method: 'POST', url: '/api/invoices/bulk', payload: { action: 'delete', ids: [b.id] } });
  expect(await prisma.invoice.count()).toBe(0);
  await app.close();
});
