import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { env } from '../../src/env.js';

const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake test pdf\n');

beforeEach(async () => { await prisma.invoice.deleteMany(); await mkdir(env.uploadDir, { recursive: true }); });

it('serves the stored PDF inline as application/pdf', async () => {
  const app = await buildApp();
  const stored = join(env.uploadDir, 'file-test.pdf');
  await writeFile(stored, PDF_BYTES);
  const inv = await prisma.invoice.create({ data: { fileName: 'orig.pdf', storedPath: stored, fileHash: 'hfile', status: 'COMPLETED' } });
  const res = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}/file` });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(res.headers['content-disposition']).toContain('inline');
  expect(res.headers['content-disposition']).toContain('orig.pdf');
  expect(res.rawPayload.equals(PDF_BYTES)).toBe(true);
  await rm(stored, { force: true });
  await app.close();
});

it('404s for an unknown invoice id', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/invoices/does-not-exist/file' });
  expect(res.statusCode).toBe(404);
  await app.close();
});

it('404s when the stored file is missing on disk', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'gone.pdf', storedPath: join(env.uploadDir, 'absent.pdf'), fileHash: 'hgone', status: 'COMPLETED' } });
  const res = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}/file` });
  expect(res.statusCode).toBe(404);
  await app.close();
});
