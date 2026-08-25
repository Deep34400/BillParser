/**
 * User Service — business logic for authentication, token management, and user administration.
 * Sits between route handlers (route.ts) and the data layer (repository.ts).
 * Contains validation, domain rules, and orchestration — no HTTP or DB concerns.
 */
import { randomBytes } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import {
  getUser, getUserByEmail, createUser, updateUser, listUsers,
  generateApiKey, hashApiKey, apiKeyPrefix,
  createApiKeyDoc, listApiKeysForUser, deleteApiKey,
  hashPassword, verifyPassword, getUserTransactions,
  applyTokenTransaction, incrementTotalCost,
  type UserDoc, type UserRole, type ApiKeyDoc, type TokenTransactionDoc,
} from './repository.js';

// Re-export types so route.ts only imports from service.ts (single dependency)
export type { UserDoc, ApiKeyDoc, TokenTransactionDoc };

// ─── Authentication ─────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
): Promise<{ user: UserDoc } | { error: string; status: number }> {
  const user = await getUserByEmail(email);
  if (!user) return { error: 'Invalid email or password', status: 401 };
  if (!verifyPassword(password, user.password_hash)) return { error: 'Invalid email or password', status: 401 };
  if (user.status === 'blocked') return { error: 'Account is blocked — contact admin', status: 403 };
  return { user };
}

// ─── API Key Management ─────────────────────────────────────────────────────

/**
 * Mint an API key. Only the SHA-256 hash is persisted, so `apiKey` is the one
 * and only time the raw value exists outside the caller's hands — surface it
 * immediately or it is gone.
 */
export async function issueApiKey(
  userId: string,
  label = 'Default',
): Promise<{ doc: ApiKeyDoc; apiKey: string }> {
  const rawKey = generateApiKey();
  const doc: ApiKeyDoc = {
    key_id: randomBytes(16).toString('hex'),
    user_id: userId,
    key_hash: hashApiKey(rawKey),
    key_prefix: apiKeyPrefix(rawKey),
    label,
    created_at: new Date().toISOString(),
  };
  await createApiKeyDoc(doc);
  return { doc, apiKey: rawKey };
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const keys = await listApiKeysForUser(userId);
  const target = keys.find((k) => k.key_id === keyId);
  if (!target) return false;
  await deleteApiKey(keyId);
  return true;
}

export async function getApiKeys(userId: string): Promise<ApiKeyDoc[]> {
  return listApiKeysForUser(userId);
}

// ─── User Administration ────────────────────────────────────────────────────

export async function registerUser(opts: {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
  initialBalance?: number;
  intake_email?: string;
}): Promise<UserDoc | { error: string; status: number }> {
  if (opts.password.length < 6) return { error: 'Password must be at least 6 characters', status: 400 };

  const existing = await getUserByEmail(opts.email);
  if (existing) return { error: 'A user with this email already exists', status: 409 };

  const now = new Date().toISOString();
  const user: UserDoc = {
    user_id: uuid(),
    email: opts.email.toLowerCase().trim(),
    name: opts.name,
    password_hash: hashPassword(opts.password),
    role: opts.role ?? 'user',
    status: 'active',
    api_key_hash: '',
    api_key_prefix: '',
    token_balance: opts.initialBalance ?? 0,
    total_tokens_used: 0,
    total_ocr_count: 0,
    total_cost_usd: 0,
    intake_email: opts.intake_email?.toLowerCase().trim() || undefined,
    created_at: now,
    updated_at: now,
  };

  await createUser(user);
  return user;
}

export async function findUser(userId: string): Promise<UserDoc | null> {
  return getUser(userId);
}

export async function findAllUsers(): Promise<UserDoc[]> {
  return listUsers();
}

export async function blockUser(userId: string): Promise<void> {
  await updateUser(userId, { status: 'blocked' });
}

export async function unblockUser(userId: string): Promise<void> {
  await updateUser(userId, { status: 'active' });
}

export async function resetPassword(userId: string, newPassword: string): Promise<{ error?: string }> {
  if (!newPassword || newPassword.length < 6) return { error: 'Password must be at least 6 characters' };
  await updateUser(userId, { password_hash: hashPassword(newPassword) });
  return {};
}

// ─── Token Operations ───────────────────────────────────────────────────────

export async function addTokens(
  userId: string,
  amount: number,
  description: string,
): Promise<TokenTransactionDoc> {
  const result = await applyTokenTransaction({ userId, type: 'credit', amount, description });
  if (!result.ok) throw new Error(`User ${userId} not found`);
  return result.tx;
}

export async function deductTokens(
  userId: string,
  amount: number,
  description: string,
  referenceId?: string,
): Promise<TokenTransactionDoc> {
  const result = await applyTokenTransaction({
    userId, type: 'debit', amount, description, referenceId: referenceId ?? null,
  });
  if (!result.ok) {
    throw new Error(result.reason === 'not_found' ? `User ${userId} not found` : 'Insufficient balance');
  }
  return result.tx;
}

export async function getTransactions(userId: string, limit = 50): Promise<TokenTransactionDoc[]> {
  return getUserTransactions(userId, limit);
}

/**
 * Called by OCR module after a successful pipeline run to record the USD cost
 * against the user's lifetime spend. Separate from deductTokens (token billing).
 */
export async function trackOcrCost(userId: string, costUsd: number): Promise<void> {
  await incrementTotalCost(userId, costUsd);
}

/**
 * Set or clear the email address this user is allowed to send invoices FROM.
 * Empty string / null clears the whitelist entry for that user.
 */
export async function setUserIntakeEmail(
  userId: string,
  intakeEmail: string | null | undefined,
): Promise<UserDoc | { error: string; status: number }> {
  const user = await getUser(userId);
  if (!user) return { error: 'User not found', status: 404 };

  const cleaned = (intakeEmail ?? '').trim().toLowerCase();
  if (cleaned && !cleaned.includes('@')) {
    return { error: 'intake_email must be a valid email or empty', status: 400 };
  }

  await updateUser(userId, {
    intake_email: cleaned || '',
  });

  const updated = await getUser(userId);
  return updated!;
}
