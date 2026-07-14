/**
 * Bill Processing Service
 *
 * Responsibilities (and nothing else):
 * - Upload handling
 * - OCR execution (Mistral)
 * - Normalization (Gemini)
 * - Validation
 * - Firestore storage
 */
import { v4 as uuid } from 'uuid';
import { uploadFile, isPdf, isImage, downloadFile } from '../../lib/storage.js';
import { toApiParsed } from '../../lib/toApiParsed.js';
import { createBill, updateBillStatus, getBill } from '../../models/bills.js';
import { extractPartsFromParsed, saveBillParts } from '../../models/billParts.js';
import { mapParsedToBill } from './billMapper.js';
import type { BillDoc, ParsedInvoiceData, BillType } from '../../models/types.js';

export interface ProcessResult {
  bill: BillDoc;
  partsCount: number;
}

export interface UploadInput {
  buffer: Buffer;
  fileName: string;
  billType?: BillType;
  fleetId?: string;
  vehicleId?: string;
}

export interface UrlInput {
  url: string;
  billType?: BillType;
  fleetId?: string;
  vehicleId?: string;
}

/**
 * Process a bill from a file upload (PDF or image).
 *
 * Pipeline: validate → upload to Cloud Storage → OCR (Mistral) → normalize (Gemini) → store
 */
export async function processUpload(
  input: UploadInput,
  ocrFn: (buf: Buffer) => Promise<string>,
  normalizeFn: (rawOcr: string) => Promise<ParsedInvoiceData>,
): Promise<ProcessResult> {
  if (!isPdf(input.buffer) && !isImage(input.buffer)) {
    throw new Error('Unsupported file type. Only PDF and images are accepted.');
  }

  const billId = uuid();

  const { storagePath, publicUrl } = await uploadFile(input.buffer, {
    fileName: input.fileName,
    contentType: isPdf(input.buffer) ? 'application/pdf' : 'image/jpeg',
  });

  const initialBill = mapParsedToBill(billId, {}, {
    fileUrl: publicUrl,
    storagePath,
    billType: input.billType,
    fleetId: input.fleetId,
    vehicleId: input.vehicleId,
  });
  initialBill.ocr_status = 'UPLOADED';
  await createBill(initialBill);

  try {
    await updateBillStatus(billId, 'PROCESSING');

    const rawOcr = await ocrFn(input.buffer);

    const rawParsed = await normalizeFn(rawOcr);
    const parsed = toApiParsed(rawParsed) as unknown as ParsedInvoiceData;

    const bill = mapParsedToBill(billId, parsed, {
      fileUrl: publicUrl,
      storagePath,
      rawOcrReference: rawOcr.length > 10000 ? rawOcr.slice(0, 10000) : rawOcr,
      billType: input.billType,
      fleetId: input.fleetId,
      vehicleId: input.vehicleId,
    });
    bill.ocr_status = 'OCR_COMPLETED';

    await updateBillStatus(billId, 'OCR_COMPLETED', bill);

    const parts = extractPartsFromParsed(billId, parsed);
    await saveBillParts(parts);

    return { bill, partsCount: parts.length };
  } catch (err) {
    await updateBillStatus(billId, 'FAILED', {
      processing_status: err instanceof Error ? err.message : 'Unknown error',
    });
    throw err;
  }
}

/**
 * Process a bill from a URL (S3, Cloud Storage, or HTTPS).
 * Downloads the file first, then delegates to processUpload.
 */
export async function processFromUrl(
  input: UrlInput,
  ocrFn: (buf: Buffer) => Promise<string>,
  normalizeFn: (rawOcr: string) => Promise<ParsedInvoiceData>,
): Promise<ProcessResult> {
  const buf = await downloadFile(input.url);
  const fileName = input.url.split('/').pop() ?? 'invoice.pdf';
  return processUpload(
    { buffer: buf, fileName, billType: input.billType, fleetId: input.fleetId, vehicleId: input.vehicleId },
    ocrFn,
    normalizeFn,
  );
}

/**
 * Mark a bill as human-verified.
 */
export async function verifyBill(billId: string): Promise<BillDoc | null> {
  const bill = await getBill(billId);
  if (!bill) return null;
  await updateBillStatus(billId, 'VERIFIED');
  return { ...bill, ocr_status: 'VERIFIED', updated_at: new Date().toISOString() };
}
