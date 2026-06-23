import { readFile } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

// Resolve a source string to PDF bytes + a derived filename.
// Throws Error(reason) on failure; the caller turns that into a `rejected` entry.
export async function resolveSource(source: string): Promise<{ buf: Buffer; fileName: string }> {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return fetchUrl(s);
  const path = /^file:\/\//i.test(s) ? fileURLToPath(s) : s;
  return readLocal(path);
}

async function fetchUrl(url: string): Promise<{ buf: Buffer; fileName: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('file too large');
  let buf: Buffer;
  if (res.body) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_BYTES) throw new Error('file too large');
      chunks.push(Buffer.from(chunk));
    }
    buf = Buffer.concat(chunks);
  } else {
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('file too large');
  }
  const name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'download.pdf';
  return { buf, fileName: name };
}

async function readLocal(p: string): Promise<{ buf: Buffer; fileName: string }> {
  const importDir = (process.env.IMPORT_DIR ?? '').trim();
  if (!importDir) throw new Error('local file import not enabled (set IMPORT_DIR)');
  const base = resolve(importDir);
  const abs = resolve(base, p);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error('path outside IMPORT_DIR');
  const buf = await readFile(abs).catch(() => { throw new Error('file not found'); });
  return { buf, fileName: basename(abs) };
}
