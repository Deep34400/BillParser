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
import { exportInvoicesCsv, exportLineItemsCsv } from './service/exportService.js';
import { bearerFromRequest } from '../middleware/auth.js';
import { isPdf, isImage } from '../shared/storage.js';

export async function billRoutes(app: FastifyInstance) {

  // ── Invoice List & Counts ───────────────────────────────────────────────

  app.get('/api/invoices', async (req, reply) => {
    try {
      const qs = req.query as Record<string, string | undefined>;
      return await listInvoices({
        page: Number(qs.page) || undefined,
        pageSize: Number(qs.pageSize) || undefined,
        status: qs.status,
        q: qs.q,
        needsReview: qs.needsReview === '1' || qs.needsReview === 'true',
        completed: qs.completed === '1' || qs.completed === 'true',
        reviewCode: qs.review_code,
        orgId: req.orgId,
      });
    } catch (err) {
      req.log.error(err, 'Failed to list invoices');
      return reply.code(500).send({ error: 'Failed to list invoices', message: err instanceof Error ? err.message : String(err) });
    }
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

  // ── Single Invoice Detail ──────────────────────────────────────────────

  app.get('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getInvoice(id);

      const token = bearerFromRequest(req);
      const isApiKey = !!token?.startsWith('inv_');

      if (isApiKey) {
        return { success: true, data: await getInvoiceForApi(bill) };
      }

      return await getInvoiceForUi(id);
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
      const fileResult = await getInvoiceFile(id);

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
      for await (const part of (req as any).parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          files.push({ buf, name: part.filename || 'invoice.pdf' });
        }
      }

      return await uploadInvoices(files, req.appUser.user_id, req.orgId);
    } catch (err) {
      return reply.code(500).send({ error: 'Upload failed' });
    }
  });

  // ── Import from URLs ──────────────────────────────────────────────────

  app.post('/api/invoices/import', async (req, reply) => {
    try {
      const body = req.body as { sources?: string[] } | undefined;
      const sources = body?.sources ?? [];
      return await importFromUrls(sources, req.appUser?.user_id, req.orgId);
    } catch (err) {
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
      await cancelInvoice(id);
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
      const { id } = req.params as { id: string };
      await submitForApproval(id);
      return { success: true, message: 'Submitted for approval' };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  app.post('/api/invoices/:id/approve', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const { id } = req.params as { id: string };
      await approveInvoice(id, req.appUser.user_id);
      return { success: true, message: 'Invoice approved' };
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
      const body = req.body as Record<string, unknown>;
      return await updateInvoice(id, {
        vendorName: body.vendorName as string | undefined,
        vendorTaxId: body.vendorTaxId as string | undefined,
        invoiceNumber: body.invoiceNumber as string | undefined,
        invoiceDate: body.invoiceDate as string | undefined,
        totalAmount: body.totalAmount as number | undefined,
        subtotal: body.subtotal as number | undefined,
      });
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ error: 'Update failed' });
    }
  });

  app.delete('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await deleteInvoice(id);
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
