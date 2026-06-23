import { it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { PDFDocument } from 'pdf-lib';
import * as run from '../../src/extraction/run.js';

async function pdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const page = d.addPage();
  // Draw a unique string so each call produces a distinct PDF (and thus a distinct hash).
  page.drawText(String(Date.now()) + '-' + String(Math.random()), { x: 10, y: 10, size: 8 });
  return Buffer.from(await d.save());
}

// Build a multipart body with an optional batchName field followed by N file parts.
function form(files: { buf: Buffer; name: string }[], batchName?: string) {
  const b = '----t';
  const chunks: Buffer[] = [];
  if (batchName !== undefined) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="batchName"\r\n\r\n${batchName}\r\n`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/pdf\r\n\r\n`));
    chunks.push(f.buf);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

beforeEach(async () => {
  await prisma.invoice.deleteMany();
  await prisma.batch.deleteMany();
  vi.spyOn(run, 'runExtraction').mockResolvedValue();
});

it('creates an invoice and skips duplicate by hash', async () => {
  const app = await buildApp(); const buf = await pdf();
  const r1 = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) });
  expect(r1.statusCode).toBe(201);
  expect(r1.json().created).toHaveLength(1);
  const r2 = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) });
  expect(r2.json().created).toHaveLength(0);
  expect(r2.json().duplicates).toHaveLength(1);
  expect(await prisma.invoice.count()).toBe(1);
  await app.close();
});

it('rejects a non-pdf file', async () => {
  const app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: Buffer.from('hello'), name: 'x.pdf' }]) });
  expect(r.json().rejected).toHaveLength(1);
  await app.close();
});

it('creates one batch and tags every created invoice with it', async () => {
  const app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: await pdf(), name: 'a.pdf' }, { buf: await pdf(), name: 'b.pdf' }]) });
  const body = r.json();
  expect(body.created).toHaveLength(2);
  expect(body.batchId).toBeTruthy();
  expect(await prisma.batch.count()).toBe(1);
  const invs = await prisma.invoice.findMany();
  expect(invs.every((i) => i.batchId === body.batchId)).toBe(true);
  await app.close();
});

it('uses the batchName field as the batch name, else a default', async () => {
  const app = await buildApp();
  const named = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: await pdf(), name: 'a.pdf' }], 'April bills') });
  expect(named.json().batch.name).toBe('April bills');
  expect((await prisma.batch.findUnique({ where: { id: named.json().batchId } }))!.name).toBe('April bills');

  const unnamed = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: await pdf(), name: 'b.pdf' }]) });
  expect((await prisma.batch.findUnique({ where: { id: unnamed.json().batchId } }))!.name).toMatch(/^Upload /);
  await app.close();
});

it('leaves no empty batch when every file is a duplicate', async () => {
  const app = await buildApp(); const buf = await pdf();
  await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) }); // 1 invoice, 1 batch
  const before = await prisma.batch.count();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) }); // duplicate
  expect(r.json().created).toHaveLength(0);
  expect(await prisma.batch.count()).toBe(before); // the new (empty) batch was deleted
  await app.close();
});
