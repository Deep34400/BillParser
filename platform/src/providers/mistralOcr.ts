/**
 * Mistral OCR — extract markdown from PDF/image using Mistral's dedicated OCR endpoint.
 * POST https://api.mistral.ai/v1/ocr (NOT chat/completions)
 */
import { env } from '../config/env.js';
import type { LlmUsage, OcrStepCost } from './types.js';
import { isPdf, isImage } from '../lib/storage.js';

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const OCR_MODEL = 'mistral-ocr-latest';

/** ~$2 per 1000 pages (Mistral OCR pricing). */
const MISTRAL_OCR_PRICE_PER_PAGE = 0.002;

function detectImageMime(buf: Buffer): string {
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

function buildDocumentPayload(buf: Buffer): Record<string, string> {
  const base64 = buf.toString('base64');
  if (isPdf(buf)) {
    return {
      type: 'document_url',
      document_url: `data:application/pdf;base64,${base64}`,
    };
  }
  if (isImage(buf)) {
    const mime = detectImageMime(buf);
    return {
      type: 'image_url',
      image_url: `data:${mime};base64,${base64}`,
    };
  }
  throw new Error('Unsupported file type — upload a PDF or image (JPEG/PNG/WebP)');
}

function estimateCostUsd(pagesProcessed: number): number {
  return pagesProcessed * MISTRAL_OCR_PRICE_PER_PAGE;
}

function usageFromPages(pagesProcessed: number): LlmUsage {
  const tokens = pagesProcessed * 1000;
  return { prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens };
}

export interface MistralOcrResult {
  markdown: string;
  cost: OcrStepCost;
}

interface OcrPage {
  index?: number;
  markdown?: string;
}

interface OcrResponse {
  pages?: OcrPage[];
  usage_info?: { pages_processed?: number; doc_size_bytes?: number | null };
}

export async function mistralOcr(buf: Buffer): Promise<string>;
export async function mistralOcr(buf: Buffer, returnCost: true): Promise<MistralOcrResult>;
export async function mistralOcr(buf: Buffer, returnCost?: boolean): Promise<string | MistralOcrResult> {
  const apiKey = env.mistralApiKey;
  if (!apiKey) throw new Error('MISTRAL_API_KEY is not set');

  const t0 = Date.now();
  const document = buildDocumentPayload(buf);

  const res = await fetch(MISTRAL_OCR_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      document,
    }),
  });

  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Mistral OCR HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = (await res.json()) as OcrResponse;
  const pages = json.pages ?? [];
  const markdown = pages.map((p) => p.markdown ?? '').filter(Boolean).join('\n\n');

  if (!markdown.trim()) throw new Error('Mistral OCR returned empty response');

  const pagesProcessed = json.usage_info?.pages_processed ?? (pages.length || 1);
  const usage = usageFromPages(pagesProcessed);
  const cost: OcrStepCost = {
    provider: 'mistral',
    model: OCR_MODEL,
    usage,
    cost_usd: estimateCostUsd(pagesProcessed),
    latency_ms,
  };

  if (returnCost) return { markdown, cost };
  return markdown;
}
