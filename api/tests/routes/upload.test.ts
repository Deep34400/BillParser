import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { PDFDocument } from 'pdf-lib';
import * as run from '../../src/extraction/run.js';

async function pdf(): Promise<Buffer> { const d = await PDFDocument.create(); d.addPage(); return Buffer.from(await d.save()); }
function form(buf: Buffer, name: string) {
  const b = '----t'; const head = `--${b}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`;
  return { payload: Buffer.concat([Buffer.from(head), buf, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
beforeEach(async () => { await prisma.invoice.deleteMany(); vi.spyOn(run, 'runExtraction').mockResolvedValue(); });

it('creates an invoice and skips duplicate by hash', async () => {
  const app = await buildApp(); const buf = await pdf();
  const { payload, headers } = form(buf, 'x.pdf');
  const r1 = await app.inject({ method: 'POST', url: '/api/invoices/upload', payload, headers });
  expect(r1.statusCode).toBe(201);
  expect(r1.json().created).toHaveLength(1);
  const r2 = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form(buf, 'x.pdf') });
  expect(r2.json().created).toHaveLength(0);
  expect(r2.json().duplicates).toHaveLength(1);
  expect(await prisma.invoice.count()).toBe(1);
  await app.close();
});
it('rejects a non-pdf file', async () => {
  const app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form(Buffer.from('hello'), 'x.pdf') });
  expect(r.json().rejected).toHaveLength(1);
  await app.close();
});
