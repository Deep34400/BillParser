/**
 * Odometer OCR Service — extract odometer reading from vehicle dashboard images.
 * Uses a LIGHTWEIGHT Gemini call (no thinking mode, small token budget)
 * for fast, cheap, accurate digit reading.
 */
import { GoogleAuth } from 'google-auth-library';
import { resolveProviderKey } from '../ocr/providers/resolveKey.js';
import { getSettings, type AppSettings } from '../shared/settings.js';
import { env } from '../config/env.js';

import { ODOMETER_TIMEOUT_MS as TIMEOUT_MS } from '../shared/ocrConstants.js';
const MIN_ACCEPT_CONFIDENCE = 0.55;
const MAX_PLAUSIBLE_JUMP_KM = 2000;

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const ODOMETER_PROMPT = `You are an expert at reading vehicle odometer displays from dashboard photos.

TASK: Extract the TOTAL DISTANCE (odometer / km) reading as an INTEGER.

CRITICAL RULES:
- Vehicle odometers ALWAYS display WHOLE INTEGERS. There is NO decimal point. If you think you see a period, it is either:
  (a) a visual artifact / pixel gap between segments, OR
  (b) a digit separator (some vehicles use dots between digit groups), OR
  (c) a decimal for tenths-of-km — ignore everything after it and combine all digits before/after as the full number
  IMPORTANT: "72691" should NOT be read as "7269.1" — count ALL digits as one integer.

IDENTIFICATION:
1. The odometer shows TOTAL km driven. It is usually:
   - Labeled "ODO" or "km" (without "/l" or "/h" after it)
   - Has 4-6 digits (e.g. 7175, 72691, 125000)
   - Located in the instrument cluster / dashboard center
2. CRITICAL DISTINCTIONS — DO NOT confuse these with the odometer:
   - "km/l" or "km/L" or "L/100km" = FUEL EFFICIENCY (not odometer!)
   - "km/h" or "mph" = SPEED (not odometer!)
   - Numbers that are part of a "AVG" or "average" display = fuel average
   - TRIP A / TRIP B = trip meter
   - Very large numbers (over 500000) = likely NOT odometer, could be total engine revolutions
3. If you see a number like "7.175" with "km/l" nearby — that is FUEL EFFICIENCY, not the odometer
4. The odometer reading is a plain integer (e.g. "7175 km" or "72691 km") WITHOUT per-unit division

READING DIGITS:
- Count the total number of digits first, then read each one LEFT to RIGHT
- If you see a dot/period between digits, IGNORE it and read all digits as one number
- For 7-segment displays: 8 vs 0 difference is the middle bar only

RESPOND with ONLY this JSON (no markdown, no extra text):
{"odometer_km": <integer or null>, "confidence": <0.0-1.0>, "raw_text": "<exactly what digits you see on the odometer display>", "notes": "<which display you identified as ODO and why>"}`;

const DISAMBIGUATION_PROMPT = `Look at this vehicle dashboard image again. I need the ODOMETER reading (total km driven).

Previous attempts found these numbers in the image but couldn't determine which is the odometer:
CONTEXT: {{context}}

The odometer is:
- A total cumulative distance (km), NOT fuel efficiency (km/l), NOT speed (km/h)
- Usually 4-6 digits in the range 100 to 500000
- Does NOT have "/l" or "/h" after it
- If you see "7.175" displayed and it says "km" (not "km/l"), then the odometer is 7175 (ignore the decimal)

Look carefully at ALL numbers on the dashboard. Which one is the odometer?

RESPOND with ONLY this JSON:
{"odometer_km": <integer or null>, "confidence": <0.0-1.0>, "raw_text": "<digits>", "notes": "<reasoning>"}`;


export interface OdometerResult {
  odometer_km: number | null;
  confidence: number;
  raw_text: string;
  notes: string;
  provider: string;
  model: string;
  latency_ms: number;
  pipelineMode: 'single' | 'split';
}

export interface OdometerExtractionResult {
  primary: OdometerResult;
  secondary?: OdometerResult;
  final_km: number | null;
  needsReview: boolean;
  reviewReason: string;
  pipelineMode: 'single' | 'split';
  providers: { extraction: string; structuring: string };
}

function detectImageMime(buf: Buffer): string {
  if (buf[0] === 0x89) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return 'image/jpeg';
}

export function parseOdometerResponse(text: string): { odometer_km: number | null; confidence: number; raw_text: string; notes: string } {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      odometer_km: parsed.odometer_km != null ? Number(parsed.odometer_km) : null,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      raw_text: String(parsed.raw_text ?? ''),
      notes: String(parsed.notes ?? ''),
    };
  } catch {
    throw new Error(`Failed to parse JSON from response: ${cleaned.slice(0, 200)}`);
  }
}

/* ─── Lightweight Gemini Call (no thinking, small tokens) ───────────────── */

function vertexUrl(model: string): string {
  const project = env.projectId;
  return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
}

async function geminiOdometerCall(
  model: string,
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
): Promise<{ text: string; latency_ms: number }> {
  const t0 = Date.now();

  const body = {
    contents: [{ role: 'user', parts: parts.map((p) => {
      if (p.inlineData) return { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } };
      return { text: p.text ?? '' };
    }) }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
    },
  };

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('ADC failed — no access token');

  const url = vertexUrl(model);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token.token}`,
  };
  if (env.projectId) headers['x-goog-user-project'] = env.projectId;

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
    throw new Error(`Gemini (model=${model}) HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  // Extract text from ALL parts, preferring non-thought parts but falling back to thought parts
  const allParts = json?.candidates?.[0]?.content?.parts ?? [];
  const nonThoughtParts: string[] = allParts
    .filter((p: any) => p?.text && !p?.thought)
    .map((p: any) => p.text);
  const thoughtParts: string[] = allParts
    .filter((p: any) => p?.text && p?.thought)
    .map((p: any) => p.text);

  let text = nonThoughtParts.join('\n').trim();
  // If no non-thought text, check thought parts for JSON
  if (!text && thoughtParts.length) {
    const combined = thoughtParts.join('\n');
    const jsonInThought = combined.match(/\{[\s\S]*"odometer_km"[\s\S]*\}/);
    if (jsonInThought) text = jsonInThought[0];
  }
  if (!text) throw new Error('Gemini returned empty response');

  return { text, latency_ms };
}

/* ─── Provider Functions ────────────────────────────────────────────────── */

async function extractGemini(buf: Buffer, prompt: string, modelOverride?: string): Promise<OdometerResult> {
  const { model } = await resolveProviderKey('gemini', modelOverride);
  const mime = detectImageMime(buf);

  const r = await geminiOdometerCall(model, [
    { inlineData: { mimeType: mime, data: buf.toString('base64') } },
    { text: prompt },
  ]);

  const parsed = parseOdometerResponse(r.text);
  return { ...parsed, provider: 'gemini', model, latency_ms: r.latency_ms, pipelineMode: 'single' };
}

async function extractMistral(buf: Buffer, modelOverride?: string): Promise<OdometerResult> {
  const { apiKey, model } = await resolveProviderKey('mistral', modelOverride ?? 'pixtral-12b-2409');
  const mime = detectImageMime(buf);
  const visionModel = model.startsWith('pixtral') || model.includes('vision') ? model : 'pixtral-12b-2409';
  const t0 = Date.now();
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: 512,
        messages: [
          { role: 'system', content: ODOMETER_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Read the odometer value from this vehicle dashboard image.' },
            { type: 'image_url', image_url: dataUrl },
          ] },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const latency_ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Mistral vision HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Mistral returned empty response');

  const parsed = parseOdometerResponse(text);
  return { ...parsed, provider: 'mistral', model: visionModel, latency_ms, pipelineMode: 'single' };
}

/* ─── Disambiguation Helpers ─────────────────────────────────────────────── */

function extractNumberFromNotes(notes: string): number | null {
  const matches = notes.match(/\d[\d.,]*\d/g);
  if (!matches) return null;
  for (const m of matches) {
    const clean = m.replace(/[.,]/g, '');
    const num = parseInt(clean, 10);
    if (num >= 1 && num <= 999999) return num;
  }
  return null;
}

async function tryDisambiguate(buf: Buffer, context: string, modelOverride?: string): Promise<OdometerResult | null> {
  try {
    // Strategy 1: Ask Gemini with disambiguation prompt
    const prompt = DISAMBIGUATION_PROMPT.replace('{{context}}', context);
    const geminiResult = await extractGemini(buf, prompt, modelOverride);
    if (geminiResult.odometer_km != null && geminiResult.confidence >= 0.6) {
      geminiResult.notes += ' | (disambiguation pass)';
      return geminiResult;
    }
  } catch { /* continue to strategy 2 */ }

  try {
    // Strategy 2: Ask Mistral to list ALL numbers, then interpret
    const { apiKey } = await resolveProviderKey('mistral', 'pixtral-12b-2409');
    const mime = detectImageMime(buf);
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    const t0 = Date.now();

    const listPrompt = `List ALL numbers/readings visible on this vehicle dashboard image. Include EVERY number you can see, even small ones (2-3 digits). For each number, tell me:
1. The exact digits you see
2. What unit is next to it (km, km/l, km/h, rpm, °C, etc.) — if no unit is visible, write "none"
3. Where it is on the display (top/bottom/center/left/right)

Then determine: which number is the ODOMETER (total distance in km)?
- The odometer shows "km" (NOT "km/l" which is fuel efficiency, NOT "km/h" which is speed)
- It can be a SMALL number for new vehicles (e.g. 18, 34, 100 km)
- If you see "7.175" followed by just "km" (not km/l), the odometer is 7175 km (ignore the decimal)
- The odometer is often near the speedometer, sometimes displayed as just 2-3 digits for new vehicles
- Look for numbers with NO /l or /h suffix — just plain "km" or just digits near the speedometer

Return JSON: {"all_numbers": [{"value": "...", "unit": "...", "position": "..."}], "odometer_km": <integer or null>, "confidence": <0.0-1.0>, "raw_text": "<digits>", "notes": "<reasoning>"}`;

    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'pixtral-12b-2409',
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        messages: [
          { role: 'user', content: [
            { type: 'text', text: listPrompt },
            { type: 'image_url', image_url: dataUrl },
          ] },
        ],
      }),
    });

    const latency_ms = Date.now() - t0;
    if (!res.ok) return null;

    const json = await res.json() as any;
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) return null;

    console.log(`[OdometerOCR] Disambiguation (Mistral list): ${text.slice(0, 300)}`);

    const parsed = parseOdometerResponse(text);
    if (parsed.odometer_km != null && parsed.confidence >= 0.5) {
      return { ...parsed, provider: 'mistral', model: 'pixtral-12b-2409', latency_ms, pipelineMode: 'single' };
    }

    // If Mistral still returned null but listed numbers, try to extract from all_numbers
    try {
      const fullParsed = JSON.parse(text.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/)?.[0] ?? '{}');
      if (fullParsed.all_numbers?.length) {
        console.log(`[OdometerOCR] All numbers found:`, JSON.stringify(fullParsed.all_numbers));
        // Look for a number with "km" unit (not km/l, km/h)
        for (const num of fullParsed.all_numbers) {
          const unit = String(num.unit || '').toLowerCase().trim();
          if (unit === 'km' || unit === 'none') {
            const val = parseInt(String(num.value).replace(/[.,\s]/g, ''), 10);
            if (val >= 1 && val <= 999999) {
              return { odometer_km: val, confidence: unit === 'km' ? 0.75 : 0.6, raw_text: String(num.value), notes: `From all_numbers list: ${JSON.stringify(num)} | (disambiguation)`, provider: 'mistral', model: 'pixtral-12b-2409', latency_ms, pipelineMode: 'single' };
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }

    return null;
  } catch {
    return null;
  }
}

/* ─── Main Extraction ───────────────────────────────────────────────────── */

/**
 * PRODUCTION APPROACH: Call Gemini + Mistral in PARALLEL, use consensus.
 * - If both agree → high confidence result
 * - If they disagree → flag for review, pick higher confidence
 * - Time cost ≈ max(gemini, mistral) since parallel
 * - Accuracy dramatically improved over single model
 */
export async function extractOdometerReading(
  buf: Buffer,
  options?: { crossVerify?: boolean; lastKnownKm?: number },
): Promise<OdometerExtractionResult> {
  let settings: AppSettings;
  try {
    settings = await getSettings();
  } catch {
    settings = { pipelineMode: 'single', singleProvider: 'gemini', singleModel: 'gemini-2.5-flash', extractionProvider: 'mistral', structuringProvider: 'gemini', structuringModel: 'gemini-2.5-flash' };
  }

  const singleModel = settings.singleModel;

  // Always run both providers in parallel for accuracy
  const [geminiResult, mistralResult] = await Promise.allSettled([
    extractGemini(buf, ODOMETER_PROMPT, singleModel),
    extractMistral(buf),
  ]);

  const geminiOk = geminiResult.status === 'fulfilled' ? geminiResult.value : null;
  const mistralOk = mistralResult.status === 'fulfilled' ? mistralResult.value : null;

  if (geminiResult.status === 'rejected') {
    console.warn(`[OdometerOCR] Gemini failed: ${geminiResult.reason?.message}`);
  }
  if (mistralResult.status === 'rejected') {
    console.warn(`[OdometerOCR] Mistral failed: ${mistralResult.reason?.message}`);
  }

  let primary: OdometerResult;
  let secondary: OdometerResult | undefined;
  let needsReview = false;
  const reviewReasons: string[] = [];

  if (geminiOk && mistralOk) {
    // Both succeeded — check consensus
    const gVal = geminiOk.odometer_km;
    const mVal = mistralOk.odometer_km;

    console.log(`[OdometerOCR] Gemini=${gVal} (conf=${geminiOk.confidence.toFixed(2)}), Mistral=${mVal} (conf=${mistralOk.confidence.toFixed(2)})`);

    if (gVal != null && mVal != null) {
      const diff = Math.abs(gVal - mVal);
      const maxVal = Math.max(gVal, mVal);
      const pctDiff = maxVal > 0 ? diff / maxVal : 0;

      if (pctDiff <= 0.01) {
        // CONSENSUS — both agree (within 1%)
        primary = geminiOk.confidence >= mistralOk.confidence ? geminiOk : mistralOk;
        secondary = geminiOk.confidence >= mistralOk.confidence ? mistralOk : geminiOk;
        primary.notes += ' | ✓ Dual-provider consensus';
      } else {
        // DIVERGENCE — try disambiguation
        const context = `Gemini read: ${gVal} (raw: "${geminiOk.raw_text}", notes: "${geminiOk.notes}"). Mistral read: ${mVal} (raw: "${mistralOk.raw_text}", notes: "${mistralOk.notes}").`;
        const disambiguated = await tryDisambiguate(buf, context, settings.singleModel);
        if (disambiguated) {
          primary = disambiguated;
          secondary = geminiOk.confidence >= mistralOk.confidence ? geminiOk : mistralOk;
        } else {
          needsReview = true;
          reviewReasons.push(`Providers disagree: Gemini=${gVal}, Mistral=${mVal}`);
          primary = mistralOk.confidence > geminiOk.confidence ? mistralOk : geminiOk;
          secondary = mistralOk.confidence > geminiOk.confidence ? geminiOk : mistralOk;
        }
      }
    } else if (gVal != null && mVal == null) {
      // Mistral returned null — this is suspicious, especially if Gemini's value is very high
      if (gVal > 500000) {
        // Suspiciously high — most vehicles don't reach 500K km. Disambiguate.
        const context = `Gemini read: ${gVal}km but this seems very high. Mistral could not find the odometer and noted: "${mistralOk.notes}". Look for a smaller number (typically 4-6 digits in range 100-500000) that represents total km driven.`;
        const disambiguated = await tryDisambiguate(buf, context, settings.singleModel);
        if (disambiguated) {
          primary = disambiguated;
          secondary = geminiOk;
        } else {
          primary = geminiOk;
          secondary = mistralOk;
          needsReview = true;
          reviewReasons.push(`Gemini=${gVal}km (very high), Mistral found no odometer`);
        }
      } else {
        // Gemini value is reasonable, Mistral couldn't read it — use Gemini but flag
        const notesNum = extractNumberFromNotes(mistralOk.notes);
        if (notesNum != null && notesNum !== gVal) {
          const context = `Gemini read: ${gVal}. Mistral returned null but mentioned: "${mistralOk.notes}"`;
          const disambiguated = await tryDisambiguate(buf, context, settings.singleModel);
          if (disambiguated) {
            primary = disambiguated;
            secondary = geminiOk;
          } else {
            primary = geminiOk;
            secondary = mistralOk;
          }
        } else {
          primary = geminiOk;
          secondary = mistralOk;
        }
      }
    } else if (mVal != null) {
      primary = mistralOk;
      secondary = geminiOk;
    } else {
      // Both null — try disambiguation
      const context = `Gemini notes: "${geminiOk.notes}". Mistral notes: "${mistralOk.notes}"`;
      const disambiguated = await tryDisambiguate(buf, context, settings.singleModel);
      if (disambiguated) {
        primary = disambiguated;
      } else {
        primary = geminiOk;
        secondary = mistralOk;
        needsReview = true;
        reviewReasons.push('Both providers returned null');
      }
    }
  } else if (geminiOk) {
    primary = geminiOk;
    if (primary.odometer_km == null) {
      const context = `Gemini notes: "${geminiOk.notes}". Mistral call failed entirely.`;
      const disambiguated = await tryDisambiguate(buf, context, settings.singleModel);
      if (disambiguated) primary = disambiguated;
      else { needsReview = true; reviewReasons.push('Single provider returned null, other failed'); }
    }
  } else if (mistralOk) {
    primary = mistralOk;
    if (primary.odometer_km == null) {
      const context = `Mistral notes: "${mistralOk.notes}". Gemini call failed entirely.`;
      const disambiguated = await tryDisambiguate(buf, context, settings.singleModel);
      if (disambiguated) primary = disambiguated;
      else { needsReview = true; reviewReasons.push('Single provider returned null, other failed'); }
    }
  } else {
    throw new Error('Both Gemini and Mistral failed');
  }

  const final_km = primary.odometer_km;

  // Plausibility gating
  if (primary.confidence < MIN_ACCEPT_CONFIDENCE) {
    needsReview = true;
    reviewReasons.push(`Low confidence (${primary.confidence.toFixed(2)})`);
  }

  if (options?.lastKnownKm != null && final_km != null) {
    if (final_km < options.lastKnownKm) {
      needsReview = true;
      reviewReasons.push(`Reading ${final_km}km is lower than last known ${options.lastKnownKm}km`);
    } else if (final_km - options.lastKnownKm > MAX_PLAUSIBLE_JUMP_KM) {
      needsReview = true;
      reviewReasons.push(`Implausible jump of ${final_km - options.lastKnownKm}km from last known ${options.lastKnownKm}km`);
    }
  }

  return {
    primary,
    secondary,
    final_km,
    needsReview,
    reviewReason: reviewReasons.join('; '),
    pipelineMode: 'single',
    providers: { extraction: primary.provider, structuring: secondary?.provider ?? primary.provider },
  };
}

/**
 * Fetch image from a URL and return as Buffer.
 */
export async function fetchImageFromUrl(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(timer);
  }
}
