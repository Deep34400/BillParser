import { env } from '../../config/env.js';
import { getSettings } from '../../models/settings.js';
import { geminiNormalize } from '../../providers/geminiNormalize.js';
import { mistralNormalize } from '../../providers/mistralNormalize.js';
import type { ParsedInvoiceData } from '../../models/types.js';
import type { OcrStepCost } from '../../providers/types.js';

export interface StructuringResult {
  parsed: ParsedInvoiceData;
  cost: OcrStepCost;
  provider: string;
  /** Set when Gemini was tried first but Mistral fallback was used. */
  geminiError?: string;
}

/** Env override → Settings UI → default mistral. */
export async function resolveStructuringProvider(): Promise<'gemini' | 'mistral'> {
  const envProvider = process.env.NORMALIZE_PROVIDER?.trim().toLowerCase();
  if (envProvider === 'gemini' || envProvider === 'mistral') return envProvider;

  const settings = await getSettings();
  const fromSettings = settings.structuringProvider?.trim().toLowerCase();
  if (fromSettings === 'gemini' || fromSettings === 'mistral') return fromSettings;

  return 'mistral';
}

/**
 * Structure OCR markdown → ParsedInvoiceData.
 * OCR is always Mistral; this step uses Gemini when configured, with Mistral fallback.
 */
export async function runStructuring(rawOcr: string, contextId = 'ocr'): Promise<StructuringResult> {
  const prefer = await resolveStructuringProvider();

  if (prefer === 'gemini') {
    if (!env.geminiApiKey) {
      console.warn(`[OCR] ${contextId} — Gemini selected but GEMINI_API_KEY is not set — using Mistral`);
    } else {
      try {
        console.log(`[OCR] ${contextId} — calling Gemini for structuring...`);
        const r = await geminiNormalize(rawOcr, true);
        console.log(
          `[OCR] ${contextId} — Gemini structuring done (${r.cost.latency_ms}ms, ${r.cost.usage.total_tokens} tokens, $${r.cost.cost_usd.toFixed(4)})`,
        );
        return { parsed: r.parsed, cost: r.cost, provider: 'gemini' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[OCR] ${contextId} — Gemini structuring FAILED: ${msg}`);
        console.warn(`[OCR] ${contextId} — falling back to Mistral for structuring...`);
        const r = await mistralNormalize(rawOcr, true);
        console.log(
          `[OCR] ${contextId} — Mistral fallback structuring done (${r.cost.latency_ms}ms, ${r.cost.usage.total_tokens} tokens, $${r.cost.cost_usd.toFixed(4)})`,
        );
        return { parsed: r.parsed, cost: r.cost, provider: 'mistral', geminiError: msg };
      }
    }
  }

  console.log(`[OCR] ${contextId} — calling Mistral for structuring...`);
  const r = await mistralNormalize(rawOcr, true);
  console.log(
    `[OCR] ${contextId} — Mistral structuring done (${r.cost.latency_ms}ms, ${r.cost.usage.total_tokens} tokens, $${r.cost.cost_usd.toFixed(4)})`,
  );
  return { parsed: r.parsed, cost: r.cost, provider: 'mistral' };
}
