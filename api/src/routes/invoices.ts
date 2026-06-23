import type { FastifyInstance } from 'fastify';
import { mkdir } from 'node:fs/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { runExtraction } from '../extraction/run.js';
import { requestCancel } from '../extraction/cancel.js';
import { splitCost } from '../extraction/confidence.js';
import { ingestPdf, finalizeBatch, type IngestAcc } from '../extraction/ingest.js';
import { resolveSource } from '../lib/fetchSource.js';

const BATCH_SELECT = { select: { id: true, name: true } } as const;

export function buildWhere(q: Record<string, string>) {
  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.q) where.OR = [
    { vendorName: { contains: q.q, mode: 'insensitive' } },
    { invoiceNumber: { contains: q.q, mode: 'insensitive' } },
    { fileName: { contains: q.q, mode: 'insensitive' } },
  ];
  if (q.minTotal) where.totalAmount = { gte: Number(q.minTotal) };
  if (q.batchId) where.batchId = q.batchId;
  if (q.dateFrom || q.dateTo) where.invoiceDate = { ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}), ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}) };
  return where;
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.post('/api/invoices/upload', async (req, reply) => {
    await mkdir(env.uploadDir, { recursive: true });
    const acc: IngestAcc = { created: [], duplicates: [], rejected: [] };
    // One batch per upload request. Default name is a UTC timestamp; an optional
    // `batchName` form field (in any order) overrides it. Cleaned up if nothing lands.
    const defaultName = 'Upload ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const batch = await prisma.batch.create({ data: { name: defaultName } });
    for await (const part of (req as any).parts()) {
      if (part.type === 'field' && part.fieldname === 'batchName' && part.value) {
        await prisma.batch.update({ where: { id: batch.id }, data: { name: String(part.value) } });
        continue;
      }
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      await ingestPdf(buf, part.filename, batch.id, acc);
    }
    const finalBatch = await finalizeBatch(batch.id, acc.created.length);
    reply.code(201);
    return { ...acc, batchId: finalBatch?.id ?? null, batch: finalBatch };
  });

  app.post('/api/invoices/import', async (req, reply) => {
    const { sources, batchName } = (req.body ?? {}) as { sources?: unknown; batchName?: string };
    if (!Array.isArray(sources) || sources.length === 0 || !sources.every((s) => typeof s === 'string')) {
      return reply.code(400).send({ error: 'sources must be a non-empty string array' });
    }
    await mkdir(env.uploadDir, { recursive: true });
    const acc: IngestAcc = { created: [], duplicates: [], rejected: [] };
    const defaultName = 'Import ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const batch = await prisma.batch.create({ data: { name: batchName?.trim() || defaultName } });
    for (const source of sources as string[]) {
      try {
        const { buf, fileName } = await resolveSource(source);
        await ingestPdf(buf, fileName, batch.id, acc, source);
      } catch (e) {
        acc.rejected.push({ fileName: source, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    const finalBatch = await finalizeBatch(batch.id, acc.created.length);
    reply.code(201);
    return { ...acc, batchId: finalBatch?.id ?? null, batch: finalBatch };
  });

  app.get('/api/invoices', async (req) => {
    const q = req.query as Record<string, string>;
    const where = buildWhere(q);
    const sortMap: Record<string, string> = { status: 'status', vendor: 'vendorName', date: 'invoiceDate', confidence: 'confidence', total: 'totalAmount' };
    const dir: 'asc' | 'desc' = q.dir === 'asc' ? 'asc' : 'desc';
    const orderBy: any = q.sort && sortMap[q.sort] ? { [sortMap[q.sort]]: dir } : { createdAt: 'desc' };
    const invoices = await prisma.invoice.findMany({
      where, orderBy,
      include: {
        _count: { select: { lineItems: true } },
        // newest run carries the cost of the current extraction (ollama/local = 0)
        runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { costEstimate: true, pageCount: true, provider: true } },
        batch: BATCH_SELECT,
      },
    });
    return { invoices: invoices.map((i: any) => {
      const { _count, runs, ...rest } = i;
      const r = runs[0];
      const split = splitCost(r?.provider ?? rest.provider, r?.pageCount, r?.costEstimate);
      return { ...rest, itemCount: _count.lineItems, costEstimate: r?.costEstimate ?? null, ...split };
    }) };
  });

  app.get('/api/invoices/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const inv = await prisma.invoice.findUnique({ where: { id },
      include: { lineItems: { orderBy: { lineNumber: 'asc' } }, runs: { orderBy: { createdAt: 'desc' } }, batch: BATCH_SELECT } });
    if (!inv) return reply.code(404).send({ error: 'not found' });
    // Expose the extraction/structuring cost split for the active (or latest) run.
    const active = inv.runs.find((r) => r.id === inv.activeRunId) ?? inv.runs[0];
    const split = splitCost(active?.provider, active?.pageCount, active?.costEstimate);
    return { ...inv, costEstimate: active?.costEstimate ?? null, ...split };
  });

  app.post('/api/invoices/bulk', async (req) => {
    const { action, ids } = req.body as { action: 'reextract' | 'delete'; ids: string[] };
    if (action === 'delete') { await prisma.invoice.deleteMany({ where: { id: { in: ids } } }); return { ok: true, count: ids.length }; }
    for (const id of ids) { await prisma.invoice.update({ where: { id }, data: { status: 'PENDING', error: null } }); void runExtraction(id); }
    return { ok: true, count: ids.length };
  });

  app.post('/api/invoices/:id/reextract', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { provider } = (req.body ?? {}) as { provider?: string };
    await prisma.invoice.update({ where: { id }, data: { status: 'PENDING', error: null } });
    void runExtraction(id, provider);
    reply.code(202); return { ok: true };
  });

  app.post('/api/invoices/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cancelling = requestCancel(id); // aborts the in-flight run if it's in this process
    // Mark it FAILED only while still in flight, so a result that just landed isn't clobbered.
    await prisma.invoice.updateMany({
      where: { id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'FAILED', error: 'Cancelled by user' },
    });
    reply.code(202); return { ok: true, cancelling };
  });

  app.patch('/api/invoices/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const { lineItems, ...fields } = body;
    const data: any = { ...fields, verified: true, editedAt: new Date() };
    if (data.invoiceDate) data.invoiceDate = new Date(data.invoiceDate);
    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data });
      if (Array.isArray(lineItems)) {
        await tx.lineItem.deleteMany({ where: { invoiceId: id } });
        await tx.lineItem.createMany({ data: lineItems.map((li: any, i: number) => ({
          invoiceId: id, lineNumber: li.lineNumber ?? i + 1, description: li.description ?? null, sku: li.sku ?? null,
          quantity: li.quantity ?? null, unitPrice: li.unitPrice ?? null, amount: li.amount ?? null, taxRate: li.taxRate ?? null })) });
      }
    });
    return prisma.invoice.findUnique({ where: { id }, include: { lineItems: { orderBy: { lineNumber: 'asc' } }, runs: { orderBy: { createdAt: 'desc' } }, batch: BATCH_SELECT } });
  });

  app.post('/api/invoices/:id/apply-run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { runId } = req.body as { runId: string };
    const run = await prisma.extractionRun.findUnique({ where: { id: runId } });
    if (!run || run.invoiceId !== id) return reply.code(404).send({ error: 'run not found' });
    const fields = (run.fieldsSnapshot ?? {}) as any;
    const items = (run.itemsSnapshot ?? []) as any[];
    if (fields.invoiceDate) fields.invoiceDate = new Date(fields.invoiceDate);
    if (fields.dueDate) fields.dueDate = new Date(fields.dueDate);
    await prisma.$transaction(async (tx) => {
      await tx.lineItem.deleteMany({ where: { invoiceId: id } });
      await tx.lineItem.createMany({ data: items.map((li, i) => ({ invoiceId: id, lineNumber: li.lineNumber ?? i + 1,
        description: li.description ?? null, sku: li.sku ?? null, quantity: li.quantity ?? null, unitPrice: li.unitPrice ?? null,
        amount: li.amount ?? null, taxRate: li.taxRate ?? null })) });
      await tx.invoice.update({ where: { id }, data: { ...fields, provider: run.provider, confidence: run.confidence,
        status: 'COMPLETED', activeRunId: run.id, rawText: run.rawText, rawJson: run.rawJson as any } });
    });
    return prisma.invoice.findUnique({ where: { id }, include: { lineItems: { orderBy: { lineNumber: 'asc' } }, runs: { orderBy: { createdAt: 'desc' } }, batch: BATCH_SELECT } });
  });

  app.delete('/api/invoices/:id', async (req) => {
    await prisma.invoice.delete({ where: { id: (req.params as { id: string }).id } });
    return { ok: true };
  });

  app.post('/api/invoices/:id/bakeoff', async (req) => {
    const { id } = req.params as { id: string };
    const { bakeoffInvoice } = await import('../extraction/run.js');
    const runs = await bakeoffInvoice(id);
    return { runs };
  });
}
