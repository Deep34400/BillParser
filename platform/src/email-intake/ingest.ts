/**
 * Invoice Ingestion — the single integration point between email intake and OCR pipeline.
 *
 * Creates a bill record with status DRAFT (from email), uploads the file.
 * Does NOT auto-trigger OCR. Admin can trigger OCR manually from the UI.
 */
import { v4 as uuid } from 'uuid';
import { uploadFile, isPdf, isImage } from '../shared/storage.js';
import { createBill } from '../ocr/repository.js';
import { mapParsedToBill } from '../ocr/mapper.js';
import type { ParsedInvoiceData } from '../shared/types.js';

export interface IngestRecord {
  source: 'email';
  sender: string;
  subject: string;
  receivedAt: string;
  messageId: string;
  originalFilename: string;
  savedPath: string;
  fileHash: string;
}

/**
 * Ingest a single attachment into the invoice pipeline.
 * - Creates bill as DRAFT
 * - Uploads file to storage
 * - Does NOT trigger OCR (user triggers manually from UI)
 */
export async function ingestInvoice(buf: Buffer, record: IngestRecord): Promise<string> {
  const billId = uuid();
  const fileName = record.originalFilename;

  console.log(`[email-intake] Ingesting: ${fileName} from ${record.sender} (bill=${billId})`);

  const contentType = isPdf(buf) ? 'application/pdf' : isImage(buf) ? 'image/jpeg' : 'application/octet-stream';
  const { storagePath, publicUrl } = await uploadFile(buf, { fileName, contentType });

  const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
    fileUrl: publicUrl,
    storagePath,
  });
  initialBill.ocr_status = 'DRAFT';
  (initialBill as any).original_filename = fileName;
  (initialBill as any).intake_source = 'email';
  (initialBill as any).intake_sender = record.sender;
  (initialBill as any).intake_subject = record.subject;
  (initialBill as any).intake_message_id = record.messageId;
  (initialBill as any).intake_received_at = record.receivedAt;
  await createBill(initialBill);

  console.log(`[email-intake] ${billId} — saved as DRAFT (OCR not triggered, trigger from UI)`);
  return billId;
}
