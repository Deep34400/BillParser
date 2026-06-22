import { describe, it, expect, vi, afterEach } from 'vitest';
import { ollamaStructModel } from '../../src/structuring/ollama.js';

afterEach(() => vi.restoreAllMocks());

describe('ollamaStructModel', () => {
  it('sends markdown in JSON mode and normalizes the result', async () => {
    const json = JSON.stringify({
      vendorName: 'Globex', invoiceNumber: 'INV-9', totalAmount: '100', currency: 'USD',
      lineItems: [{ description: 'Item A', quantity: 2, amount: 20 }],
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: json } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const model = ollamaStructModel('glm-ocr');
    const r = await model.structure('# OCR markdown', { baseUrl: 'http://x:11434', model: 'glm-ocr' });

    expect(r.vendorName).toBe('Globex');
    expect(r.totalAmount).toBe(100); // normalized string -> number
    expect(r.lineItems[0]).toMatchObject({ lineNumber: 1, description: 'Item A', amount: 20 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.format).toBe('json');
  });

  it('uses the configured structuring model, not the OCR provider model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: '{"lineItems":[]}' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const model = ollamaStructModel('qwen2.5');
    await model.structure('# md', { baseUrl: 'http://x:11434', model: 'glm-ocr' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.model).toBe('qwen2.5'); // structuring model wins over creds.model (glm-ocr)
  });

  it('uses greedy decoding (temperature 0) so structuring is deterministic', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: '{"lineItems":[]}' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await ollamaStructModel('qwen2.5').structure('# md', { baseUrl: 'http://x:11434', model: 'qwen2.5' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.options.temperature).toBe(0);
  });

  it('grows num_ctx for large markdown so the input is not silently truncated', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: '{"lineItems":[]}' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const big = 'x'.repeat(40_000); // ~20k token prompt — must not clamp to the 8192 default
    const model = ollamaStructModel('qwen2.5');
    await model.structure(big, { baseUrl: 'http://x:11434', model: 'qwen2.5' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.options.num_ctx).toBeGreaterThan(8192);
    expect(body.options.num_ctx).toBeLessThanOrEqual(32_768);
  });
});
