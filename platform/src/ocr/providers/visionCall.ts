/**
 * Shared helper for vision-based single-call LLM providers (Claude, OpenAI, Mistral image).
 * Each provider supplies a config describing how to build the request and parse the response.
 */
import type { LlmUsage, OcrStepCost } from '../types/provider.js';
import type { SingleResult } from './llmSingle.js';
import { structureFromLlmResponse } from '../parser/parser.js';
import { isPdf } from '../../shared/storage.js';
import { getSettings } from '../../shared/settings.js';
import { computeLlmCost } from '../../shared/modelPricing.js';
import { LLM_TIMEOUT_MS } from '../../shared/ocrConstants.js';

export interface VisionProviderConfig {
  provider: string;
  apiUrl: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildBody: (model: string, mime: string, b64: string) => unknown;
  extractText: (json: any) => string;
  extractUsage: (json: any) => LlmUsage;
}

function detectMime(buf: Buffer): string {
  if (isPdf(buf)) return 'application/pdf';
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = LLM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export async function callVisionLlm(
  buf: Buffer,
  apiKey: string,
  model: string,
  config: VisionProviderConfig,
): Promise<SingleResult> {
  const mime = detectMime(buf);
  const b64 = buf.toString('base64');
  const t0 = Date.now();

  const res = await fetchWithTimeout(config.apiUrl, {
    method: 'POST',
    headers: config.buildHeaders(apiKey),
    body: JSON.stringify(config.buildBody(model, mime, b64)),
  });

  const latency_ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`${config.provider} single HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = config.extractText(json);
  if (!text) throw new Error(`${config.provider} single returned empty response`);

  const usage = config.extractUsage(json);
  const settings = await getSettings();
  const breakdown = computeLlmCost(usage, model, settings.modelPricing);
  const cost: OcrStepCost = {
    provider: config.provider,
    model,
    usage,
    ...breakdown,
    latency_ms,
  };

  const structured = structureFromLlmResponse(text, '');
  if (!structured.parsedData) {
    throw new Error(`${config.provider} single returned no parsed_data`);
  }
  return { parsed: structured.parsedData, rawOcr: text, cost };
}
