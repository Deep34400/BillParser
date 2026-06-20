import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/lib/rasterize.js', () => ({
  rasterizePdf: vi.fn(async () => ['PAGE1B64']),
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
import { rasterizePdf } from '../../src/lib/rasterize.js';

afterEach(() => vi.clearAllMocks());

describe('ollamaProvider', () => {
  it('is markdown-kind and configured only with baseUrl + model', () => {
    expect(ollamaProvider.kind).toBe('markdown');
    expect(ollamaProvider.isConfigured({ baseUrl: 'http://x', model: 'glm-ocr' })).toBe(true);
    expect(ollamaProvider.isConfigured({ baseUrl: 'http://x' })).toBe(false);
    expect(ollamaProvider.isConfigured(null)).toBe(false);
    expect(ollamaProvider.isConfigured({ model: 'glm-ocr' })).toBe(false);
  });

  it('rasterizes, OCRs the images, then structures the markdown', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: '# OCR MD' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://host.docker.internal:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    expect(rasterizePdf).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.messages[0].images).toEqual(['PAGE1B64']);
    expect(r.rawText).toBe('# OCR MD');
    expect(r.vendorName).toBe('Acme'); // from the structuring step
    expect(r.rawJson).toEqual({ pages: [{ message: { content: '# OCR MD' } }] });
  });

  it('OCRs each page in its own request and joins the markdown', async () => {
    (rasterizePdf as any).mockResolvedValueOnce(['P1', 'P2']);
    let n = 0;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: `MD${++n}` } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://x:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body).messages[0].images).toEqual(['P1']);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as any).body).messages[0].images).toEqual(['P2']);
    expect(r.rawText).toBe('MD1\n\nMD2');
  });
});
