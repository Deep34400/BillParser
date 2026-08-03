/**
 * Deduplication store — prevents reprocessing the same email/attachment.
 * Uses a JSON file (processed.json) keyed by Message-ID and file SHA-256 hash.
 * For production scale, swap with Redis/Firestore.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const STORE_PATH = resolve(process.cwd(), 'processed.json');

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
}

function persist(): void {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
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
