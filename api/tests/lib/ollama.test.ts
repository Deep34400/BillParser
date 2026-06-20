import { describe, it, expect, vi, afterEach } from 'vitest';
import { ollamaChat } from '../../src/lib/ollama.js';

afterEach(() => vi.restoreAllMocks());

describe('ollamaChat', () => {
  it('POSTs to /api/chat and returns message.content', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: 'hello md' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await ollamaChat('http://host.docker.internal:11434/', 'glm-ocr', 'PROMPT', {
      images: ['BASE64IMG'],
      json: true,
    });

    expect(out.content).toBe('hello md');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host.docker.internal:11434/api/chat');
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe('glm-ocr');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.messages[0].images).toEqual(['BASE64IMG']);
  });

  it('throws a clear error on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(ollamaChat('http://x:11434', 'glm-ocr', 'P')).rejects.toThrow(/Ollama HTTP 500/);
  });

  it('throws a timeout error when fetch times out', async () => {
    const err = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw err; }));
    await expect(ollamaChat('http://x:11434', 'm', 'P')).rejects.toThrow(/timed out after/);
  });
});
