import { mistralOcr } from './mistralOcr.js';
import { geminiNormalize } from './geminiNormalize.js';
import type { ParsedInvoiceData } from '../parsing/types.js';

/** Full OCR pipeline: Mistral OCR → Gemini normalize */
export async function runOcrPipeline(buf: Buffer, fileName?: string): Promise<{
  rawOcr: string;
  parsed: ParsedInvoiceData;
}> {
  const rawOcr = await mistralOcr(buf);
  const parsed = await geminiNormalize(rawOcr);
  return { rawOcr, parsed };
}
