// Read a (truncated) response body to append to an HTTP error message, so a failed
// provider call surfaces its actual reason — e.g. "Invalid model: qwen2.5:3b" — instead
// of a bare status code. Best-effort: never throws while building an error message.
export async function httpErrorBody(res: Response): Promise<string> {
  const body = (await res.text().catch(() => '')).trim().slice(0, 300);
  return body ? ` — ${body}` : '';
}
