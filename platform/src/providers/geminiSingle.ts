/**
 * Gemini single-prompt mode: PDF/image → structured ParsedInvoiceData in one call.
 * Auth: API key OR Vertex AI + ADC.
 */
import { STRUCTURING_PROMPT } from '../parsing/prompt.js';
import { structureFromLlmResponse } from '../parsing/index.js';
import type { ParsedInvoiceData } from '../parsing/types.js';
import type { OcrStepCost } from './types.js';
import { resolveProviderKey } from './resolveKey.js';
import { geminiGenerateContent, toGeminiStepCost } from './geminiClient.js';
import { isPdf } from '../lib/storage.js';

function detectMime(buf: Buffer): string {
  if (isPdf(buf)) return 'application/pdf';
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

export interface GeminiSingleResult {
  parsed: ParsedInvoiceData;
  rawOcr: string;
  cost: OcrStepCost;
}

export async function geminiSingle(buf: Buffer): Promise<GeminiSingleResult> {
  const { apiKey, model } = await resolveProviderKey('gemini');
  const mime = detectMime(buf);
  const base64 = buf.toString('base64');

  const r = await geminiGenerateContent({
    model,
    apiKey: apiKey || undefined,
    parts: [
      { inlineData: { mimeType: mime, data: base64 } },
      { text: STRUCTURING_PROMPT + '\n\nExtract all data from this document and return the JSON.' },
    ],
  });

  const cost = toGeminiStepCost(r);
  const structured = structureFromLlmResponse(r.text, '');
  if (!structured.parsedData) throw new Error('Gemini single returned no parsed_data');

  return { parsed: structured.parsedData, rawOcr: r.text, cost };
}
