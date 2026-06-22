import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../../src/db.js';
import { runExtraction, runExtractionWith } from '../../src/extraction/run.js';
import { requestCancel } from '../../src/extraction/cancel.js';
import { setCredentials, setSetting } from '../../src/settings/store.js';
import type { ExtractionProvider } from '../../src/providers/types.js';

let dir: string;
async function tempPdf(name: string): Promise<string> {
  const d = await PDFDocument.create(); d.addPage();
  const p = join(dir, name);
  await writeFile(p, Buffer.from(await d.save()));
  return p;
}

const fake: ExtractionProvider = {
  name: 'fake', displayName: 'Fake', kind: 'structured', requiredCredentials: [],
  isConfigured: () => true,
  async extract() {
    return { vendorName: 'Acme', totalAmount: 50, currency: 'USD', invoiceDate: '2026-02-01',
      lineItems: [{ lineNumber: 1, description: 'A', amount: 50 }], rawText: 'RAW', rawJson: { ok: true }, pageCount: 1 };
  },
};

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'ioc-run-')); });
beforeEach(async () => { await prisma.invoice.deleteMany(); });

it('cancellation aborts the run and marks the invoice FAILED with a clear message', async () => {
  const inv = await prisma.invoice.create({ data: { fileName: 'c.pdf', storedPath: await tempPdf('c.pdf'), fileHash: 'cancel-1' } });
  const slow: ExtractionProvider = {
    name: 'slow', displayName: 'Slow', kind: 'structured', requiredCredentials: [], isConfigured: () => true,
    async extract(_f, _c, ctx) {
      await new Promise((_resolve, reject) => {
        ctx.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      throw new Error('unreachable');
    },
  };
  const run = runExtractionWith(inv.id, slow, {});
  await new Promise((r) => setTimeout(r, 50)); // let it register + start
  expect(requestCancel(inv.id)).toBe(true);
  await run;
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { runs: true } });
  expect(got!.status).toBe('FAILED');
  expect(got!.error).toBe('Cancelled by user');
  expect(got!.runs.some((r) => r.status === 'FAILED')).toBe(true);
});

it('marks COMPLETED, applies fields, writes items + a run', async () => {
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: await tempPdf('a.pdf'), fileHash: 'h1' } });
  await runExtractionWith(inv.id, fake, {});
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: true, runs: true } });
  expect(got!.status).toBe('COMPLETED');
  expect(got!.vendorName).toBe('Acme'); expect(got!.totalAmount).toBe(50);
  expect(got!.lineItems).toHaveLength(1);
  expect(got!.runs).toHaveLength(1);
  expect(got!.confidence).toBeGreaterThan(0);
  expect(got!.activeRunId).toBe(got!.runs[0].id);
});

it('completes (does not fail) when a provider returns an unparseable date', async () => {
  const weird: ExtractionProvider = { ...fake, async extract() {
    return { vendorName: 'Acme', totalAmount: 50, invoiceDate: '29.01.2026', dueDate: 'not a date',
      lineItems: [], rawText: 'RAW', rawJson: {}, pageCount: 1 };
  } };
  const inv = await prisma.invoice.create({ data: { fileName: 'd.pdf', storedPath: await tempPdf('d.pdf'), fileHash: 'hdate' } });
  await runExtractionWith(inv.id, weird, {});
  const got = await prisma.invoice.findUnique({ where: { id: inv.id } });
  expect(got!.status).toBe('COMPLETED');
  expect(got!.invoiceDate).toBeNull();
  expect(got!.dueDate).toBeNull();
  expect(got!.vendorName).toBe('Acme');
});

it('marks FAILED with captured error on throw', async () => {
  const boom: ExtractionProvider = { ...fake, async extract() { throw new Error('provider down'); } };
  const inv = await prisma.invoice.create({ data: { fileName: 'b.pdf', storedPath: await tempPdf('b.pdf'), fileHash: 'h2' } });
  await runExtractionWith(inv.id, boom, {});
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { runs: true } });
  expect(got!.status).toBe('FAILED'); expect(got!.error).toContain('provider down');
  expect(got!.runs[0].status).toBe('FAILED');
});

it('re-extraction resolves to a configured provider when the default points at an unconfigured one', async () => {
  await prisma.providerConfig.deleteMany();
  await setCredentials('azure', { endpoint: 'https://example.invalid', apiKey: 'k' });
  await setSetting('extraction_provider', 'mistral'); // default, but mistral has no creds
  const inv = await prisma.invoice.create({ data: { fileName: 'rp.pdf', storedPath: await tempPdf('rp.pdf'), fileHash: 'resolve-1' } });
  await runExtraction(inv.id); // no explicit provider → should fall back to azure, not mistral
  const got = await prisma.invoice.findUnique({ where: { id: inv.id } });
  // azure is unreachable here so it FAILs, but it must have CHOSEN azure (the configured provider)
  expect(got!.provider).toBe('azure');
  expect(got!.error ?? '').not.toContain('No credentials configured');
});

it('marks FAILED (does not throw) when the active provider has no credentials', async () => {
  await prisma.providerConfig.deleteMany();
  await prisma.setting.deleteMany(); // default provider resolves to 'ollama', which has no creds here
  const inv = await prisma.invoice.create({ data: { fileName: 'nc.pdf', storedPath: await tempPdf('nc.pdf'), fileHash: 'nocreds-1' } });
  await runExtraction(inv.id); // must resolve, not reject
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { runs: true } });
  expect(got!.status).toBe('FAILED');
  expect(got!.error ?? '').toContain('No credentials configured');
  expect(got!.runs.some((r) => r.status === 'FAILED')).toBe(true);
});
