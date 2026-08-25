import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('extractOdometerReading plausibility gating', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flags low confidence result with needsReview', async () => {
    vi.doMock('../../src/ocr/providers/resolveKey.js', () => ({
      resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'gemini-2.5-flash', useAdc: true }),
    }));
    vi.doMock('../../src/ocr/providers/geminiClient.js', () => ({
      geminiGenerateContent: vi.fn().mockResolvedValue({
        text: '{"odometer_km": 5000, "confidence": 0.3, "raw_text": "5000", "notes": "very blurry"}',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 1000,
        model: 'gemini-2.5-flash',
        authMode: 'adc',
      }),
    }));
    vi.doMock('../../src/shared/settings.js', () => ({
      getSettings: vi.fn().mockResolvedValue({ pipelineMode: 'single', singleProvider: 'gemini', singleModel: 'gemini-2.5-flash' }),
    }));
    vi.doMock('../../src/ocr/providers/mistralOcr.js', () => ({
      mistralOcr: vi.fn(),
    }));

    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
    const result = await extractOdometerReading(buf);

    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain('Low confidence');
  });

  it('flags reading lower than lastKnownKm', async () => {
    vi.doMock('../../src/ocr/providers/resolveKey.js', () => ({
      resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'gemini-2.5-flash', useAdc: true }),
    }));
    vi.doMock('../../src/ocr/providers/geminiClient.js', () => ({
      geminiGenerateContent: vi.fn().mockResolvedValue({
        text: '{"odometer_km": 5000, "confidence": 0.9, "raw_text": "5000", "notes": ""}',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 1000,
        model: 'gemini-2.5-flash',
        authMode: 'adc',
      }),
    }));
    vi.doMock('../../src/shared/settings.js', () => ({
      getSettings: vi.fn().mockResolvedValue({ pipelineMode: 'single', singleProvider: 'gemini', singleModel: 'gemini-2.5-flash' }),
    }));
    vi.doMock('../../src/ocr/providers/mistralOcr.js', () => ({
      mistralOcr: vi.fn(),
    }));

    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
    const result = await extractOdometerReading(buf, { lastKnownKm: 10000 });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain('lower than last known');
  });

  it('flags implausible jump greater than MAX_PLAUSIBLE_JUMP_KM', async () => {
    vi.doMock('../../src/ocr/providers/resolveKey.js', () => ({
      resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'gemini-2.5-flash', useAdc: true }),
    }));
    vi.doMock('../../src/ocr/providers/geminiClient.js', () => ({
      geminiGenerateContent: vi.fn().mockResolvedValue({
        text: '{"odometer_km": 50000, "confidence": 0.9, "raw_text": "50000", "notes": ""}',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 1000,
        model: 'gemini-2.5-flash',
        authMode: 'adc',
      }),
    }));
    vi.doMock('../../src/shared/settings.js', () => ({
      getSettings: vi.fn().mockResolvedValue({ pipelineMode: 'single', singleProvider: 'gemini', singleModel: 'gemini-2.5-flash' }),
    }));
    vi.doMock('../../src/ocr/providers/mistralOcr.js', () => ({
      mistralOcr: vi.fn(),
    }));

    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
    const result = await extractOdometerReading(buf, { lastKnownKm: 45000 });

    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain('Implausible jump');
    expect(result.reviewReason).toContain('5000km');
  });

  it('does NOT flag a normal high-confidence plausible reading', async () => {
    vi.doMock('../../src/ocr/providers/resolveKey.js', () => ({
      resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'gemini-2.5-flash', useAdc: true }),
    }));
    vi.doMock('../../src/ocr/providers/geminiClient.js', () => ({
      geminiGenerateContent: vi.fn().mockResolvedValue({
        text: '{"odometer_km": 20144, "confidence": 0.95, "raw_text": "20144", "notes": "clear display"}',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 1000,
        model: 'gemini-2.5-flash',
        authMode: 'adc',
      }),
    }));
    vi.doMock('../../src/shared/settings.js', () => ({
      getSettings: vi.fn().mockResolvedValue({ pipelineMode: 'single', singleProvider: 'gemini', singleModel: 'gemini-2.5-flash' }),
    }));
    vi.doMock('../../src/ocr/providers/mistralOcr.js', () => ({
      mistralOcr: vi.fn(),
    }));

    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
    const result = await extractOdometerReading(buf, { lastKnownKm: 19500 });

    expect(result.needsReview).toBe(false);
    expect(result.reviewReason).toBe('');
    expect(result.final_km).toBe(20144);
    expect(result.pipelineMode).toBe('single');
  });

  it('uses split mode when settings say split', async () => {
    vi.doMock('../../src/ocr/providers/resolveKey.js', () => ({
      resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'gemini-2.5-flash', useAdc: true }),
    }));
    vi.doMock('../../src/ocr/providers/geminiClient.js', () => ({
      geminiGenerateContent: vi.fn().mockResolvedValue({
        text: '{"odometer_km": 7175, "confidence": 0.88, "raw_text": "7175", "notes": ""}',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 500,
        model: 'gemini-2.5-flash',
        authMode: 'adc',
      }),
    }));
    vi.doMock('../../src/ocr/providers/mistralOcr.js', () => ({
      mistralOcr: vi.fn().mockResolvedValue({ markdown: 'ODO: 7175 km\nTRIP A: 123 km', cost: { provider: 'mistral', model: 'mistral-ocr-latest', usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 }, cost_usd: 0.002, latency_ms: 800 } }),
    }));
    vi.doMock('../../src/shared/settings.js', () => ({
      getSettings: vi.fn().mockResolvedValue({ pipelineMode: 'split', structuringProvider: 'gemini', structuringModel: 'gemini-2.5-flash' }),
    }));

    const { extractOdometerReading } = await import('../../src/odometerOcr/service.js');
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
    const result = await extractOdometerReading(buf);

    expect(result.pipelineMode).toBe('split');
    expect(result.providers.extraction).toBe('mistral');
    expect(result.providers.structuring).toBe('gemini');
    expect(result.final_km).toBe(7175);
    expect(result.needsReview).toBe(false);
  });
});
