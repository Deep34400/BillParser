/**
 * Deduplication store — prevents reprocessing the same email/attachment.
 * Uses a JSON file (processed.json) keyed by Message-ID and file SHA-256 hash.
 *
 * Auto-prunes oldest entries so the file stays bounded (MAX_ENTRIES).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const STORE_PATH = resolve(process.cwd(), 'processed.json');

/** Soft cap — oldest entries dropped when exceeded. */
const MAX_ENTRIES = 800;

interface DedupEntry {
  type: 'message' | 'file';
  at: string;
  sender?: string;
  subject?: string;
  filename?: string;
}

let store: Record<string, DedupEntry> = {};

export function loadStore(): void {
  if (existsSync(STORE_PATH)) {
    try {
      store = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    } catch {
      store = {};
    }
  }
  const before = Object.keys(store).length;
  pruneIfNeeded();
  // Always rewrite compact on load (shrinks pretty-printed / oversized files)
  writeFileSync(STORE_PATH, JSON.stringify(store));
  const after = Object.keys(store).length;
  if (before !== after) {
    console.log(`[email-intake] processed.json compacted: ${before} → ${after} entries (max ${MAX_ENTRIES})`);
  }
}

function pruneIfNeeded(): void {
  const keys = Object.keys(store);
  if (keys.length <= MAX_ENTRIES) return;

  const sorted = keys
    .map((k) => ({ k, at: store[k]?.at ?? '' }))
    .sort((a, b) => a.at.localeCompare(b.at)); // oldest first

  const drop = sorted.slice(0, keys.length - MAX_ENTRIES);
  for (const { k } of drop) delete store[k];
  console.log(`[email-intake] Pruned processed.json: removed ${drop.length} old entries (kept ${MAX_ENTRIES})`);
}

function persist(): void {
  pruneIfNeeded();
  // Compact JSON (no pretty-print) to keep disk size small
  writeFileSync(STORE_PATH, JSON.stringify(store));
}

export function isMessageSeen(messageId: string): boolean {
  return !!store[`msg:${messageId}`];
}

export function markMessageSeen(messageId: string, sender: string, subject: string): void {
  store[`msg:${messageId}`] = { type: 'message', at: new Date().toISOString(), sender, subject };
  persist();
}

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function isFileSeen(hash: string): boolean {
  return !!store[`file:${hash}`];
}

export function markFileSeen(hash: string, filename: string): void {
  store[`file:${hash}`] = { type: 'file', at: new Date().toISOString(), filename };
  persist();
}

export function getStoreStats(): { entries: number; max: number } {
  return { entries: Object.keys(store).length, max: MAX_ENTRIES };
}
