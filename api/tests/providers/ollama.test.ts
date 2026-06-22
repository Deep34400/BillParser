import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/lib/rasterize.js', () => ({
  rasterizePdf: vi.fn(async () => ['PAGE1B64']),
  rasterizeTopBand: vi.fn(async () => 'HEADERB64'),
}));
vi.mock('../../src/structuring/index.js', () => ({
  getStructuringModel: vi.fn(async () => ({
    model: { provider: 'ollama', model: 'glm-ocr', structure: vi.fn(async (md: string) => ({
      vendorName: 'Acme', lineItems: [], confidence: 0.5,
    })) },
    creds: { baseUrl: 'http://x:11434', model: 'glm-ocr' },
  })),
}));

import { ollamaProvider } from '../../src/providers/ollama.js';
import { rasterizePdf, rasterizeTopBand } from '../../src/lib/rasterize.js';

afterEach(() => vi.clearAllMocks());

describe('ollamaProvider', () => {
  it('is markdown-kind and configured only with baseUrl + model', () => {
    expect(ollamaProvider.kind).toBe('markdown');
    expect(ollamaProvider.isConfigured({ baseUrl: 'http://x', model: 'glm-ocr' })).toBe(true);
    expect(ollamaProvider.isConfigured({ baseUrl: 'http://x' })).toBe(false);
    expect(ollamaProvider.isConfigured(null)).toBe(false);
    expect(ollamaProvider.isConfigured({ model: 'glm-ocr' })).toBe(false);
  });

  it('OCRs the header band first, then the pages, then structures the markdown', async () => {
    const responses = ['HEADER MD', 'PAGE MD'];
    let n = 0;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: responses[n++] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://host.docker.internal:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    expect(rasterizeTopBand).toHaveBeenCalledOnce();
    expect(rasterizePdf).toHaveBeenCalledOnce();
    // First request is the cropped header band; second is the full page.
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body).messages[0].images).toEqual(['HEADERB64']);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as any).body).messages[0].images).toEqual(['PAGE1B64']);
    // Header markdown is prepended so structuring sees vendor/invoice-number metadata.
    expect(r.rawText).toBe('HEADER MD\n\nPAGE MD');
    expect(r.vendorName).toBe('Acme'); // from the structuring step
    expect(r.rawJson).toEqual({
      header: { message: { content: 'HEADER MD' } },
      pages: [{ message: { content: 'PAGE MD' } }],
    });
  });

  it('runs OCR greedily (temperature 0) so transcription is reproducible', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: 'MD' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://x:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    // Every OCR request (header band + each page) pins temperature 0.
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse((call[1] as any).body).options.temperature).toBe(0);
    }
  });

  it('strips runaway ```json soup from page OCR before structuring', async () => {
    // header band is clean; the page runs away into a fenced JSON blob around real text.
    const responses = ['VENDOR HEADER', 'keep-before\n```json\n{"junk":1}\n```\nkeep-after'];
    let n = 0;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: responses[n++] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://x:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    expect(r.rawText).not.toContain('```'); // soup removed
    expect(r.rawText).not.toContain('junk');
    expect(r.rawText).toContain('keep-before');
    expect(r.rawText).toContain('keep-after');
    expect(r.rawText).toContain('VENDOR HEADER'); // header preserved for vendor extraction
    // rawJson still preserves the untouched raw response for debugging
    expect((r.rawJson as any).pages[0].message.content).toContain('```json');
  });

  it('OCRs each page in its own request after the header band', async () => {
    (rasterizePdf as any).mockResolvedValueOnce(['P1', 'P2']);
    let n = 0;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: `MD${n++}` } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://x:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    // 1 header band + 2 pages = 3 requests
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body).messages[0].images).toEqual(['HEADERB64']);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as any).body).messages[0].images).toEqual(['P1']);
    expect(JSON.parse((fetchMock.mock.calls[2][1] as any).body).messages[0].images).toEqual(['P2']);
    expect(r.rawText).toBe('MD0\n\nMD1\n\nMD2');
  });
});
