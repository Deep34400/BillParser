/**
 * Invoice Routes — thin HTTP controller layer.
 *
 * Each handler does three things:
 *   1. Extract and validate request params
 *   2. Call the service
 *   3. Return the response
 *
 * All business logic lives in service/invoiceService.ts.
 * All CSV generation lives in service/exportService.ts.
 * Errors thrown by services are caught by the global error handler.
 */
import type { FastifyInstance } from 'fastify';
import {
  listInvoices, getStatusCounts, getInvoice, getInvoiceForUi, getInvoiceForApi,
  getInvoiceFile, uploadInvoices, importFromUrls, reextractInvoice, cancelInvoice,
  processDraft, updateInvoice, deleteInvoice, bulkAction, reconcileRange,
  statelessParse, syncOcr, asyncOcr,
  submitForApproval, approveInvoice, rejectInvoice,
  type UploadedFile,
} from './service/invoiceService.js';
import { exportInvoicesCsv, exportLineItemsCsv, exportFilteredInvoicesExcel } from './service/exportService.js';
import { getComments, addComment } from './commentRepository.js';
import { getBill } from './repository.js';
import { bearerFromRequest } from '../middleware/auth.js';
import { isPdf, isImage } from '../shared/storage.js';
import { ValidationError } from '../shared/errors.js';
import { expandZip, isZip } from './service/expandZip.js';
import { startBatch, listUserBatches, getBatchDetail, MAX_BATCH_FILES } from './service/batchService.js';
import { compareByIds, compareByJson } from './compare/compareInvoices.js';
import {
  validateBody,
  validateQuery,
  commentBodySchema,
  invoiceUpdateBodySchema,
  invoiceExportQuerySchema,
} from '../shared/validation.js';
import type { BillStatus } from '../shared/types.js';

function billOwnerFilter(req: { appUser?: { user_id: string; role: string } | null }): string | undefined {
  if (!req.appUser || req.appUser.role === 'admin') return undefined;
  return req.appUser.user_id;
}

function parseExportFilters(qs: ReturnType<typeof invoiceExportQuerySchema.parse>, userId?: string) {
  const needsReview = qs.needsReview === '1' || qs.needsReview === 'true';
  const completed = qs.completed === '1' || qs.completed === 'true';
  const status = qs.status as BillStatus | undefined;
  const reviewCode = qs.review_code?.trim() || undefined;
  const minTotalRaw = qs.minTotal?.trim();
  const minTotal = minTotalRaw ? Number(minTotalRaw) : undefined;

  return {
    status: needsReview || reviewCode ? 'NEED_REVIEW' as const : (completed ? undefined : status),
    statuses: completed ? (['OCR_COMPLETED', 'VERIFIED'] as BillStatus[]) : undefined,
    reviewCode,
    q: qs.q?.trim().toLowerCase(),
    userId,
    dateFrom: qs.dateFrom?.trim() || undefined,
    dateTo: qs.dateTo?.trim() || undefined,
    minTotal: minTotal !== undefined && Number.isFinite(minTotal) ? minTotal : undefined,
  };
}

export async function billRoutes(app: FastifyInstance) {

  // ── Invoice List & Counts ───────────────────────────────────────────────

  app.get('/api/invoices', async (req, reply) => {
    try {
      const qs = req.query as Record<string, string | undefined>;
      return await listInvoices({
        page: qs.page !== undefined ? Number(qs.page) || undefined : undefined,
        pageSize: Number(qs.pageSize) || undefined,
        cursor: qs.cursor,
        status: qs.status,
        q: qs.q,
        needsReview: qs.needsReview === '1' || qs.needsReview === 'true',
        completed: qs.completed === '1' || qs.completed === 'true',
        reviewCode: qs.review_code,
        minTotal: qs.minTotal !== undefined ? Number(qs.minTotal) : undefined,
        maxTotal: qs.maxTotal !== undefined ? Number(qs.maxTotal) : undefined,
        dateFrom: qs.dateFrom,
        dateTo: qs.dateTo,
        vendor: qs.vendor,
        batchId: qs.batchId,
        userId: billOwnerFilter(req),
      });
    } catch (err) {
      req.log.error(err, 'Failed to list invoices');
      return reply.code(500).send({ error: 'Failed to list invoices', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/batches', async (req) => {
    const userId = req.appUser?.role === 'admin' ? undefined : req.appUser?.user_id;
    return await listUserBatches(userId);
  });

  app.get('/api/invoices/batch/:batchId', async (req) => {
    const { batchId } = req.params as { batchId: string };
    const userId = billOwnerFilter(req);
    return await getBatchDetail(batchId, userId);
  });

  app.post('/api/invoices/batch/:batchId/retry-failed', async (req) => {
    const { batchId } = req.params as { batchId: string };
    const userId = billOwnerFilter(req);
    const detail = await getBatchDetail(batchId, userId);
    const failed = detail.invoices.filter((inv) => inv.status === 'FAILED').map((inv) => inv.id);
    if (failed.length) await bulkAction('reextract', failed, req.appUser?.user_id);
    return { success: true, retried: failed.length };
  });

  app.get('/api/invoices/compare', async (req) => {
    const qs = req.query as { id1?: string; id2?: string; ai?: string; provider?: string; model?: string };
    if (!qs.id1 || !qs.id2) throw new ValidationError('id1 and id2 are required');
    const data = await compareByIds(
      qs.id1,
      qs.id2,
      billOwnerFilter(req),
      qs.ai !== '0' && qs.ai !== 'false',
      { provider: qs.provider, model: qs.model },
    );
    return { success: true, data };
  });

  app.post('/api/invoices/compare', async (req, reply) => {
    if (!req.appUser) {
      return reply.status(401).send({ success: false, message: 'Authentication required' });
    }
    const contentType = String(req.headers['content-type'] ?? '');
    const useAi = (v: unknown) => v !== '0' && v !== false && v !== 'false';

    if (contentType.includes('multipart/form-data')) {
      const files: UploadedFile[] = [];
      let ai = true;
      for await (const part of (req as any).parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          files.push({ buf, name: part.filename || 'invoice.pdf' });
        } else if (part.fieldname === 'ai') {
          const val = (await part.value) as string;
          ai = useAi(val);
        }
      }
      if (files.length !== 2) throw new ValidationError('Upload exactly two PDF or image files');
      const result = await uploadInvoices(files, req.appUser.user_id);
      return {
        success: true,
        data: {
          status: 'processing',
          invoiceA: { id: result.created[0] ?? null },
          invoiceB: { id: result.created[1] ?? null },
          rejected: result.rejected,
        },
      };
    }

    const body = (req.body ?? {}) as {
      mode?: string;
      id1?: string;
      id2?: string;
      left?: unknown;
      right?: unknown;
      ai?: boolean | string;
      compareProvider?: string;
      compareModel?: string;
    };
    const ai = useAi(body.ai ?? true);
    const model = { provider: body.compareProvider, model: body.compareModel };
    if (body.mode === 'json' || (body.left && body.right)) {
      const data = await compareByJson(body.left, body.right, ai, model);
      return { success: true, data };
    }
    if (!body.id1 || !body.id2) throw new ValidationError('Provide id1+id2, left+right JSON, or two files');
    const data = await compareByIds(body.id1, body.id2, billOwnerFilter(req), ai, model);
    return { success: true, data };
  });

  app.get('/api/invoices/counts', async (_req, reply) => {
    try {
      return { counts: await getStatusCounts() };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to count invoices' });
    }
  });

  // ── Reconcile Range ─────────────────────────────────────────────────────

  app.post('/api/invoices/reconcile-range', async (req, reply) => {
    try {
      if (!req.appUser) {
        return reply.status(401).send({ success: false, message: 'API key or session token required' });
      }

      const qs = req.query as Record<string, string | undefined>;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const startDate = String(body.start_date ?? qs.start_date ?? '').trim();
      const endDate = String(body.end_date ?? qs.end_date ?? '').trim();
      const modeRaw = String(body.mode ?? qs.mode ?? 'check').toLowerCase();
      const includeVerified = body.include_verified === true
        || body.include_verified === '1'
        || qs.include_verified === '1'
        || qs.include_verified === 'true';
      const statusRaw = body.status ?? qs.status;
      const status: string | null = statusRaw == null || statusRaw === ''
        ? null
        : Array.isArray(statusRaw)
          ? statusRaw.map(String).join(',')
          : String(statusRaw);

      const data = await reconcileRange({
        startDate,
        endDate,
        mode: modeRaw === 'update' ? 'update' : 'check',
        includeVerified,
        status,
      });

      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/start_date|end_date|Invalid|status filter/i.test(msg)) {
        return reply.code(400).send({ success: false, message: msg });
      }
      req.log.error(err, 'reconcile-range failed');
      return reply.code(500).send({ success: false, message: msg });
    }
  });

  // ── Invoice Comments ────────────────────────────────────────────────────

  app.get('/api/invoices/:id/comments', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const ownerId = billOwnerFilter(req);
      const bill = await getBill(id, ownerId);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });
      const comments = await getComments(id);
      return comments;
    } catch (err) {
      req.log.error(err, 'Failed to list comments');
      return reply.code(500).send({ error: 'Failed to list comments' });
    }
  });

  app.post('/api/invoices/:id/comments', async (req, reply) => {
    try {
      if (!req.appUser) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      const { id } = req.params as { id: string };
      const ownerId = billOwnerFilter(req);
      const bill = await getBill(id, ownerId);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });

      const body = validateBody(commentBodySchema, req.body);

      const comment = await addComment(id, req.appUser.user_id, body.text.trim());
      return reply.code(201).send(comment);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      req.log.error(err, 'Failed to add comment');
      return reply.code(500).send({ error: 'Failed to add comment' });
    }
  });

  // ── Single Invoice Detail ──────────────────────────────────────────────

  app.get('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const ownerId = billOwnerFilter(req);
      const bill = await getInvoice(id, ownerId);

      const token = bearerFromRequest(req);
      const isApiKey = !!token?.startsWith('inv_');

      if (isApiKey) {
        return { success: true, data: await getInvoiceForApi(bill) };
      }

      return await getInvoiceForUi(id, ownerId);
    } catch (err) {
      if ((err as any)?.statusCode === 404) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }
      return reply.code(500).send({ error: 'Failed to get invoice' });
    }
  });

  // ── File Serving ───────────────────────────────────────────────────────

  app.get('/api/invoices/:id/file', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const fileResult = await getInvoiceFile(id, billOwnerFilter(req));

      if ('redirect' in fileResult) {
        return reply.redirect(fileResult.redirect);
      }

      return reply
        .header('Content-Type', fileResult.contentType)
        .header('Content-Disposition', `inline; filename="${fileResult.fileName}.pdf"`)
        .send(fileResult.buf);
    } catch (err) {
      if ((err as any)?.statusCode === 404) {
        return reply.code(404).send({ error: 'File not found' });
      }
      return reply.code(500).send({ error: 'Failed to get file' });
    }
  });

  // ── Upload ─────────────────────────────────────────────────────────────

  app.post('/api/invoices/upload', async (req, reply) => {
    try {
      if (!req.appUser) {
        return reply.status(401).send({ success: false, message: 'Authentication required' });
      }
      if (req.appUser.role !== 'admin' && req.appUser.token_balance <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance — contact admin to add balance' });
      }

      const files: UploadedFile[] = [];
      let batchName = '';
      for await (const part of (req as any).parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          files.push({ buf, name: part.filename || 'invoice.pdf' });
        } else if (part.fieldname === 'batchName') {
          batchName = String((await part.value) ?? '');
        }
      }

      if (files.length === 0) {
        throw new ValidationError('At least one file is required');
      }

      const invoices: UploadedFile[] = [];
      const zipRejected: { name: string; reason: string }[] = [];
      let zipCount = 0;
      for (const file of files) {
        if (isZip(file.buf) || /\.zip$/i.test(file.name)) {
          zipCount += 1;
          const expanded = expandZip(file.buf);
          invoices.push(...expanded.files);
          zipRejected.push(...expanded.rejected);
        } else {
          invoices.push(file);
        }
      }

      if (invoices.length > MAX_BATCH_FILES) {
        throw new ValidationError(`At most ${MAX_BATCH_FILES} invoices per batch (got ${invoices.length} after unzip)`);
      }
      if (invoices.length === 0) {
        throw new ValidationError(zipRejected[0]?.reason || 'No PDF or image invoices found');
      }

      const source = zipCount === files.length ? 'zip' : zipCount > 0 ? 'mixed' : 'files';
      const batch = await startBatch(req.appUser.user_id, batchName, source, invoices.length);
      const result = await uploadInvoices(invoices, req.appUser.user_id, { batchId: batch.id });
      return {
        ...result,
        rejected: [...zipRejected, ...result.rejected],
        batchId: batch.id,
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ success: false, message: err.message });
      }
      return reply.code(500).send({ error: 'Upload failed' });
    }
  });

  // ── Import from URLs ──────────────────────────────────────────────────

  app.post('/api/invoices/import', async (req, reply) => {
    try {
      if (!req.appUser) {
        return reply.status(401).send({ success: false, message: 'Authentication required' });
      }
      if (req.appUser.role !== 'admin' && (req.appUser.token_balance ?? 0) <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance — contact admin to add balance' });
      }
      const body = req.body as { sources?: string[]; batchName?: string } | undefined;
      const sources = (body?.sources ?? []).map((s) => s.trim()).filter(Boolean);
      if (sources.length === 0) throw new ValidationError('At least one URL is required');
      if (sources.length > MAX_BATCH_FILES) {
        throw new ValidationError(`At most ${MAX_BATCH_FILES} URLs per batch`);
      }
      const batch = await startBatch(req.appUser.user_id, body?.batchName, 'urls', sources.length);
      const result = await importFromUrls(sources, req.appUser.user_id, { batchId: batch.id });
      return { ...result, batchId: batch.id };
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ success: false, message: err.message });
      }
      return reply.code(500).send({ error: 'Import failed' });
    }
  });

  // ── Re-extract / Cancel / Process DRAFT ────────────────────────────────

  app.post('/api/invoices/:id/reextract', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await reextractInvoice(id, req.appUser?.user_id);
      return { ok: true, message: 'Re-extraction started' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Re-extract failed';
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ error: msg });
    }
  });

  app.post('/api/invoices/:id/cancel', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await cancelInvoice(id, req.appUser?.user_id);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: 'Cancel failed' });
    }
  });

  app.post('/api/invoices/:id/process-ocr', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await processDraft(id, req.appUser?.user_id);
      return { ok: true, message: 'OCR processing started' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ error: `Process OCR failed: ${msg}` });
    }
  });

  // ── Approval Workflow ───────────────────────────────────────────────────

  app.post('/api/invoices/:id/submit-approval', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const { id } = req.params as { id: string };
      await submitForApproval(id, req.appUser.user_id);
      return { success: true, message: 'Submitted — pending approval' };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  app.post('/api/invoices/:id/approve', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const { id } = req.params as { id: string };
      const result = await approveInvoice(id, req.appUser.user_id);
      return {
        success: true,
        approved: result.approved,
        nextStep: result.nextStep,
        message: result.approved ? 'Invoice approved' : 'Signed — pending approval',
      };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  app.post('/api/invoices/:id/reject', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const { id } = req.params as { id: string };
      const body = req.body as { reason?: string };
      await rejectInvoice(id, req.appUser.user_id, body.reason ?? '');
      return { success: true, message: 'Invoice rejected' };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  // ── Bakeoff stubs ──────────────────────────────────────────────────────

  app.post('/api/invoices/:id/bakeoff', async () => ({ runs: [] }));
  app.post('/api/invoices/:id/apply-run', async () => ({ ok: true }));

  // ── Update / Delete / Bulk ─────────────────────────────────────────────

  app.patch('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = validateBody(invoiceUpdateBodySchema, req.body);
      return await updateInvoice(id, body, req.appUser?.user_id);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ error: 'Update failed' });
    }
  });

  app.delete('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await deleteInvoice(id, req.appUser?.user_id);
      return { ok: true };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ error: 'Delete failed' });
    }
  });

  app.post('/api/invoices/bulk', async (req, reply) => {
    try {
      const body = req.body as { action: string; ids: string[] };
      await bulkAction(body.action, body.ids, req.appUser?.user_id);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: 'Bulk action failed' });
    }
  });

  // ── CSV Export ─────────────────────────────────────────────────────────

  app.get('/api/invoices/export/csv', async (_req, reply) => {
    try {
      const csv = await exportInvoicesCsv();
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="invoices.csv"');
      return csv;
    } catch (err) {
      return reply.code(500).send({ error: 'Export failed' });
    }
  });

  app.get('/api/invoices/export/line-items.csv', async (_req, reply) => {
    try {
      const csv = await exportLineItemsCsv();
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="line-items.csv"');
      return csv;
    } catch (err) {
      return reply.code(500).send({ error: 'Export failed' });
    }
  });

  app.get('/api/invoices/export/xlsx', async (req, reply) => {
    try {
      const qs = validateQuery(invoiceExportQuerySchema, req.query);
      const filters = parseExportFilters(qs, billOwnerFilter(req));
      const buffer = await exportFilteredInvoicesExcel(filters);
      const stamp = new Date().toISOString().slice(0, 10);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="invoices-${stamp}.xlsx"`);
      return buffer;
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      return reply.code(500).send({ error: 'Export failed' });
    }
  });

  // ── OCR API (sync / async / legacy) ────────────────────────────────────

  app.post('/api/parse', async (req, reply) => {
    try {
      const buf = await extractBuffer(req);
      if (!buf) return reply.code(400).send({ error: 'provide a PDF file or JSON { "source": "<url>" }' });
      return await statelessParse(buf);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'extraction failed' });
    }
  });

  app.post('/api/ocr/sync', async (req, reply) => {
    try {
      const user = req.appUser;
      if (!user) return reply.status(401).send({ success: false, message: 'API key or session token required' });
      if (user.role !== 'admin' && (user.token_balance ?? 0) <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance' });
      }

      const buf = await extractBuffer(req);
      if (!buf) return reply.code(400).send({ success: false, message: 'Provide a PDF/image file or JSON { "url": "<url>" }' });

      const result = await syncOcr(buf, user.user_id, user.role === 'admin');

      return {
        success: true,
        data: {
          bill_id: result.billId,
          status: result.status,
          needs_review: result.needsReview,
          parsed_data: result.parsedData,
          review_reasons: result.reviewReasons,
          review_codes: result.reviewCodes,
          total_reconciliation: result.totalReconciliation,
          fallback_reason: result.fallbackReason,
          raw_ocr: result.rawOcr,
          cost: {
            mode: result.cost.mode,
            extraction_usd: result.cost.extractionUsd,
            structuring_usd: result.cost.structuringUsd,
            single_call_usd: result.cost.singleCallUsd,
            extraction_provider: result.cost.extractionProvider,
            structuring_provider: result.cost.structuringProvider,
            fallback_reason: result.cost.fallbackReason,
            total_usd: result.cost.totalUsd,
            total_inr: result.cost.totalInr,
            input_tokens: result.cost.inputTokens,
            output_tokens: result.cost.outputTokens,
            input_cost_usd: result.cost.inputCostUsd,
            output_cost_usd: result.cost.outputCostUsd,
          },
          latency_ms: result.latencyMs,
        },
      };
    } catch (err) {
      return reply.code(502).send({ success: false, message: err instanceof Error ? err.message : 'OCR failed' });
    }
  });

  app.post('/api/ocr/async', async (req, reply) => {
    try {
      const user = req.appUser;
      if (!user) return reply.status(401).send({ success: false, message: 'API key or session token required' });
      if (user.role !== 'admin' && (user.token_balance ?? 0) <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance' });
      }

      const buf = await extractBuffer(req);
      if (!buf) return reply.code(400).send({ success: false, message: 'Provide a PDF/image file or JSON { "url": "<url>" }' });

      const { billId } = await asyncOcr(buf, user.user_id);

      return reply.status(202).send({
        success: true,
        data: {
          bill_id: billId,
          status: 'PROCESSING',
          poll_url: `/api/invoices/${billId}`,
        },
        message: 'OCR started. Poll GET /api/invoices/:bill_id for result.',
      });
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: err instanceof Error ? err.message : 'Upload failed' });
    }
  });
}

// ── Helper ──────────────────────────────────────────────────────────────────

/** Extract a Buffer from multipart upload or JSON URL body. */
async function extractBuffer(req: any): Promise<Buffer | null> {
  const ctype = String(req.headers['content-type'] ?? '');
  if (ctype.includes('multipart/form-data')) {
    for await (const part of req.parts()) {
      if (part.type === 'file') return part.toBuffer();
    }
    return null;
  }
  const body = (req.body ?? {}) as { source?: string; url?: string };
  const source = body.source ?? body.url;
  if (!source) return null;
  const resp = await fetch(source);
  if (!resp.ok) return null;
  return Buffer.from(await resp.arrayBuffer());
}
