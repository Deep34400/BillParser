/**
 * Single-call OCR+structure: PDF/image → ParsedInvoiceData in one LLM call.
 * Supports: Gemini, Claude, OpenAI (vision), Mistral Pixtral (images).
 * Each call has a 120s timeout.
 */
import { STRUCTURING_PROMPT } from '../parser/prompt.js';
import { structureFromLlmResponse } from '../parser/parser.js';
import type { ParsedInvoiceData } from '../types/invoice.js';
import type { LlmUsage, OcrStepCost } from '../types/provider.js';
import { resolveProviderKey } from './resolveKey.js';
import { geminiGenerateContent, toGeminiStepCost } from './geminiClient.js';
import { isPdf } from '../../shared/storage.js';
import { getSettings } from '../../shared/settings.js';
import { resolveModelPricing } from '../../shared/modelPricing.js';

const TIMEOUT_MS = 120_000;

export interface SingleResult {
  parsed: ParsedInvoiceData;
  rawOcr: string;
  cost: OcrStepCost;
}

export const SINGLE_PROVIDERS = ['gemini', 'claude', 'openai', 'mistral'] as const;
export type SingleProvider = (typeof SINGLE_PROVIDERS)[number];

function detectMime(buf: Buffer): string {
  if (isPdf(buf)) return 'application/pdf';
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

function estimateCost(usage: LlmUsage, pricing: { input: number; output: number }): { cost_usd: number; input_cost_usd: number; output_cost_usd: number } {
  const input_cost_usd = (usage.prompt_tokens / 1000) * pricing.input;
  const output_cost_usd = (usage.completion_tokens / 1000) * pricing.output;
  return { cost_usd: input_cost_usd + output_cost_usd, input_cost_usd, output_cost_usd };
}

/** Load Settings UI overrides → $/1K for this model (else code defaults). */
async function pricingForModel(model: string): Promise<{ input: number; output: number }> {
  const settings = await getSettings();
  return resolveModelPricing(model, settings.modelPricing);
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

const USER_TEXT = STRUCTURING_PROMPT + '\n\nExtract all data from this document and return only JSON.';

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
  const mime = detectMime(buf);
  const b64 = buf.toString('base64');
  const t0 = Date.now();

  const mediaBlock = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16384,
      temperature: 0,
      system: STRUCTURING_PROMPT,
      messages: [{
        role: 'user',
        content: [mediaBlock, { type: 'text', text: 'Extract all data from this document and return only JSON.' }],
      }],
    }),
  });

  const latency_ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Claude single HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = (json.content ?? []).map((b: any) => b.text ?? '').join('');
  if (!text) throw new Error('Claude single returned empty response');

  const usage: LlmUsage = {
    prompt_tokens: json.usage?.input_tokens ?? 0,
    completion_tokens: json.usage?.output_tokens ?? 0,
    total_tokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
  };
  const breakdown = estimateCost(usage, await pricingForModel(model));
  const cost: OcrStepCost = {
    provider: 'claude',
    model,
    usage,
    ...breakdown,
    latency_ms,
  };

  const structured = structureFromLlmResponse(text, '');
  if (!structured.parsedData) throw new Error('Claude single returned no parsed_data');
  return { parsed: structured.parsedData, rawOcr: text, cost };
}

async function openaiSingle(buf: Buffer, modelOverride?: string): Promise<SingleResult> {
  const { apiKey, model } = await resolveProviderKey('openai', modelOverride);
  const mime = detectMime(buf);
  if (mime === 'application/pdf') {
    throw new Error('OpenAI single mode supports images only (JPEG/PNG/WebP). Use Split mode or Gemini/Claude for PDF.');
  }

  const t0 = Date.now();
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
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
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  const latency_ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI single HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('OpenAI single returned empty response');

  const usage: LlmUsage = {
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
    total_tokens: json.usage?.total_tokens ?? 0,
  };
  const breakdown = estimateCost(usage, await pricingForModel(model));
  const cost: OcrStepCost = {
    provider: 'openai',
    model,
    usage,
    ...breakdown,
    latency_ms,
  };

  const structured = structureFromLlmResponse(text, '');
  if (!structured.parsedData) throw new Error('OpenAI single returned no parsed_data');
  return { parsed: structured.parsedData, rawOcr: text, cost };
}

async function mistralSingle(buf: Buffer, modelOverride?: string): Promise<SingleResult> {
  const mime = detectMime(buf);

  // PDF: Mistral has no true one-shot PDF→JSON. Honour Settings "Single + Mistral"
  // by running OCR + structure with Mistral only (no fallback to "split" mode).
  if (mime === 'application/pdf') {
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
    return { parsed: structured.parsed, rawOcr: ocr.markdown, cost };
  }

  const { apiKey, model } = await resolveProviderKey('mistral', modelOverride ?? 'pixtral-12b-2409');
  const t0 = Date.now();
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const visionModel = model.startsWith('pixtral') || model.includes('vision') ? model : 'pixtral-12b-2409';

  const res = await fetchWithTimeout('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: visionModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 16384,
      messages: [
        { role: 'system', content: STRUCTURING_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all data from this document and return only JSON.' },
            { type: 'image_url', image_url: dataUrl },
          ],
        },
      ],
    }),
  });

  const latency_ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Mistral single HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Mistral single returned empty response');

  const usage: LlmUsage = {
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
    total_tokens: json.usage?.total_tokens ?? 0,
  };
  const mistralBreakdown = estimateCost(usage, await pricingForModel(visionModel));
  const cost: OcrStepCost = {
    provider: 'mistral',
    model: visionModel,
    usage,
    ...mistralBreakdown,
    latency_ms,
  };

  const structured = structureFromLlmResponse(text, '');
  if (!structured.parsedData) throw new Error('Mistral single returned no parsed_data');
  return { parsed: structured.parsedData, rawOcr: text, cost };
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
    default:
      throw new Error(`Single mode does not support provider "${provider}". Use: ${SINGLE_PROVIDERS.join(', ')}`);
  }
}
