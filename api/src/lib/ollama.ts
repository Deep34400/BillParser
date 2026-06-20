const TIMEOUT_MS = 180_000; // local vision models are slow

// Single entry point for Ollama's /api/chat. Returns the assistant message text.
// Pass images (base64 PNGs) for vision; pass json:true to force JSON output.
export async function ollamaChat(
  baseUrl: string,
  model: string,
  prompt: string,
  opts: { images?: string[]; json?: boolean } = {},
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const message: { role: 'user'; content: string; images?: string[] } = { role: 'user', content: prompt };
  if (opts.images?.length) message.images = opts.images;
  const body: Record<string, unknown> = { model, messages: [message], stream: false };
  if (opts.json) body.format = 'json';

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
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
  return content;
}
