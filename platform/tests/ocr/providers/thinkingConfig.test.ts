/**
 * Guards the Gemini thinking configuration.
 *
 * Verified against the live Vertex API (Aug 2026), every model on offer:
 *
 *   model                    none    level:minimal  level:low   budget
 *   gemini-2.5-flash          809    REJECT 400     REJECT 400  ok
 *   gemini-2.5-pro            909    REJECT 400     REJECT 400  ok
 *   gemini-2.5-flash-lite       0    REJECT 400     REJECT 400  ok
 *   gemini-3.5-flash          531    0 (disabled)   486         ok
 *   gemini-3.6-flash          354    0 (disabled)   118         ok
 *   gemini-3.7-flash          399    REJECT 400     191         ok
 *   gemini-3.1-pro-preview    383    REJECT 400     311         ok
 *
 * Two conclusions, both encoded below:
 *
 *  - thinkingLevel is unusable. It 400s on the entire 2.5 family plus 3.7-flash
 *    and 3.1-pro-preview, and 'minimal' silently means zero thinking on
 *    3.5/3.6-flash. thinkingBudget is accepted everywhere.
 *
 *  - Thinking must be bounded, never disabled. With thinkingBudget 0 the model
 *    got invoice arithmetic wrong on every attempt (₹8,083 against a correct
 *    ₹7,080); at 256 and above it was right every time. A config that zeroes
 *    thinking corrupts extracted financial figures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveThinkingBudget, THINKING_BUDGET_MIN, THINKING_BUDGET_MAX } from '../../../src/ocr/providers/geminiClient.js';

describe('resolveThinkingBudget', () => {
  it('refuses to go below the floor, however it is configured', () => {
    // The floor exists because a too-small budget makes the model get invoice
    // arithmetic wrong, and the failure is silent.
    for (const bad of [0, -1, 1, 256, 512, 1023]) {
      expect(resolveThinkingBudget(bad), String(bad)).toBe(THINKING_BUDGET_MIN);
    }
  });

  it('caps runaway values so latency stays bounded', () => {
    expect(resolveThinkingBudget(1_000_000)).toBe(THINKING_BUDGET_MAX);
  });

  it('passes through values inside the safe range', () => {
    for (const ok of [1024, 2048, 4096, 8192]) {
      expect(resolveThinkingBudget(ok), String(ok)).toBe(ok);
    }
  });

  it('falls back to the default when unset or nonsense', () => {
    for (const v of [undefined, null, NaN, Infinity]) {
      const r = resolveThinkingBudget(v as number);
      expect(r).toBeGreaterThanOrEqual(THINKING_BUDGET_MIN);
      expect(r).toBeLessThanOrEqual(THINKING_BUDGET_MAX);
    }
  });
});

function captureRequestBody() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    }),
    text: () => Promise.resolve(''),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Gemini thinking configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('google-auth-library', () => ({
      GoogleAuth: class {
        getClient() { return Promise.resolve({ getAccessToken: () => Promise.resolve({ token: 't' }) }); }
      },
    }));
    vi.doMock('../../../src/shared/settings.js', () => ({
      getSettings: vi.fn().mockResolvedValue({}),
    }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  async function configFor(model: string) {
    const fetchMock = captureRequestBody();
    const { geminiGenerateContent } = await import('../../../src/ocr/providers/geminiClient.js');
    await geminiGenerateContent({ model, parts: [{ text: 'x' }] });
    return JSON.parse(fetchMock.mock.calls[0][1].body as string).generationConfig;
  }

  const MODELS = [
    'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite',
    'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview',
  ];

  it('sends thinkingBudget for every model, never thinkingLevel', async () => {
    for (const model of MODELS) {
      const cfg = await configFor(model);
      expect(cfg.thinkingConfig, model).toBeDefined();
      expect(cfg.thinkingConfig.thinkingBudget, model).toBeTypeOf('number');
      // thinkingLevel 400s on 2.5-*, 3.7-flash and 3.1-pro-preview.
      expect(cfg.thinkingConfig.thinkingLevel, model).toBeUndefined();
    }
  });

  it('never disables thinking — zero produced wrong invoice arithmetic', async () => {
    for (const model of MODELS) {
      const cfg = await configFor(model);
      // 256 was the lowest budget that stayed correct across repeated trials.
      expect(cfg.thinkingConfig.thinkingBudget, model).toBeGreaterThanOrEqual(256);
    }
  });

  it('bounds thinking so latency and cost cannot run away', async () => {
    // An uncapped run used 2,527 thinking tokens and took 20.1s, against 6.9s
    // for 726 on a comparable document.
    const cfg = await configFor('gemini-2.5-flash');
    expect(cfg.thinkingConfig.thinkingBudget).toBeLessThanOrEqual(4096);
  });

  it('leaves the answer far more output budget than thinking can consume', async () => {
    // Thinking shares maxOutputTokens with the answer; if it starves the answer
    // the JSON comes back truncated and unparseable.
    for (const model of MODELS) {
      const cfg = await configFor(model);
      expect(cfg.maxOutputTokens - cfg.thinkingConfig.thinkingBudget, model).toBeGreaterThan(8000);
    }
  });
});
