/**
 * OCR queue worker — processes a single OCR job from pg-boss.
 */
import {
  updateBill, updateBillStatus,
  extractPartsFromParsed, saveBillParts,
  getSettings, findDuplicateBills,
  type ParsedInvoiceData, type BillDoc,
} from '../ocr/repository.js';
import { mapParsedToBill } from '../ocr/mapper.js';
import { getStoredFile } from '../shared/storage.js';
import { runPipeline } from '../ocr/process.js';
import { cacheInvalidate } from '../shared/cache.js';
import { upsertVendorFromInvoice } from '../vendor/vendorService.js';
import { deductTokens, trackOcrCost } from '../users/service.js';
import { recordActivity } from '../ocr/service/recordActivity.js';

export interface OcrJobData {
  billId: string;
  fileName: string;
  publicUrl: string;
  storagePath: string;
  userId?: string;
}

/** Advisory duplicate check — adds a review reason but does NOT block. */
async function checkForDuplicates(
  billId: string,
  parsed: ParsedInvoiceData,
  bill: BillDoc,
): Promise<void> {
  try {
    const dupes = await findDuplicateBills(parsed.invoice_number, parsed.gstin, billId);
    if (dupes.length > 0) {
      const dupMsg = `Duplicate: invoice ${parsed.invoice_number} already exists (${dupes.length} match)`;
      const reasons = bill.review_reasons ?? [];
      if (!reasons.includes(dupMsg)) reasons.push(dupMsg);
      await updateBill(billId, { review_reasons: reasons });
      console.warn(`[OCR] ${billId} — ${dupMsg}`);
    }
  } catch (e) {
    console.warn(`[OCR] ${billId} — duplicate check failed:`, (e as Error).message);
  }
}

/** Deduct tokens and track OCR cost for a user. Non-fatal on failure. */
async function chargeUserForOcr(
  userId: string,
  costUsd: number,
  fileName: string,
  billId: string,
): Promise<void> {
  try {
    const rounded = Math.round(costUsd * 10000) / 10000;
    const deductAmount = rounded > 0 ? rounded : 0.001;
    await deductTokens(userId, deductAmount, `OCR: ${fileName} ($${deductAmount.toFixed(4)})`, billId);
    await trackOcrCost(userId, costUsd);
  } catch (e) {
    console.warn(`[OCR] ${billId} — token deduction failed:`, (e as Error).message);
  }
}

/**
 * Run the OCR pipeline for one job. Throws on failure so pg-boss can retry.
 * Pass `bufOverride` when running inline (e.g. tests) without fetching from storage.
 */
export async function processOcrJob(data: OcrJobData, bufOverride?: Buffer): Promise<void> {
  const { billId, fileName, publicUrl, storagePath, userId } = data;
  const startTime = Date.now();
  console.log(`[OCR] Processing job for ${billId} (${fileName})`);

  let buf = bufOverride;
  if (!buf) {
    const stored = await getStoredFile(storagePath);
    if (!stored) {
      throw new Error(`Could not retrieve stored file at ${storagePath}`);
    }
    buf = stored.buf;
  }

  const result = await runPipeline(buf, billId);
  const { costInfo, rawOcr, providers, fallbackHistory, fallbackAttempts } = result;

  if (fallbackAttempts > 1) {
    console.warn(`[OCR] ${billId} — used ${fallbackAttempts} fallback attempts`);
  }

  const bill = mapParsedToBill(billId, result.parsed, {
    fileUrl: publicUrl,
    storagePath,
    rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
    costInfo,
    pipelineMode: providers.mode,
    fxRateUsdInr: (await getSettings()).usdToInr,
  });
  bill.ocr_status = bill.ocr_status === 'NEED_REVIEW' ? 'NEED_REVIEW' : 'OCR_COMPLETED';
  bill.fallback_attempts = fallbackAttempts;
  bill.fallback_history = fallbackHistory;

  await updateBillStatus(billId, bill.ocr_status, bill);
  cacheInvalidate('analytics');

  await checkForDuplicates(billId, result.parsed, bill);

  const parts = extractPartsFromParsed(billId, result.parsed);
  await saveBillParts(parts);

  upsertVendorFromInvoice(billId, result.parsed)
    .then((vid) => { if (vid) updateBill(billId, { vendor_id: vid }).catch(() => {}); })
    .catch((e) => console.warn(`[vendor] ${billId} — registry update failed:`, (e as Error).message));

  if (userId) {
    await chargeUserForOcr(userId, costInfo.total_cost_usd, fileName, billId);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[OCR] ${billId} — DONE in ${elapsed}s `
    + `(mode=${providers.mode}, extract=${providers.extraction}, `
    + `struct=${providers.structuring}, parts=${parts.length}, `
    + `$${costInfo.total_cost_usd.toFixed(4)})`,
  );
  recordActivity(userId, 'invoice:complete', 'invoice.completed', billId, {
    fileName, status: bill.ocr_status, costUsd: costInfo.total_cost_usd,
  });
}
