/**
 * Attachment Filter — keeps only valid invoice files from an email.
 *
 * Rules:
 *  - Content type must be application/pdf OR image/* (jpeg, png, webp, tiff)
 *    (also accept .pdf / image extensions if MIME is missing/wrong)
 *  - Skip inline images (signatures/logos)
 *  - No minimum size — even small KB PDFs are accepted
 *  - Skip files > 5 MB (too large for OCR pipeline)
 */

const MIN_SIZE_BYTES = 0; // accept any size (including small KB invoices)
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const VALID_MIME_PREFIXES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
const VALID_EXT = /\.(pdf|jpe?g|png|webp|tiff?)$/i;

export interface RawAttachment {
  filename?: string;
  contentType: string;
  contentDisposition?: string;
  content: Buffer;
  size: number;
}

export interface ValidAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export function filterAttachments(attachments: RawAttachment[]): { valid: ValidAttachment[]; skipped: string[] } {
  const valid: ValidAttachment[] = [];
  const skipped: string[] = [];

  for (const att of attachments) {
    const name = att.filename ?? 'unnamed';
    const size = att.size || att.content?.length || 0;

    if (att.contentDisposition === 'inline') {
      skipped.push(`${name}: inline (logo/signature)`);
      continue;
    }

    if (size <= MIN_SIZE_BYTES) {
      skipped.push(`${name}: empty file`);
      continue;
    }

    if (size > MAX_SIZE_BYTES) {
      skipped.push(`${name}: too large (${(size / (1024 * 1024)).toFixed(1)} MB > 5 MB)`);
      continue;
    }

    const mime = (att.contentType || '').toLowerCase();
    const mimeOk = VALID_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
    const extOk = VALID_EXT.test(name);
    if (!mimeOk && !extOk) {
      skipped.push(`${name}: unsupported type (${mime || 'unknown'})`);
      continue;
    }

    valid.push({
      filename: att.filename ?? `attachment_${Date.now()}.${mime.includes('pdf') || /\.pdf$/i.test(name) ? 'pdf' : 'jpg'}`,
      contentType: mimeOk ? mime : (/\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg'),
      content: att.content,
    });
  }

  return { valid, skipped };
}
