import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { processUpload, processFromUrl, verifyBill } from '../services/billing/billProcessingService.js';
import { getBill, listBills, deleteBill, updateBill, createBill, updateBillStatus } from '../models/bills.js';
import { getPartsForBill, deletePartsForBill, extractPartsFromParsed, saveBillParts } from '../models/billParts.js';
import { billToInvoice } from '../lib/billToInvoice.js';
import { toApiParsed } from '../lib/toApiParsed.js';
import { isPdf, isImage, uploadFile, getStoredFile } from '../lib/storage.js';
import { mistralOcr } from '../providers/mistralOcr.js';
import { env } from '../config/env.js';
import { mapParsedToBill } from '../services/billing/billMapper.js';
import type { BillType, ParsedInvoiceData } from '../models/types.js';
import type { OcrCostInfo, OcrStepCost } from '../providers/types.js';
import { deductTokens, updateUser, getUser } from '../models/users.js';
import type { UserDoc } from '../models/users.js';
import { enrichParsedInvoice } from '../billing/normalize.js';
import { runStructuring } from '../services/billing/structuringService.js';

/**
 * Run OCR pipeline in the background (fire-and-forget).
 * Captures token usage + cost from each API step.
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
      console.log(`[OCR] ${billId} — calling Mistral OCR...`);
      const ocrResult = await mistralOcr(buf, true);
      const rawOcr = ocrResult.markdown;
      const extractionCost: OcrStepCost = ocrResult.cost;
      console.log(`[OCR] ${billId} — Mistral OCR done (${extractionCost.latency_ms}ms, ${extractionCost.usage.total_tokens} tokens, $${extractionCost.cost_usd.toFixed(4)})`);

      const structured = await runStructuring(rawOcr, billId);
      const rawParsed = structured.parsed;
      const structuringCost = structured.cost;
      const normName = structured.provider === 'gemini' ? 'Gemini' : 'Mistral';

      console.log(`[OCR] ${billId} — ${normName} structuring saved (${structuringCost.latency_ms}ms, ${structuringCost.usage.total_tokens} tokens, $${structuringCost.cost_usd.toFixed(4)})`);
      if (structured.geminiError) {
        console.warn(`[OCR] ${billId} — used Mistral fallback because Gemini failed: ${structured.geminiError}`);
      }

      const costInfo: OcrCostInfo = {
        extraction: extractionCost,
        structuring: structuringCost,
        total_cost_usd: extractionCost.cost_usd + structuringCost.cost_usd,
        total_tokens: extractionCost.usage.total_tokens + structuringCost.usage.total_tokens,
      };

      const enriched = enrichParsedInvoice(rawParsed, rawOcr);
      const parsed = toApiParsed(enriched) as unknown as ParsedInvoiceData;

      const bill = mapParsedToBill(billId, parsed, {
        fileUrl,
        storagePath,
        rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
        costInfo,
      });
      bill.ocr_status = 'OCR_COMPLETED';

      await updateBillStatus(billId, 'OCR_COMPLETED', bill);

      const parts = extractPartsFromParsed(billId, parsed);
      await saveBillParts(parts);

      if (userId) {
        try {
          const costUsd = Math.round(costInfo.total_cost_usd * 10000) / 10000;
          const deductAmt = costUsd > 0 ? costUsd : 0.001;
          await deductTokens(userId, deductAmt, `OCR: ${fileName} ($${deductAmt.toFixed(4)})`, billId);
          const u = await getUser(userId);
          if (u) {
            await updateUser(userId, { total_cost_usd: Math.round(((u.total_cost_usd ?? 0) + costInfo.total_cost_usd) * 10000) / 10000 });
          }
        } catch (e) {
          console.warn(`[OCR] ${billId} — token deduction failed:`, (e as Error).message);
        }
      }

      console.log(`[OCR] ${billId} — DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s (${parts.length} parts, total $${costInfo.total_cost_usd.toFixed(4)}, ${costInfo.total_tokens} tokens)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[OCR] ${billId} — FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, msg);
      await updateBillStatus(billId, 'FAILED', { processing_status: msg }).catch(() => {});
    }
  })();
}

export async function billRoutes(app: FastifyInstance) {
  /**
   * GET /api/invoices — list all bills as Invoice[] for the frontend.
   */
  app.get('/api/invoices', async (_req, reply) => {
    try {
      const bills = await listBills({ limit: 500 });
      const invoices = await Promise.all(
        bills.map(async (b) => {
          const parts = await getPartsForBill(b.bill_id);
          return billToInvoice(b, parts);
        }),
      );
      return { invoices };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to list invoices' });
    }
  });

  /**
   * GET /api/invoices/:id — single invoice detail.
   */
  app.get('/api/invoices/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill) return reply.code(404).send({ error: 'Invoice not found' });
      const parts = await getPartsForBill(id);
      return billToInvoice(bill, parts);
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to get invoice' });
    }
  });

  /**
   * GET /api/invoices/:id/file — serve the original PDF/image.
   * LOCAL_DEV: streams from in-memory store. Production: redirects to GCS or streams.
   */
  app.get('/api/invoices/:id/file', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const bill = await getBill(id);
      if (!bill?.storage_path && !bill?.file_url) {
        return reply.code(404).send({ error: 'File not found' });
      }

      const storagePath = bill.storage_path
        ?? bill.file_url?.replace(/^local:\/\//, '');

      if (!storagePath) return reply.code(404).send({ error: 'File not found' });

      const stored = await getStoredFile(storagePath);
      if (stored) {
        return reply
          .header('Content-Type', stored.contentType)
          .header('Content-Disposition', `inline; filename="${bill.invoice_number ?? id}.pdf"`)
          .send(stored.buf);
      }

      if (bill.file_url?.startsWith('http')) {
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
      const rejected: string[] = [];
      const files: { buf: Buffer; name: string }[] = [];

      for await (const part of (req as any).parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          files.push({ buf, name: part.filename || 'invoice.pdf' });
        }
      }

      for (const f of files) {
        if (!isPdf(f.buf) && !isImage(f.buf)) {
          rejected.push(f.name);
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
          await createBill(initialBill);

          created.push(billId);

          processInBackground(billId, f.buf, f.name, publicUrl, storagePath, req.appUser?.user_id);
        } catch {
          rejected.push(f.name);
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

      const rawOcr = await mistralOcr(buf);
      const { parsed: rawParsed } = await runStructuring(rawOcr, 'parse');
      const parsed = enrichParsedInvoice(rawParsed, rawOcr);

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
      const ocrResult = await mistralOcr(buf, true);
      const rawOcr = ocrResult.markdown;
      const extractionCost: OcrStepCost = ocrResult.cost;

      const structured = await runStructuring(rawOcr, 'sync');
      const rawParsed = structured.parsed;
      const structuringCost = structured.cost;

      const totalCostUsd = extractionCost.cost_usd + structuringCost.cost_usd;
      const enriched = enrichParsedInvoice(rawParsed, rawOcr);
      const parsed = toApiParsed(enriched) as unknown as ParsedInvoiceData;

      const costInfo: OcrCostInfo = {
        extraction: extractionCost,
        structuring: structuringCost,
        total_cost_usd: totalCostUsd,
        total_tokens: extractionCost.usage.total_tokens + structuringCost.usage.total_tokens,
      };

      const billId = uuid();
      const fileName = 'api-sync-upload';
      const { storagePath, publicUrl } = await uploadFile(buf, {
        fileName,
        contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
      });

      const bill = mapParsedToBill(billId, parsed, {
        fileUrl: publicUrl,
        storagePath,
        rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
        costInfo,
      });
      bill.ocr_status = 'OCR_COMPLETED';
      await createBill(bill);
      const parts = extractPartsFromParsed(billId, parsed);
      await saveBillParts(parts);

      if (user.role !== 'admin') {
        const amt = Math.round(totalCostUsd * 10000) / 10000 || 0.001;
        try { await deductTokens(user.user_id, amt, `API OCR sync ($${amt.toFixed(4)})`, billId); } catch { /* ignore */ }
        try {
          const u = await getUser(user.user_id);
          if (u) await updateUser(user.user_id, { total_cost_usd: Math.round(((u.total_cost_usd ?? 0) + totalCostUsd) * 10000) / 10000 });
        } catch { /* ignore */ }
      }

      return {
        success: true,
        data: {
          bill_id: billId,
          parsed_data: toApiParsed(enriched),
          raw_ocr: rawOcr,
          cost: {
            extraction_usd: extractionCost.cost_usd,
            structuring_usd: structuringCost.cost_usd,
            structuring_provider: structured.provider,
            gemini_fallback_reason: structured.geminiError ?? null,
            total_usd: totalCostUsd,
            total_inr: Math.round(totalCostUsd * 83 * 100) / 100,
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
