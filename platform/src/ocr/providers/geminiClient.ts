/**
 * Vertex AI Gemini via Application Default Credentials (ADC).
 * On Cloud Run the runtime service account is used automatically.
 * Locally: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { GoogleAuth } from 'google-auth-library';
import { env } from '../../config/env.js';
import { getSettings } from '../../shared/settings.js';
import { computeLlmCost, resolveModelPricing, type ModelPrice } from '../../shared/modelPricing.js';
import type { LlmUsage, OcrStepCost } from '../types/provider.js';

const TIMEOUT_MS = 120_000;

/**
 * Cap on Gemini reasoning tokens per call.
 *
 * Thinking dominates both latency and cost here: on observed invoices it was
 * 55–76% of billed output, and a run that used 2,527 thinking tokens took 20.1s
 * against 6.9s for one that used 726 — driven by reasoning, not document size.
 * It also shares maxOutputTokens with the answer, so an unbounded run can starve
 * the JSON and produce a truncated, unparseable response.
 *
 * It must be bounded, not switched off. Measured against a GST invoice with a
 * discount: thinkingBudget 0 got the arithmetic wrong every time (₹8,083 against
 * a correct ₹7,080 — a 14% error on the total), while 256 and above were correct
 * on every attempt. Anything that silently disables thinking corrupts the
 * extracted figures.
 *
 * 2048 leaves the observed range (726–988) untouched and clips only the tail.
 *
 * Uses thinkingBudget rather than thinkingLevel deliberately: thinkingLevel is
 * rejected outright by the 2.5 family, gemini-3.7-flash and
 * gemini-3.1-pro-preview (HTTP 400), and 'minimal' silently means zero thinking
 * on 3.5/3.6-flash. thinkingBudget is accepted by every model on offer.
 */
const THINKING_BUDGET_DEFAULT = 2048;
/** Hard floor. Below this the model starts getting invoice arithmetic wrong, and
 *  it fails silently, so no configured value is allowed underneath it. */
export const THINKING_BUDGET_MIN = 1024;
export const THINKING_BUDGET_MAX = 8192;

/** Clamp a configured budget into the safe range. */
export function resolveThinkingBudget(configured?: number | null): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return THINKING_BUDGET_DEFAULT;
  return Math.min(THINKING_BUDGET_MAX, Math.max(THINKING_BUDGET_MIN, Math.round(configured)));
}

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/** $/1K rates — Settings UI overrides win, else DEFAULT_MODEL_PRICING. */
export function geminiPricing(
  model: string,
  overrides?: Record<string, ModelPrice> | null,
  promptTokens?: number,
): { input: number; output: number } {
  return resolveModelPricing(model, overrides, promptTokens);
}

export interface CostBreakdown {
  cost_usd: number;
  input_cost_usd: number;
  output_cost_usd: number;
  /**
   * The $/1M rates this cost was computed with, so the figure stays reproducible
   * (tokens × rate = cost) after someone edits pricing in Settings. Without them
   * a historical cost cannot be audited — only taken on faith.
   */
  input_rate_per_1m: number;
  output_rate_per_1m: number;
}

export function estimateGeminiCostUsd(
  usage: LlmUsage,
  model: string,
  overrides?: Record<string, ModelPrice> | null,
): CostBreakdown {
  return computeLlmCost(usage, model, overrides);
}

export interface GeminiGenerateResult {
  text: string;
  usage: LlmUsage;
  latency_ms: number;
  model: string;
  authMode: 'api_key' | 'adc';
}

/**
 * ALL Gemini models use the Vertex **global** endpoint + ADC.
 * Regional us-central1 returns 404 for Gemini 3.x; using global for 2.5 as well
 * keeps one consistent path and higher availability.
 */
export function resolveGeminiVertexLocation(_model: string): string {
  return 'global';
}

function vertexUrl(model: string): string {
  const project = env.projectId;
  const location = resolveGeminiVertexLocation(model);
  // Global endpoint uses aiplatform.googleapis.com (not global-aiplatform.googleapis.com)
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function parseGeminiResponse(json: any): { text: string; usage: LlmUsage } {
  const text = extractGeminiText(json);
  const meta = json.usageMetadata ?? {};
  const prompt_tokens = meta.promptTokenCount ?? 0;
  const completion_tokens = meta.candidatesTokenCount ?? 0;
  const total_tokens = meta.totalTokenCount ?? (prompt_tokens + completion_tokens);
  // Thinking tokens: explicit field, or gap between total and (input + output)
  const thinking_tokens =
    meta.thoughtsTokenCount ??
    Math.max(0, total_tokens - prompt_tokens - completion_tokens);
  const usage: LlmUsage = {
    prompt_tokens,
    completion_tokens,
    thinking_tokens,
    total_tokens,
  };
  return { text, usage };
}

/**
 * Gemini 3.x thinking models put reasoning in parts with `thought: true`
 * (or as the first part). We must skip thoughts and pick the JSON answer.
 */
export function extractGeminiText(json: any): string {
  const parts: Array<{ text?: string; thought?: boolean }> =
    json?.candidates?.[0]?.content?.parts ?? [];
  const answerParts: string[] = [];
  const allParts: string[] = [];
  for (const p of parts) {
    if (!p?.text) continue;
    allParts.push(p.text);
    if (p.thought === true) continue;
    answerParts.push(p.text);
  }
  const candidates = answerParts.length > 0 ? answerParts : allParts;
  if (candidates.length === 0) return '';
  // Prefer a part that looks like invoice JSON
  const jsonish = candidates.find((t) => {
    const s = t.trim();
    return (
      s.startsWith('{') ||
      s.startsWith('[') ||
      s.includes('"parsed_data"') ||
      s.includes('"company_name"') ||
      s.includes('"output"')
    );
  });
  return (jsonish ?? candidates.join('\n')).trim();
}

function isGemini3Family(model: string): boolean {
  return /^gemini-3/i.test(model) || /^gemini-(flash|pro)-latest$/i.test(model);
}

/**
 * Always Vertex AI + ADC for Gemini (no API key).
 * Model comes from Settings (singleModel / structuringModel).
 */
export async function geminiGenerateContent(opts: {
  model: string;
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  /** Ignored — Gemini uses ADC only */
  apiKey?: string;
}): Promise<GeminiGenerateResult> {
  const t0 = Date.now();
  const gemini3 = isGemini3Family(opts.model);
  const thinkingBudget = resolveThinkingBudget((await getSettings()).thinkingBudget);
  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    // Thinking models consume output budget for reasoning — give headroom for the JSON.
    maxOutputTokens: gemini3 ? 65536 : 16384,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget },
  };

  const body = {
    contents: [{ role: 'user', parts: opts.parts.map((p) => {
      if (p.inlineData) {
        return { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return { text: p.text ?? '' };
    }) }],
    generationConfig,
  };

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('ADC failed — no access token for Vertex Gemini. Run: gcloud auth application-default login');
  const url = vertexUrl(opts.model);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token.token}`,
  };
  // Helps user ADC bill/quota against the correct GCP project
  if (env.projectId) headers['x-goog-user-project'] = env.projectId;
  const authMode = 'adc' as const;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    let hint = '';
    if (res.status === 403) {
      hint = ' — grant your ADC user roles/aiplatform.user on this GCP project (Vertex AI User)';
    } else if (res.status === 404 && /^gemini-3/i.test(opts.model)) {
      hint = ' — Gemini 3.x models require the Vertex global endpoint (auto-routed); check model ID spelling and project access';
    }
    throw new Error(`Gemini (${authMode}, model=${opts.model}) HTTP ${res.status}${hint}: ${err.slice(0, 400)}`);
  }

  const json = await res.json();
  const { text, usage } = parseGeminiResponse(json);
  if (!text) throw new Error(`Gemini (${authMode}) returned empty response`);

  return { text, usage, latency_ms, model: opts.model, authMode };
}

/** Loads Settings overrides (if any), then estimates cost from usage. */
export async function toGeminiStepCost(r: GeminiGenerateResult): Promise<OcrStepCost> {
  const settings = await getSettings();
  const breakdown = estimateGeminiCostUsd(r.usage, r.model, settings.modelPricing);
  return {
    provider: 'gemini',
    model: r.model,
    usage: r.usage,
    ...breakdown,
    latency_ms: r.latency_ms,
  };
}
