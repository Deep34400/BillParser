import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseOdometerResponse } from '../../src/odometerOcr/service.js';

describe('parseOdometerResponse', () => {
  it('parses valid JSON correctly', () => {
    const input = '{"odometer_km": 20144, "confidence": 0.95, "raw_text": "20144", "notes": "clear display"}';
    const result = parseOdometerResponse(input);
    expect(result.odometer_km).toBe(20144);
    expect(result.confidence).toBe(0.95);
    expect(result.raw_text).toBe('20144');
    expect(result.notes).toBe('clear display');
  });

  it('parses JSON wrapped in markdown fences', () => {
    const input = '```json\n{"odometer_km": 7175, "confidence": 0.9, "raw_text": "7175", "notes": ""}\n```';
    const result = parseOdometerResponse(input);
    expect(result.odometer_km).toBe(7175);
    expect(result.confidence).toBe(0.9);
  });

  it('parses JSON with leading prose text before it', () => {
    const input = 'Here is the extracted reading:\n{"odometer_km": 25192, "confidence": 0.85, "raw_text": "25192", "notes": "slight glare"}';
    const result = parseOdometerResponse(input);
    expect(result.odometer_km).toBe(25192);
    expect(result.confidence).toBe(0.85);
    expect(result.notes).toBe('slight glare');
  });

  it('throws on malformed JSON', () => {
    const input = '{odometer_km: not valid json}';
    expect(() => parseOdometerResponse(input)).toThrow('Failed to parse JSON');
  });

  it('throws when no JSON object is present', () => {
    const input = 'I cannot read this image clearly';
    expect(() => parseOdometerResponse(input)).toThrow('No JSON found');
  });

  it('handles missing fields — defaults confidence to 0 and odometer_km to null', () => {
    const input = '{"some_other_field": "value"}';
    const result = parseOdometerResponse(input);
    expect(result.odometer_km).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.raw_text).toBe('');
    expect(result.notes).toBe('');
  });

  it('clamps confidence to [0, 1] range', () => {
    const input = '{"odometer_km": 100, "confidence": 1.5, "raw_text": "100", "notes": ""}';
    const result = parseOdometerResponse(input);
    expect(result.confidence).toBe(1);

    const input2 = '{"odometer_km": 100, "confidence": -0.5, "raw_text": "100", "notes": ""}';
    const result2 = parseOdometerResponse(input2);
    expect(result2.confidence).toBe(0);
  });

  it('handles null odometer_km correctly', () => {
    const input = '{"odometer_km": null, "confidence": 0, "raw_text": "", "notes": "image too blurry"}';
    const result = parseOdometerResponse(input);
    expect(result.odometer_km).toBeNull();
    expect(result.notes).toBe('image too blurry');
  });

  it('handles JSON with nested braces in notes', () => {
    const input = '{"odometer_km": 34, "confidence": 0.7, "raw_text": "0034", "notes": "digit {3} uncertain"}';
    const result = parseOdometerResponse(input);
    expect(result.odometer_km).toBe(34);
    expect(result.raw_text).toBe('0034');
  });
});


/**
 * These exercise the plausibility gating, which is pure logic downstream of the
 * model call. They previously mocked src/ocr/providers/geminiClient.js and
 * mistralOcr.js — modules odometerOcr/service.ts never imports. It builds its
 * Vertex and Mistral requests with inline fetch(), so those mocks were no-ops and
 * every run hit the real APIs: Gemini 400 (RESOURCE_PROJECT_INVALID) and Mistral
 * 401, surfacing as "Both Gemini and Mistral failed".
 *
 * Mock the real boundary instead — ADC token minting and fetch.
 */
describe('extractOdometerReading plausibility gating', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('google-auth-library', () => ({
      GoogleAuth: class {
        getClient() { return Promise.resolve({ getAccessToken: () => Promise.resolve({ token: 'test-token' }) }); }
      },
    }));
    vi.doMock('../../src/ocr/providers/resolveKey.js', () => ({
      resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'gemini-2.5-flash', useAdc: true }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stub fetch so any Vertex call returns this odometer payload. */
  function stubGemini(payload: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      }),
      text: () => Promise.resolve(''),
    }));
  }

  const singleMode = () => vi.doMock('../../src/shared/settings.js', () => ({
    getSettings: vi.fn().mockResolvedValue({
      pipelineMode: 'single', singleProvider: 'gemini', singleModel: 'gemini-2.5-flash',
    }),
  }));

  const pngBuf = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);

  it('flags low confidence result with needsReview', async () => {
    singleMode();
    stubGemini({ odometer_km: 5000, confidence: 0.3, raw_text: '5000', notes: 'very blurry' });
    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const result = await extractOdometerReading(pngBuf());
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain('Low confidence');
  });

  it('flags reading lower than lastKnownKm', async () => {
    singleMode();
    stubGemini({ odometer_km: 5000, confidence: 0.9, raw_text: '5000', notes: '' });
    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const result = await extractOdometerReading(pngBuf(), { lastKnownKm: 10000 });
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain('lower than last known');
  });

  it('flags implausible jump greater than MAX_PLAUSIBLE_JUMP_KM', async () => {
    singleMode();
    stubGemini({ odometer_km: 50000, confidence: 0.9, raw_text: '50000', notes: '' });
    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const result = await extractOdometerReading(pngBuf(), { lastKnownKm: 1000 });
    expect(result.needsReview).toBe(true);
  });

  it('does NOT flag a normal high-confidence plausible reading', async () => {
    singleMode();
    stubGemini({ odometer_km: 20144, confidence: 0.95, raw_text: '20144', notes: 'clear display' });
    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const result = await extractOdometerReading(pngBuf(), { lastKnownKm: 19500 });
    expect(result.needsReview).toBe(false);
    expect(result.reviewReason).toBe('');
    expect(result.final_km).toBe(20144);
  });

  it('routes every outbound call through the stub, reaching no real API', async () => {
    singleMode();
    stubGemini({ odometer_km: 1234, confidence: 0.9, raw_text: '1234', notes: '' });
    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    await extractOdometerReading(pngBuf());

    // Guards the original defect: the old mocks targeted modules the service does
    // not import, so real requests escaped and the suite failed on live 400/401s.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(String(call[0])).toMatch(/aiplatform\.googleapis\.com|api\.mistral\.ai/);
    }
    // Note: Mistral is called alongside Gemini even in single/Gemini mode — the
    // service races both providers rather than honouring the configured one.
    expect(calls.some((c) => String(c[0]).includes('api.mistral.ai'))).toBe(true);
  });
});
