import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { PDFDocument } from 'pdf-lib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as run from '../../src/extraction/run.js';

async function pdfBytes(tag: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  const p = d.addPage();
  p.drawText(tag);
  return Buffer.from(await d.save());
}

let dir: string;
beforeEach(async () => {
  await prisma.invoice.deleteMany();
  await prisma.batch.deleteMany();
  vi.spyOn(run, 'runExtraction').mockResolvedValue();
  dir = mkdtempSync(join(tmpdir(), 'imp-'));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.IMPORT_DIR; rmSync(dir, { recursive: true, force: true }); });

function mockFetchReturning(buf: Buffer) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })));
}

async function importReq(app: any, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/invoices/import', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

it('imports from an https URL into a named batch', async () => {
  mockFetchReturning(await pdfBytes('url-a'));
  const app = await buildApp();
  const r = await importReq(app, { sources: ['https://example.com/a.pdf'], batchName: 'From URLs' });
  const body = r.json();
  expect(r.statusCode).toBe(201);
  expect(body.created).toHaveLength(1);
  expect(body.batch.name).toBe('From URLs');
  expect(body.created[0].batchId).toBe(body.batchId);
  await app.close();
});

it('imports a local file inside IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  writeFileSync(join(dir, 'local.pdf'), await pdfBytes('file-a'));
  const app = await buildApp();
  const r = await importReq(app, { sources: ['local.pdf'] });
  expect(r.json().created).toHaveLength(1);
  await app.close();
});

it('rejects a non-PDF URL with a reason and creates no invoice', async () => {
  mockFetchReturning(Buffer.from('not a pdf'));
  const app = await buildApp();
  const r = await importReq(app, { sources: ['https://example.com/x.pdf'] });
  expect(r.json().created).toHaveLength(0);
  expect(r.json().rejected[0]).toMatchObject({ fileName: 'https://example.com/x.pdf', reason: 'not a PDF' });
  expect(await prisma.batch.count()).toBe(0); // empty batch cleaned up
  await app.close();
});

it('rejects a path that escapes IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  const app = await buildApp();
  const r = await importReq(app, { sources: ['../../etc/passwd.pdf'] });
  expect(r.json().rejected[0].reason).toMatch(/path outside IMPORT_DIR/);
  await app.close();
});

it('reports a duplicate when the hash already exists', async () => {
  const buf = await pdfBytes('dup');
  mockFetchReturning(buf);
  const app = await buildApp();
  await importReq(app, { sources: ['https://example.com/a.pdf'] }); // first import
  mockFetchReturning(buf); // same bytes again
  const r = await importReq(app, { sources: ['https://example.com/a.pdf'] });
  expect(r.json().created).toHaveLength(0);
  expect(r.json().duplicates).toHaveLength(1);
  await app.close();
});

it('returns 400 when sources is missing or empty', async () => {
  const app = await buildApp();
  expect((await importReq(app, {})).statusCode).toBe(400);
  expect((await importReq(app, { sources: [] })).statusCode).toBe(400);
  await app.close();
});
