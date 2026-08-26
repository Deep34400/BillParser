/**
 * Mistral OCR — extract markdown from PDF/image using Mistral's dedicated OCR endpoint.
 * POST https://api.mistral.ai/v1/ocr (NOT chat/completions)
 */
import { getSettings } from '../../shared/settings.js';
import type { LlmUsage, OcrStepCost } from '../types/provider.js';
import { isPdf, isImage } from '../../shared/storage.js';
import { resolveProviderKey } from './resolveKey.js';

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const OCR_MODEL = 'mistral-ocr-latest';
const TIMEOUT_MS = 120_000;

/**
 * Fallback price per 1,000 pages, used only when Settings has no value.
 * Mistral bills OCR per page, not per token, so this cannot live in the
 * $/1M-token table — the editable value is Settings → mistralOcrPricePer1kPages.
 *
 * $4 is the standard rate for OCR 4.1 (docs.mistral.ai/models/ocr-4-1, checked
 * Aug 2026). This was previously 2, which is Mistral's *batch* price — but this
 * client posts to the synchronous /v1/ocr endpoint, not /v1/batch, so that
 * discount never applied and every Split-mode extraction was recorded at half
 * what it actually cost.
 *
 * Annotated pages are $5/1,000; this client does not request annotations.
 */
const MISTRAL_OCR_FALLBACK_PER_1K_PAGES = 4;

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

async function estimateCostUsd(pagesProcessed: number): Promise<number> {
  const per1k = (await getSettings()).mistralOcrPricePer1kPages ?? MISTRAL_OCR_FALLBACK_PER_1K_PAGES;
  return (pagesProcessed / 1000) * per1k;
}

/**
 * Mistral OCR reports pages, not tokens.
 *
 * This used to return pagesProcessed * 1000 invented tokens purely to fill the
 * LlmUsage shape, which made a fabricated number indistinguishable from a
 * measured one everywhere it surfaced — including the Analytics token totals.
 * Zero is honest: the cost is computed from `pages`, which is carried alongside.
 */
function usageFromPages(): LlmUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
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
  const { apiKey } = await resolveProviderKey('mistral');

  const t0 = Date.now();
  const document = buildDocumentPayload(buf);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        document,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

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
  const usage = usageFromPages();
  const pageCost = await estimateCostUsd(pagesProcessed);
  const cost: OcrStepCost = {
    provider: 'mistral',
    model: OCR_MODEL,
    usage,
    cost_usd: pageCost,
    input_cost_usd: pageCost,
    output_cost_usd: 0,
    pages: pagesProcessed,
    latency_ms,
  };

  if (returnCost) return { markdown, cost };
  return markdown;
}
