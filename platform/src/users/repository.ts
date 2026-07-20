/**
 * User Repository — Firestore CRUD for users, API keys, and token transactions.
 * Pure data-access layer: no business logic, no HTTP concerns.
 *
 * Collections: users, token_transactions, api_keys
 */
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../shared/devStore.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'blocked';

export interface UserDoc {
  user_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  /** @deprecated — kept for backward compat; use api_keys collection instead */
  api_key_hash: string;
  api_key_prefix: string;
  token_balance: number;
  total_tokens_used: number;
  total_ocr_count: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyDoc {
  key_id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  api_key: string;
  label: string;
  created_at: string;
  last_used_at?: string | null;
}

export interface TokenTransactionDoc {
  tx_id: string;
  user_id: string;
  type: 'credit' | 'debit';
  amount: number;
  balance_after: number;
  description: string;
  reference_id?: string | null;
  created_at: string;
}

// ─── Collection refs ────────────────────────────────────────────────────────

const USERS_COL = 'users';
const TX_COL = 'token_transactions';
const KEYS_COL = 'api_keys';

function usersRef() { return db().collection(col(USERS_COL)); }
function txRef() { return db().collection(col(TX_COL)); }
function keysRef() { return db().collection(col(KEYS_COL)); }

// ─── Password hashing (scrypt) ─────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const buf = scryptSync(password, salt, 64);
  return timingSafeEqual(buf, Buffer.from(hash, 'hex'));
}

// ─── API key helpers ────────────────────────────────────────────────────────

export function generateApiKey(): string {
  return `inv_${randomBytes(32).toString('hex')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, 8);
}

// ─── User CRUD ──────────────────────────────────────────────────────────────

export async function createUser(user: UserDoc): Promise<UserDoc> {
  if (env.localDev) {
    devStore.users.set(user.user_id, user);
    return user;
  }
  await usersRef().doc(user.user_id).set(user);
  return user;
}

export async function getUser(userId: string): Promise<UserDoc | null> {
  if (env.localDev) return devStore.users.get(userId) ?? null;
  const snap = await usersRef().doc(userId).get();
  return snap.exists ? (snap.data() as UserDoc) : null;
}

export async function getUserByEmail(email: string): Promise<UserDoc | null> {
  if (env.localDev) {
    for (const u of devStore.users.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    return null;
  }
  const snap = await usersRef().where('email', '==', email.toLowerCase()).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as UserDoc);
}

export async function getUserByApiKeyHash(hash: string): Promise<UserDoc | null> {
  const keyDoc = await getApiKeyByHash(hash);
  if (keyDoc) return getUser(keyDoc.user_id);
  if (env.localDev) {
    for (const u of devStore.users.values()) {
      if (u.api_key_hash === hash) return u;
    }
    return null;
  }
  const snap = await usersRef().where('api_key_hash', '==', hash).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as UserDoc);
}

export async function listUsers(): Promise<UserDoc[]> {
  if (env.localDev) {
    return Array.from(devStore.users.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const snap = await usersRef().orderBy('created_at', 'asc').get();
  return snap.docs.map((d) => d.data() as UserDoc);
}

export async function updateUser(userId: string, updates: Partial<UserDoc>): Promise<void> {
  if (env.localDev) {
    const existing = devStore.users.get(userId);
    if (existing) devStore.users.set(userId, { ...existing, ...updates, updated_at: new Date().toISOString() });
    return;
  }
  await usersRef().doc(userId).update({ ...updates, updated_at: new Date().toISOString() });
}

// ─── API Key CRUD ───────────────────────────────────────────────────────────

export async function createApiKeyDoc(doc: ApiKeyDoc): Promise<ApiKeyDoc> {
  if (env.localDev) {
    devStore.apiKeys.push(doc);
    return doc;
  }
  await keysRef().doc(doc.key_id).set(doc);
  return doc;
}

export async function getApiKeyByHash(hash: string): Promise<ApiKeyDoc | null> {
  if (env.localDev) {
    return devStore.apiKeys.find((k) => k.key_hash === hash) ?? null;
  }
  const snap = await keysRef().where('key_hash', '==', hash).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as ApiKeyDoc);
}

export async function listApiKeysForUser(userId: string): Promise<ApiKeyDoc[]> {
  if (env.localDev) {
    return devStore.apiKeys.filter((k) => k.user_id === userId);
  }
  const snap = await keysRef().where('user_id', '==', userId).orderBy('created_at', 'desc').get();
  return snap.docs.map((d) => d.data() as ApiKeyDoc);
}

export async function deleteApiKey(keyId: string): Promise<void> {
  if (env.localDev) {
    const idx = devStore.apiKeys.findIndex((k) => k.key_id === keyId);
    if (idx >= 0) devStore.apiKeys.splice(idx, 1);
    return;
  }
  await keysRef().doc(keyId).delete();
}

// ─── Token transaction CRUD ─────────────────────────────────────────────────

export async function createTransaction(tx: TokenTransactionDoc): Promise<void> {
  if (env.localDev) {
    devStore.tokenTransactions.push(tx);
  } else {
    await txRef().doc(tx.tx_id).set(tx);
  }
}

export async function getUserTransactions(userId: string, limit = 50): Promise<TokenTransactionDoc[]> {
  if (env.localDev) {
    return devStore.tokenTransactions
      .filter((t) => t.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const snap = await txRef()
    .where('user_id', '==', userId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as TokenTransactionDoc);
}
