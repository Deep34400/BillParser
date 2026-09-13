/**
 * Single-call OCR+structure: PDF/image → ParsedInvoiceData in one LLM call.
 * Supports: Gemini, Claude, OpenAI (vision), Mistral Pixtral (images).
 */
import { STRUCTURING_PROMPT } from '../parser/prompt.js';
import { structureFromLlmResponse } from '../parser/parser.js';
import type { LlmUsage, OcrStepCost } from '../types/provider.js';
import { resolveProviderKey } from './resolveKey.js';
import { getProviderCredentials } from '../../shared/settings.js';
import { azapiSingle } from './azapiOcr.js';
import { geminiGenerateContent, toGeminiStepCost } from './geminiClient.js';
import { isPdf } from '../../shared/storage.js';
import { callVisionLlm, type VisionProviderConfig } from './visionCall.js';

export interface SingleResult {
  parsed: import('../types/invoice.js').ParsedInvoiceData;
  rawOcr: string;
  /**
   * Real OCR markdown when a separate OCR step ran (Mistral PDF: mistralOcr → llmNormalize).
   * Vision-only providers (Gemini/Claude/OpenAI/Mistral image) omit this — rawOcr is LLM JSON,
   * so enrichParsedInvoice cannot apply layout-based vendor/GSTIN correction for those paths.
   */
  ocrMarkdown?: string;
  cost: OcrStepCost;
}

export const SINGLE_PROVIDERS = ['gemini', 'claude', 'openai', 'mistral', 'azapi'] as const;
export type SingleProvider = (typeof SINGLE_PROVIDERS)[number];

const USER_TEXT = STRUCTURING_PROMPT + '\n\nExtract all data from this document and return only JSON.';

// ── Provider configs for callVisionLlm ──────────────────────────

const CLAUDE_CONFIG: VisionProviderConfig = {
  provider: 'claude',
  apiUrl: 'https://api.anthropic.com/v1/messages',
  buildHeaders: (key) => ({
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  }),
  buildBody: (model, mime, b64) => {
    const mediaBlock = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
    return {
      model,
      max_tokens: 16384,
      temperature: 0,
      system: STRUCTURING_PROMPT,
      messages: [{
        role: 'user',
        content: [mediaBlock, { type: 'text', text: 'Extract all data from this document and return only JSON.' }],
      }],
    };
  },
  extractText: (json) => (json.content ?? []).map((b: any) => b.text ?? '').join(''),
  extractUsage: (json) => ({
    prompt_tokens: json.usage?.input_tokens ?? 0,
    completion_tokens: json.usage?.output_tokens ?? 0,
    total_tokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
  }),
};

const OPENAI_CONFIG: VisionProviderConfig = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  buildHeaders: (key) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
  }),
  buildBody: (model, mime, b64) => ({
    model,
    temperature: 0,
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: STRUCTURING_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all data from this document and return only JSON.' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      },
    ],
  }),
  extractText: (json) => json.choices?.[0]?.message?.content ?? '',
  extractUsage: (json) => ({
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
    total_tokens: json.usage?.total_tokens ?? 0,
  }),
};

const MISTRAL_IMAGE_CONFIG: VisionProviderConfig = {
  provider: 'mistral',
  apiUrl: 'https://api.mistral.ai/v1/chat/completions',
  buildHeaders: (key) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
  }),
  buildBody: (model, mime, b64) => ({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 16384,
    messages: [
      { role: 'system', content: STRUCTURING_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all data from this document and return only JSON.' },
          { type: 'image_url', image_url: `data:${mime};base64,${b64}` },
        ],
      },
    ],
  }),
  extractText: (json) => json.choices?.[0]?.message?.content ?? '',
  extractUsage: (json) => ({
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
    total_tokens: json.usage?.total_tokens ?? 0,
  }),
};

// ── Provider entry points ───────────────────────────────────────

function detectMime(buf: Buffer): string {
  if (isPdf(buf)) return 'application/pdf';
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

async function geminiSingle(buf: Buffer, modelOverride?: string): Promise<SingleResult> {
  const { apiKey, model } = await resolveProviderKey('gemini', modelOverride);
  const mime = detectMime(buf);
  const r = await geminiGenerateContent({
    model,
    apiKey: apiKey || undefined,
    parts: [
      { inlineData: { mimeType: mime, data: buf.toString('base64') } },
      { text: USER_TEXT },
    ],
  });
  const cost = await toGeminiStepCost(r);
  const structured = structureFromLlmResponse(r.text, '');
  if (!structured.parsedData) {
    throw new Error(
      `Gemini single returned no parsed_data (model=${r.model}): ${structured.error ?? 'unrecognized JSON'} | raw[0..300]=${(r.text ?? '').slice(0, 300)}`,
    );
  }
  return { parsed: structured.parsedData, rawOcr: r.text, cost };
}

async function claudeSingle(buf: Buffer, modelOverride?: string): Promise<SingleResult> {
  const { apiKey, model } = await resolveProviderKey('claude', modelOverride);
  return callVisionLlm(buf, apiKey, model, CLAUDE_CONFIG);
}

async function openaiSingle(buf: Buffer, modelOverride?: string): Promise<SingleResult> {
  const { apiKey, model } = await resolveProviderKey('openai', modelOverride);
  if (isPdf(buf)) {
    throw new Error('OpenAI single mode supports images only (JPEG/PNG/WebP). Use Split mode or Gemini/Claude for PDF.');
  }
  return callVisionLlm(buf, apiKey, model, OPENAI_CONFIG);
}

async function mistralSingle(buf: Buffer, modelOverride?: string): Promise<SingleResult> {
  // PDF: Mistral has no true one-shot PDF→JSON. Run OCR + structure with Mistral only.
  if (isPdf(buf)) {
    const { mistralOcr } = await import('./mistralOcr.js');
    const { llmNormalize } = await import('./llmNormalize.js');
    const t0 = Date.now();

    const ocr = await mistralOcr(buf, true);
    const structModel =
      modelOverride && !modelOverride.startsWith('pixtral') && !modelOverride.includes('vision')
        ? modelOverride
        : 'mistral-small-latest';
    const structured = await llmNormalize(ocr.markdown, 'mistral', structModel);
    const latency_ms = Date.now() - t0;

    const usage: LlmUsage = {
      prompt_tokens: (ocr.cost.usage.prompt_tokens ?? 0) + (structured.cost.usage.prompt_tokens ?? 0),
      completion_tokens: (ocr.cost.usage.completion_tokens ?? 0) + (structured.cost.usage.completion_tokens ?? 0),
      thinking_tokens: (ocr.cost.usage.thinking_tokens ?? 0) + (structured.cost.usage.thinking_tokens ?? 0),
      total_tokens: (ocr.cost.usage.total_tokens ?? 0) + (structured.cost.usage.total_tokens ?? 0),
    };
    const cost: OcrStepCost = {
      provider: 'mistral',
      model: `mistral-ocr+${structModel}`,
      usage,
      cost_usd: ocr.cost.cost_usd + structured.cost.cost_usd,
      input_cost_usd: (ocr.cost.input_cost_usd ?? 0) + (structured.cost.input_cost_usd ?? 0),
      output_cost_usd: (ocr.cost.output_cost_usd ?? 0) + (structured.cost.output_cost_usd ?? 0),
      latency_ms,
    };
    return { parsed: structured.parsed, rawOcr: ocr.markdown, ocrMarkdown: ocr.markdown, cost };
  }

  const { apiKey, model } = await resolveProviderKey('mistral', modelOverride ?? 'pixtral-12b-2409');
  const visionModel = model.startsWith('pixtral') || model.includes('vision') ? model : 'pixtral-12b-2409';
  return callVisionLlm(buf, apiKey, visionModel, MISTRAL_IMAGE_CONFIG);
}

/**
 * Run single-call OCR+structure for the selected provider + model.
 */
export async function llmSingle(buf: Buffer, provider: string, model?: string): Promise<SingleResult> {
  switch (provider) {
    case 'gemini':
      return geminiSingle(buf, model);
    case 'claude':
      return claudeSingle(buf, model);
    case 'openai':
      return openaiSingle(buf, model);
    case 'mistral':
      return mistralSingle(buf, model);
    case 'azapi': {
      const creds = await getProviderCredentials('azapi');
      const url = (creds.endpoint || creds.url || '').trim();
      const token = (creds.apiKey || '').trim();
      if (!url || !token) throw new Error('AzAPI not configured — set URL and Token in Settings');
      return azapiSingle(buf, url, token);
    }
    default:
      throw new Error(`Single mode does not support provider "${provider}". Use: ${SINGLE_PROVIDERS.join(', ')}`);
  }
}
