import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSource } from '../../src/lib/fetchSource.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'imp-')); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.IMPORT_DIR; rmSync(dir, { recursive: true, force: true }); });

function mockFetch(opts: { ok?: boolean; status?: number; bytes?: Buffer; contentLength?: string }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? (opts.contentLength ?? null) : null) },
    arrayBuffer: async () => { const b = opts.bytes ?? Buffer.from('%PDF-1.4'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  })));
}

it('fetches an https URL and derives the filename from the path', async () => {
  mockFetch({ bytes: Buffer.from('%PDF-1.4 hi') });
  const r = await resolveSource('https://example.com/files/inv-9.pdf?token=abc');
  expect(r.fileName).toBe('inv-9.pdf');
  expect(r.buf.toString()).toBe('%PDF-1.4 hi');
});

it('throws on a non-2xx http response', async () => {
  mockFetch({ ok: false, status: 404 });
  await expect(resolveSource('https://example.com/x.pdf')).rejects.toThrow('HTTP 404');
});

it('reads a local file inside IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  writeFileSync(join(dir, 'a.pdf'), '%PDF-1.4 local');
  const r = await resolveSource('a.pdf');
  expect(r.fileName).toBe('a.pdf');
  expect(r.buf.toString()).toBe('%PDF-1.4 local');
});

it('rejects a path that escapes IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  await expect(resolveSource('../secret.pdf')).rejects.toThrow('path outside IMPORT_DIR');
});

it('rejects local paths when IMPORT_DIR is unset', async () => {
  await expect(resolveSource('a.pdf')).rejects.toThrow('local file import not enabled');
});

it('aborts a stream that exceeds the size cap', async () => {
  const big = { length: 60 * 1024 * 1024 } as unknown as Uint8Array;
  async function* gen() { yield big; }
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    body: gen(),
  })));
  await expect(resolveSource('https://example.com/big.pdf')).rejects.toThrow('file too large');
});
