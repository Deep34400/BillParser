import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import {
  getBill, listBills, listBillsPaginated, deleteBill, updateBill, createBill, updateBillStatus,
  getPartsForBill, deletePartsForBill, extractPartsFromParsed, saveBillParts,
  getSettings, findDuplicateBills, countAllStatuses, type ParsedInvoiceData,
} from './repository.js';
import { billToInvoice, toApiParsed, mapParsedToBill, toExternalOcrPayload } from './mapper.js';
import { isPdf, isImage, uploadFile, getStoredFile } from '../shared/storage.js';
import { env } from '../config/env.js';
import { deductTokens, trackOcrCost } from '../users/service.js';
import { enrichParsedInvoice } from './transformer/normalize/index.js';
import { runPipeline } from './process.js';
import { cacheInvalidate } from '../shared/cache.js';
import { upsertVendorFromInvoice } from '../vendor/vendorService.js';
import { bearerFromRequest } from '../middleware/auth.js';

/** Stamp pipeline/provider from Settings onto a newly created PROCESSING bill (so UI shows the chosen model, not mistral). */
async function applyPipelineSettingsToBill(bill: import('../shared/types.js').BillDoc): Promise<void> {
  const settings = await getSettings();
  const mode = settings.pipelineMode ?? 'single';
  bill.pipeline_mode = mode;
  if (mode === 'single') {
    const prov = settings.singleProvider ?? 'gemini';
    const model = settings.singleModel ?? 'gemini-2.5-flash';
    bill.extraction_provider = prov;
    bill.structuring_provider = prov;
    bill.extraction_model = model;
    bill.structuring_model = model;
  } else {
    bill.extraction_provider = 'mistral';
    bill.structuring_provider = settings.structuringProvider ?? 'gemini';
    bill.structuring_model = settings.structuringModel ?? 'gemini-2.5-flash';
    bill.extraction_model = null;
  }
}

/**
 * Run OCR pipeline in the background (fire-and-forget).
 * Uses runPipeline() which reads settings from DB for mode + providers.
 */
function processInBackground(
  billId: string,
  buf: Buffer,
  fileName: string,
  fileUrl: string,
  storagePath: string,
  userId?: string,
): void {
  const t0 = Date.now();
  console.log(`[OCR] Starting background processing for ${billId} (${fileName})`);

  (async () => {
    try {
      const result = await runPipeline(buf, billId);
      const { costInfo, rawOcr, providers } = result;

      if (result.fallbackReason) {
        console.warn(`[OCR] ${billId} — fallback used: ${result.fallbackReason}`);
      }

      const enriched = enrichParsedInvoice(result.parsed, rawOcr);

      const bill = mapParsedToBill(billId, enriched, {
        fileUrl,
        storagePath,
        rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
        costInfo,
        pipelineMode: providers.mode,
      });
      bill.ocr_status = bill.ocr_status === 'NEED_REVIEW' ? 'NEED_REVIEW' : 'OCR_COMPLETED';
      if (result.fallbackReason) {
        bill.processing_status = `FALLBACK: ${result.fallbackReason}`;
      }

      await updateBillStatus(billId, bill.ocr_status, bill);
      cacheInvalidate('analytics');

      // Duplicate check — advisory only (does NOT force NEED_REVIEW while policy is GSTIN/PAN-only)
      try {
        const dupes = await findDuplicateBills(enriched.invoice_number, enriched.gstin, billId);
        if (dupes.length > 0) {
          const dupMsg = `Duplicate: invoice ${enriched.invoice_number} already exists (${dupes.length} match)`;
          const reasons = bill.review_reasons ?? [];
          if (!reasons.includes(dupMsg)) reasons.push(dupMsg);
          await updateBill(billId, { review_reasons: reasons });
          console.warn(`[OCR] ${billId} — ${dupMsg}`);
        }
      } catch (e) {
        console.warn(`[OCR] ${billId} — duplicate check failed:`, (e as Error).message);
      }

      const parts = extractPartsFromParsed(billId, enriched);
      await saveBillParts(parts);

      // Vendor Registry — fire-and-forget; never blocks or affects OCR pipeline
      upsertVendorFromInvoice(billId, enriched)
        .then((vid) => { if (vid) updateBill(billId, { vendor_id: vid }).catch(() => {}); })
        .catch((e) => console.warn(`[vendor] ${billId} — registry update failed:`, (e as Error).message));

      if (userId) {
        try {
          const costUsd = Math.round(costInfo.total_cost_usd * 10000) / 10000;
          const deductAmt = costUsd > 0 ? costUsd : 0.001;
          await deductTokens(userId, deductAmt, `OCR: ${fileName} ($${deductAmt.toFixed(4)})`, billId);
          await trackOcrCost(userId, costInfo.total_cost_usd);
        } catch (e) {
          console.warn(`[OCR] ${billId} — token deduction failed:`, (e as Error).message);
        }
      }

      console.log(`[OCR] ${billId} — DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s (mode=${providers.mode}, extract=${providers.extraction}, struct=${providers.structuring}, parts=${parts.length}, $${costInfo.total_cost_usd.toFixed(4)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[OCR] ${billId} — FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, msg);
      await updateBillStatus(billId, 'FAILED', { processing_status: msg }).catch(() => {});
    }
  })();
}

export async function billRoutes(app: FastifyInstance) {
  /**
   * GET /api/invoices — paginated invoice list.
   *
   * Query params:
   *   page      — 1-based page number (default 1)
   *   pageSize  — items per page (default 10, max 100)
   *   status    — filter by BillStatus (e.g. OCR_COMPLETED, FAILED)
   *
   * Response: { invoices, total, page, pageSize, totalPages }
   *
   * Line items are NOT returned in the list view (saves N+1 DB reads).
   * Use GET /api/invoices/:id for full detail including parts.
   */
  app.get('/api/invoices', async (req, reply) => {
    try {
      const qs = req.query as Record<string, string | undefined>;
      const page = Math.max(Number(qs.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(qs.pageSize) || 10, 1), 100);
      const status = qs.status as import('../shared/types.js').BillStatus | undefined;
      const q = qs.q?.trim().toLowerCase();
      const needsReview = qs.needsReview === '1' || qs.needsReview === 'true';
      const completed = qs.completed === '1' || qs.completed === 'true';
      const reviewCode = qs.review_code?.trim() || undefined;

      const result = await listBillsPaginated({
        page,
        pageSize,
        status: needsReview || reviewCode ? 'NEED_REVIEW' : (completed ? undefined : status),
        statuses: completed ? ['OCR_COMPLETED', 'VERIFIED'] : undefined,
        needsReview: undefined,
        excludeNeedsReview: undefined,
        reviewCode,
        q,
      });
      const invoices = result.bills.map((b) => billToInvoice(b));

      return {
        invoices,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      };
    } catch (err) {
      req.log.error(err, 'Failed to list invoices');
      return reply.code(500).send({ error: 'Failed to list invoices', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/invoices/counts', async (_req, reply) => {
    try {
      const counts = await countAllStatuses();
      return { counts };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to count invoices' });
    }
  });

  /**
   * GET /api/invoices/:id — single invoice detail.
   *
   * API key (Bearer inv_…): lean OCR payload only
   *   { success, data: { bill_id, status, parsed_data, review_reasons, total_reconciliation, fallback_reason } }
   *
   * JWT / UI session: full FrontendInvoice (camelCase) for the detail page.
   */
  app.get('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });

      const token = bearerFromRequest(req);
      const isApiKey = !!token?.startsWith('inv_');

      if (isApiKey) {
        const inv = billToInvoice(bill);
        const ext = toExternalOcrPayload(bill);
        return {
          success: true,
          data: {
            bill_id: bill.bill_id,
            status: ext.status,
            needs_review: ext.needs_review,
            parsedData: toApiParsed(bill.parsed_data),
            review_reasons: ext.review_reasons,
            review_codes: ext.review_codes,
            total_reconciliation: inv.totalReconciliation ?? null,
            fallback_reason: inv.fallbackReason ?? null,
          },
        };
      }

      const parts = await getPartsForBill(id);
      return billToInvoice(bill, parts);
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to get invoice' });
    }
  });

  /**
   * GET /api/invoices/:id/file — serve the original PDF/image.
   * Private GCS: prefer short-lived signed URL; otherwise stream via API (never public bucket URL).
   */
  app.get('/api/invoices/:id/file', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill?.storage_path && !bill?.file_url) {
        return reply.code(404).send({ error: 'File not found' });
      }

      const storagePath = bill.storage_path
        ?? bill.file_url?.replace(/^local:\/\//, '')
        ?? bill.file_url?.replace(/^gs:\/\/[^/]+\//, '');

      if (!storagePath) return reply.code(404).send({ error: 'File not found' });

      // Prefer private signed URL when credentials can sign (SA key / Cloud Run SA)
      if (!env.localDev && bill.storage_path) {
        const { getSignedReadUrl } = await import('../shared/storage.js');
        const signed = await getSignedReadUrl(bill.storage_path);
        if (signed) return reply.redirect(signed);
      }

      // Fallback: stream bytes through API (works with user ADC; bucket stays private)
      const stored = await getStoredFile(storagePath);
      if (stored) {
        return reply
          .header('Content-Type', stored.contentType)
          .header('Content-Disposition', `inline; filename="${bill.invoice_number ?? id}.pdf"`)
          .send(stored.buf);
      }

      // External http(s) only (e.g. S3 import) — never treat storage.googleapis.com as public
      if (bill.file_url?.startsWith('http') && !bill.file_url.includes('storage.googleapis.com')) {
        return reply.redirect(bill.file_url);
      }

      return reply.code(404).send({ error: 'File not found' });
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to get file' });
    }
  });

  /**
   * POST /api/invoices/upload — upload PDF files.
   * Returns IMMEDIATELY with bill IDs. OCR runs in background.
   * Frontend polls GET /api/invoices to see status changes.
   */
  app.post('/api/invoices/upload', async (req, reply) => {
    try {
      if (req.appUser && req.appUser.role !== 'admin' && req.appUser.token_balance <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance — contact admin to add balance' });
      }
      if (!req.appUser && !env.localDev) {
        return reply.status(401).send({ success: false, message: 'Authentication required' });
      }

      const created: string[] = [];
      const rejected: { name: string; reason: string }[] = [];
      const files: { buf: Buffer; name: string }[] = [];

      for await (const part of (req as any).parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          files.push({ buf, name: part.filename || 'invoice.pdf' });
        }
      }

      if (files.length === 0) {
        return reply.code(400).send({ created: [], duplicates: [], rejected: [{ name: '(none)', reason: 'No files in upload' }] });
      }

      for (const f of files) {
        if (!f.buf?.length) {
          rejected.push({ name: f.name, reason: 'Empty file (0 bytes)' });
          continue;
        }
        if (!isPdf(f.buf) && !isImage(f.buf)) {
          rejected.push({ name: f.name, reason: 'Unsupported type — only PDF or JPEG/PNG/WebP' });
          continue;
        }
        try {
          const billId = uuid();

          const { storagePath, publicUrl } = await uploadFile(f.buf, {
            fileName: f.name,
            contentType: isPdf(f.buf) ? 'application/pdf' : 'image/jpeg',
          });

          const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
            fileUrl: publicUrl,
            storagePath,
          });
          initialBill.ocr_status = 'PROCESSING';
          await applyPipelineSettingsToBill(initialBill);
          await createBill(initialBill);

          created.push(billId);

          processInBackground(billId, f.buf, f.name, publicUrl, storagePath, req.appUser?.user_id);
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'Upload failed';
          console.error(`[upload] rejected ${f.name}:`, reason);
          rejected.push({ name: f.name, reason });
        }
      }

      return { created, duplicates: [], rejected };
    } catch (err) {
      return reply.code(500).send({ error: 'Upload failed' });
    }
  });

  /**
   * POST /api/invoices/import — import from URLs.
   * Returns IMMEDIATELY. OCR runs in background.
   */
  app.post('/api/invoices/import', async (req, reply) => {
    try {
      const body = req.body as { sources?: string[]; batchName?: string } | undefined;
      const sources = body?.sources ?? [];
      const created: string[] = [];
      const rejected: string[] = [];

      for (const url of sources) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) { rejected.push(url); continue; }
          const buf = Buffer.from(await resp.arrayBuffer());
          const fileName = url.split('/').pop() ?? 'invoice.pdf';

          if (!isPdf(buf) && !isImage(buf)) { rejected.push(url); continue; }

          const billId = uuid();
          const { storagePath, publicUrl } = await uploadFile(buf, {
            fileName,
            contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
          });

          const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
            fileUrl: publicUrl,
            storagePath,
          });
          initialBill.ocr_status = 'PROCESSING';
          await applyPipelineSettingsToBill(initialBill);
          await createBill(initialBill);

          created.push(billId);

          processInBackground(billId, buf, fileName, publicUrl, storagePath);
        } catch {
          rejected.push(url);
        }
      }

      return { created, duplicates: [], rejected };
    } catch (err) {
      return reply.code(500).send({ error: 'Import failed' });
    }
  });

  /**
   * POST /api/invoices/:id/reextract — re-run OCR on existing bill.
   */
  app.post('/api/invoices/:id/reextract', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });
      await updateBill(id, { ocr_status: 'PROCESSING' });
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: 'Re-extract failed' });
    }
  });

  /**
   * POST /api/invoices/:id/cancel — cancel extraction.
   */
  app.post('/api/invoices/:id/cancel', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await updateBill(id, { ocr_status: 'FAILED', processing_status: 'Cancelled by user' });
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: 'Cancel failed' });
    }
  });

  /**
   * POST /api/invoices/:id/process-ocr — trigger OCR on a DRAFT bill.
   * Used for email-ingested invoices that are waiting for manual OCR trigger.
   */
  app.post('/api/invoices/:id/process-ocr', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });
      if (bill.ocr_status !== 'DRAFT') {
        return reply.code(400).send({ error: `Cannot process — status is ${bill.ocr_status}, expected DRAFT` });
      }
      if (!bill.storage_path) {
        return reply.code(400).send({ error: 'No file stored for this bill' });
      }

      const stored = await getStoredFile(bill.storage_path);
      if (!stored) {
        return reply.code(400).send({ error: 'Could not retrieve stored file' });
      }

      await updateBillStatus(id, 'PROCESSING', {});
      const userId = req.appUser?.user_id;
      const fileName = (bill as any).original_filename ?? bill.storage_path.split('/').pop() ?? `bill-${id}`;
      processInBackground(id, stored.buf, fileName, bill.file_url ?? '', bill.storage_path, userId);
      return { ok: true, message: 'OCR processing started' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: `Process OCR failed: ${msg}` });
    }
  });

  /**
   * POST /api/invoices/:id/bakeoff — run all providers (stub).
   */
  app.post('/api/invoices/:id/bakeoff', async (_req, reply) => {
    return { runs: [] };
  });

  /**
   * POST /api/invoices/:id/apply-run — apply a bakeoff run (stub).
   */
  app.post('/api/invoices/:id/apply-run', async (_req, reply) => {
    return { ok: true };
  });

  /**
   * PATCH /api/invoices/:id — update invoice fields (human correction).
   */
  app.patch('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });

      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};

      if (body.vendorName !== undefined) updates.vendor_name = body.vendorName;
      if (body.vendorTaxId !== undefined) updates.vendor_gstin = body.vendorTaxId;
      if (body.invoiceNumber !== undefined) updates.invoice_number = body.invoiceNumber;
      if (body.invoiceDate !== undefined) updates.invoice_date = body.invoiceDate;
      if (body.totalAmount !== undefined) updates.grand_total_amount = body.totalAmount;
      if (body.subtotal !== undefined) updates.subtotal_amount = body.subtotal;

      updates.ocr_status = 'VERIFIED';
      await updateBill(id, updates as any);

      const updated = await getBill(id);
      const parts = await getPartsForBill(id);
      return billToInvoice(updated!, parts);
    } catch (err) {
      return reply.code(500).send({ error: 'Update failed' });
    }
  });

  /**
   * DELETE /api/invoices/:id
   */
  app.delete('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });
      await deletePartsForBill(id);
      await deleteBill(id);
      cacheInvalidate('analytics');
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: 'Delete failed' });
    }
  });

  /**
   * POST /api/invoices/bulk — bulk actions (reextract, delete).
   */
  app.post('/api/invoices/bulk', async (req, reply) => {
    try {
      const body = req.body as { action: string; ids: string[] };
      if (body.action === 'delete') {
        for (const id of body.ids) {
          await deletePartsForBill(id);
          await deleteBill(id);
        }
        cacheInvalidate('analytics');
      } else if (body.action === 'reextract') {
        for (const id of body.ids) {
          await updateBill(id, { ocr_status: 'PROCESSING' } as any);
        }
      }
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: 'Bulk action failed' });
    }
  });

  /**
   * GET /api/invoices/export/csv — export as CSV.
   */
  app.get('/api/invoices/export/csv', async (_req, reply) => {
    try {
      const bills = await listBills({ limit: 5000 });
      const header = 'Invoice #,Vendor,Date,GSTIN,Parts Total,Labour Total,CGST,SGST,IGST,Grand Total,Status\n';
      const rows = bills.map((b) => {
        const t = b.parsed_data?.totals_and_tax_summary;
        return [
          b.invoice_number ?? '',
          b.vendor_name ?? '',
          b.invoice_date ?? '',
          b.vendor_gstin ?? '',
          t?.parts_total ?? '',
          t?.labour_total ?? '',
          ((t?.parts_cgst_amount ?? 0) + (t?.labour_cgst_amount ?? 0)) || '',
          ((t?.parts_sgst_amount ?? 0) + (t?.labour_sgst_amount ?? 0)) || '',
          ((t?.parts_igst_amount ?? 0) + (t?.labour_igst_amount ?? 0)) || '',
          b.grand_total_amount ?? '',
          b.ocr_status,
        ].join(',');
      }).join('\n');

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="invoices.csv"');
      return header + rows;
    } catch (err) {
      return reply.code(500).send({ error: 'Export failed' });
    }
  });

  /**
   * GET /api/invoices/export/line-items.csv — export line items CSV.
   */
  app.get('/api/invoices/export/line-items.csv', async (_req, reply) => {
    try {
      const bills = await listBills({ limit: 5000 });
      const header = 'Invoice #,Vendor,Type,Name,HSN/SAC,Qty,Rate,Amount,Tax %\n';
      const rows: string[] = [];

      for (const b of bills) {
        for (const p of b.parsed_data?.parts_line_items ?? []) {
          rows.push([
            b.invoice_number ?? '', b.vendor_name ?? '', 'PART',
            p.item_name_description ?? '', p.hsn_sac_code ?? '',
            p.quantity ?? '', p.rate ?? '', p.taxable_amount ?? '', p.tax_percentage ?? '',
          ].join(','));
        }
        for (const l of b.parsed_data?.labour_service_line_items ?? []) {
          rows.push([
            b.invoice_number ?? '', b.vendor_name ?? '', 'LABOUR',
            l.labour_description ?? '', l.hsn_sac_code ?? '',
            '1', l.labour_charges ?? '', l.labour_charges ?? '', l.tax_percentage ?? '',
          ].join(','));
        }
      }

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="line-items.csv"');
      return header + rows.join('\n');
    } catch (err) {
      return reply.code(500).send({ error: 'Export failed' });
    }
  });

  /**
   * POST /api/parse — legacy sync OCR (backward compat).
   */
  app.post('/api/parse', async (req, reply) => {
    try {
      const buf = await extractBuffer(req);
      if (!buf) return reply.code(400).send({ error: 'provide a PDF file or JSON { "source": "<url>" }' });

      const result = await runPipeline(buf, 'parse');
      const parsed = enrichParsedInvoice(result.parsed, result.rawOcr);

      return { output: { entries: [{ id: uuid(), parsed_data: toApiParsed(parsed) }] } };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'extraction failed' });
    }
  });

  /**
   * POST /api/ocr/sync — synchronous OCR. Waits for processing to complete.
   * Accepts: multipart/form-data (file) OR JSON { "url": "<s3/http url>" }
   * Auth: API key (Bearer inv_xxx) or JWT session token.
   * Returns full parsed invoice data + cost info.
   */
  app.post('/api/ocr/sync', async (req, reply) => {
    try {
      const user = req.appUser;
      if (!user) return reply.status(401).send({ success: false, message: 'API key or session token required' });
      if (user.role !== 'admin' && (user.token_balance ?? 0) <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance' });
      }

      const buf = await extractBuffer(req);
      if (!buf) return reply.code(400).send({ success: false, message: 'Provide a PDF/image file or JSON { "url": "<url>" }' });

      const t0 = Date.now();
      const result = await runPipeline(buf, 'sync');
      const { costInfo, rawOcr, providers } = result;

      const enriched = enrichParsedInvoice(result.parsed, rawOcr);

      const billId = uuid();
      const fileName = 'api-sync-upload';
      const { storagePath, publicUrl } = await uploadFile(buf, {
        fileName,
        contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
      });

      const bill = mapParsedToBill(billId, enriched, {
        fileUrl: publicUrl,
        storagePath,
        rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
        costInfo,
        pipelineMode: providers.mode,
      });
      // Keep mapper status (OCR_COMPLETED or NEED_REVIEW) — do not force COMPLETED
      if (result.fallbackReason) {
        bill.processing_status = `FALLBACK: ${result.fallbackReason}`;
      }
      await createBill(bill);
      const parts = extractPartsFromParsed(billId, enriched);
      await saveBillParts(parts);

      // Vendor Registry — fire-and-forget
      upsertVendorFromInvoice(billId, enriched)
        .then((vid) => { if (vid) updateBill(billId, { vendor_id: vid }).catch(() => {}); })
        .catch(() => {});

      if (user.role !== 'admin') {
        const amt = Math.round(costInfo.total_cost_usd * 10000) / 10000 || 0.001;
        try { await deductTokens(user.user_id, amt, `API OCR sync ($${amt.toFixed(4)})`, billId); } catch { /* ignore */ }
        try { await trackOcrCost(user.user_id, costInfo.total_cost_usd); } catch { /* ignore */ }
      }

      const ext = toExternalOcrPayload(bill);
      return {
        success: true,
        data: {
          bill_id: billId,
          status: ext.status,
          needs_review: ext.needs_review,
          parsed_data: toApiParsed(enriched),
          review_reasons: ext.review_reasons,
          review_codes: ext.review_codes,
          total_reconciliation: bill.total_reconciliation ?? null,
          fallback_reason: result.fallbackReason ?? null,
          raw_ocr: rawOcr,
          cost: {
            mode: providers.mode,
            extraction_usd: providers.mode === 'single' ? (costInfo.total_cost_usd ?? 0) : (costInfo.extraction?.cost_usd ?? 0),
            structuring_usd: providers.mode === 'single' ? null : (costInfo.structuring?.cost_usd ?? 0),
            single_call_usd: providers.mode === 'single' ? costInfo.total_cost_usd : null,
            extraction_provider: providers.extraction,
            structuring_provider: providers.structuring,
            fallback_reason: result.fallbackReason ?? null,
            total_usd: costInfo.total_cost_usd,
            total_inr: Math.round(costInfo.total_cost_usd * 83 * 100) / 100,
            input_tokens: costInfo.total_input_tokens ?? 0,
            output_tokens: costInfo.total_output_tokens ?? 0,
            input_cost_usd: costInfo.total_input_cost_usd ?? 0,
            output_cost_usd: costInfo.total_output_cost_usd ?? 0,
          },
          latency_ms: Date.now() - t0,
        },
      };
    } catch (err) {
      return reply.code(502).send({ success: false, message: err instanceof Error ? err.message : 'OCR failed' });
    }
  });

  /**
   * POST /api/ocr/async — async OCR. Returns bill ID immediately; poll GET /api/invoices/:id.
   * Accepts: multipart/form-data (file) OR JSON { "url": "<s3/http url>" }
   * Auth: API key or JWT session token.
   */
  app.post('/api/ocr/async', async (req, reply) => {
    try {
      const user = req.appUser;
      if (!user) return reply.status(401).send({ success: false, message: 'API key or session token required' });
      if (user.role !== 'admin' && (user.token_balance ?? 0) <= 0) {
        return reply.status(402).send({ success: false, message: 'Insufficient balance' });
      }

      const buf = await extractBuffer(req);
      if (!buf) return reply.code(400).send({ success: false, message: 'Provide a PDF/image file or JSON { "url": "<url>" }' });
      if (!isPdf(buf) && !isImage(buf)) {
        return reply.code(400).send({ success: false, message: 'Unsupported file type — PDF or image required' });
      }

      const billId = uuid();
      const fileName = 'api-upload.pdf';
      const { storagePath, publicUrl } = await uploadFile(buf, {
        fileName,
        contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
      });

      const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
        fileUrl: publicUrl,
        storagePath,
      });
      initialBill.ocr_status = 'PROCESSING';
      await createBill(initialBill);

      processInBackground(billId, buf, fileName, publicUrl, storagePath, user.user_id);

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
      return reply.code(500).send({ success: false, message: err instanceof Error ? err.message : 'Upload failed' });
    }
  });
}

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
