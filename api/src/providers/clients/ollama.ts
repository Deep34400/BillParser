// Local vision models are slow: a single rasterized page through glm-ocr measures
// ~190s on modest GPUs, so 180s clipped legitimate, in-progress OCR. 300s leaves
// headroom for the slowest page without hanging indefinitely.
const TIMEOUT_MS = 300_000;

// Ollama defaults num_ctx to 4096, which a single rasterized page image already exceeds
// (~4100 tokens). 8192 fits a page plus prompt with headroom without oversizing the KV cache.
const DEFAULT_NUM_CTX = 8192;

// Single entry point for Ollama's /api/chat. Returns the assistant message text.
// Pass images (base64 PNGs) for vision; pass json:true to force JSON output.
export async function ollamaChat(
  baseUrl: string,
  model: string,
  prompt: string,
  opts: { images?: string[]; json?: boolean; numCtx?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<{ content: string; raw: unknown }> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const message: { role: 'user'; content: string; images?: string[] } = { role: 'user', content: prompt };
  if (opts.images?.length) message.images = opts.images;
  const options: Record<string, unknown> = { num_ctx: opts.numCtx ?? DEFAULT_NUM_CTX };
  if (opts.temperature !== undefined) options.temperature = opts.temperature;
  const body: Record<string, unknown> = { model, messages: [message], stream: false, options };
  if (opts.json) body.format = 'json';

  // Combine our timeout with the caller's cancel signal so either one aborts the request.
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    if (opts.signal?.aborted) throw Object.assign(new Error('Ollama request cancelled'), { name: 'AbortError' });
    if (e?.name === 'TimeoutError') {
      throw new Error(`Ollama request to ${url} timed out after ${TIMEOUT_MS / 1000}s (model "${model}").`);
    }
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is it running? From Docker use host.docker.internal. (${String(e?.message ?? e)})`,
    );
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`Ollama HTTP ${res.status} at ${url} (model "${model}"). ${detail}`);
  }
  const j: any = await res.json();
  const content = j?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`Ollama returned an unexpected response shape: ${JSON.stringify(j).slice(0, 300)}`);
  }
  return { content, raw: j };
}
