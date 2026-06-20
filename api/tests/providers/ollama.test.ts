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
  });
});
