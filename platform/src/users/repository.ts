/**
 * User Repository — Sequelize CRUD for users, API keys, and token transactions.
 */
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { Op, literal } from 'sequelize';
import { sequelize } from '../config/db.js';
import { User, ApiKey, TokenTransaction } from './models/index.js';

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
  api_key_hash: string;
  api_key_prefix: string;
  token_balance: number;
  total_tokens_used: number;
  total_ocr_count: number;
  total_cost_usd: number;
  intake_email?: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyDoc {
  key_id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
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

// ─── Row <-> Doc mapping ─────────────────────────────────────────────────────

function userRowToDoc(row: User): UserDoc {
  return {
    user_id: row.userId,
    email: row.email,
    name: row.name,
    password_hash: row.passwordHash,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    api_key_hash: row.apiKeyHash,
    api_key_prefix: row.apiKeyPrefix,
    token_balance: row.tokenBalance,
    total_tokens_used: row.totalTokensUsed,
    total_ocr_count: row.totalOcrCount,
    total_cost_usd: row.totalCostUsd,
    intake_email: row.intakeEmail ?? undefined,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function keyRowToDoc(row: ApiKey): ApiKeyDoc {
  return {
    key_id: row.keyId,
    user_id: row.userId,
    key_hash: row.keyHash,
    key_prefix: row.keyPrefix,
    label: row.label,
    created_at: row.createdAt.toISOString(),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
  };
}

function txRowToDoc(row: TokenTransaction): TokenTransactionDoc {
  return {
    tx_id: row.txId,
    user_id: row.userId,
    type: row.type as 'credit' | 'debit',
    amount: row.amount,
    balance_after: row.balanceAfter,
    description: row.description,
    reference_id: row.referenceId,
    created_at: row.createdAt.toISOString(),
  };
}

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
  await User.create({
    userId: user.user_id,
    email: user.email,
    name: user.name,
    passwordHash: user.password_hash,
    role: user.role,
    status: user.status,
    apiKeyHash: user.api_key_hash,
    apiKeyPrefix: user.api_key_prefix,
    tokenBalance: user.token_balance,
    totalTokensUsed: user.total_tokens_used,
    totalOcrCount: user.total_ocr_count,
    totalCostUsd: user.total_cost_usd,
    intakeEmail: user.intake_email ?? null,
    createdAt: new Date(user.created_at),
    updatedAt: new Date(user.updated_at),
  } as any);
  return user;
}

export async function getUser(userId: string): Promise<UserDoc | null> {
  const row = await User.findByPk(userId);
  return row ? userRowToDoc(row) : null;
}

export async function getUserByEmail(email: string): Promise<UserDoc | null> {
  const row = await User.findOne({
    where: literal(`lower(email) = lower('${email.replace(/'/g, "''")}')`),
  });
  return row ? userRowToDoc(row) : null;
}

export async function getUserByApiKeyHash(hash: string): Promise<UserDoc | null> {
  const keyDoc = await getApiKeyByHash(hash);
  if (keyDoc) return getUser(keyDoc.user_id);
  const row = await User.findOne({ where: { apiKeyHash: hash } });
  return row ? userRowToDoc(row) : null;
}

export async function listUsers(): Promise<UserDoc[]> {
  const rows = await User.findAll({ order: [['createdAt', 'ASC']] });
  return rows.map(userRowToDoc);
}

export async function updateUser(userId: string, updates: Partial<UserDoc>): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.email !== undefined) patch.email = updates.email;
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.password_hash !== undefined) patch.passwordHash = updates.password_hash;
  if (updates.role !== undefined) patch.role = updates.role;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.api_key_hash !== undefined) patch.apiKeyHash = updates.api_key_hash;
  if (updates.api_key_prefix !== undefined) patch.apiKeyPrefix = updates.api_key_prefix;
  if (updates.token_balance !== undefined) patch.tokenBalance = updates.token_balance;
  if (updates.total_tokens_used !== undefined) patch.totalTokensUsed = updates.total_tokens_used;
  if (updates.total_ocr_count !== undefined) patch.totalOcrCount = updates.total_ocr_count;
  if (updates.total_cost_usd !== undefined) patch.totalCostUsd = updates.total_cost_usd;
  if (updates.intake_email !== undefined) patch.intakeEmail = updates.intake_email || null;

  await User.update(patch, { where: { userId } });
}

// ─── API Key CRUD ───────────────────────────────────────────────────────────

export async function createApiKeyDoc(doc: ApiKeyDoc): Promise<ApiKeyDoc> {
  await ApiKey.create({
    keyId: doc.key_id,
    userId: doc.user_id,
    keyHash: doc.key_hash,
    keyPrefix: doc.key_prefix,
    label: doc.label,
    createdAt: new Date(doc.created_at),
    lastUsedAt: doc.last_used_at ? new Date(doc.last_used_at) : null,
  } as any);
  return doc;
}

export async function getApiKeyByHash(hash: string): Promise<ApiKeyDoc | null> {
  const row = await ApiKey.findOne({ where: { keyHash: hash } });
  return row ? keyRowToDoc(row) : null;
}

export async function listApiKeysForUser(userId: string): Promise<ApiKeyDoc[]> {
  const rows = await ApiKey.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
  return rows.map(keyRowToDoc);
}

export async function deleteApiKey(keyId: string): Promise<void> {
  await ApiKey.destroy({ where: { keyId } });
}

// ─── Token transaction CRUD ─────────────────────────────────────────────────

export async function createTransaction(tx: TokenTransactionDoc): Promise<void> {
  await TokenTransaction.create({
    txId: tx.tx_id,
    userId: tx.user_id,
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balance_after,
    description: tx.description,
    referenceId: tx.reference_id ?? null,
    createdAt: new Date(tx.created_at),
  } as any);
}

export async function getUserTransactions(userId: string, limit = 50): Promise<TokenTransactionDoc[]> {
  const rows = await TokenTransaction.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit,
  });
  return rows.map(txRowToDoc);
}

// ─── Atomic token balance operations ────────────────────────────────────────

export async function applyTokenTransaction(params: {
  userId: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  referenceId?: string | null;
}): Promise<
  | { ok: true; user: UserDoc; tx: TokenTransactionDoc }
  | { ok: false; reason: 'not_found' | 'insufficient_balance' }
> {
  const seq = sequelize();
  return seq.transaction(async (t) => {
    const isDebit = params.type === 'debit';

    const balanceExpr = isDebit
      ? literal(`round(("token_balance" - ${params.amount})::numeric, 4)`)
      : literal(`round(("token_balance" + ${params.amount})::numeric, 4)`);

    const updateValues: Record<string, unknown> = {
      tokenBalance: balanceExpr,
      updatedAt: new Date(),
    };
    if (isDebit) {
      updateValues.totalTokensUsed = literal(`round(("total_tokens_used" + ${params.amount})::numeric, 4)`);
      updateValues.totalOcrCount = literal(`"total_ocr_count" + 1`);
    }

    const whereClause: any = { userId: params.userId };
    if (isDebit) {
      whereClause.tokenBalance = { [Op.gte]: params.amount };
    }

    const [affectedCount] = await User.update(updateValues, {
      where: whereClause,
      transaction: t,
    });

    if (affectedCount === 0) {
      const exists = await User.findByPk(params.userId, { transaction: t, attributes: ['userId'] });
      return { ok: false, reason: exists ? 'insufficient_balance' : 'not_found' } as const;
    }

    const updated = await User.findByPk(params.userId, { transaction: t });
    if (!updated) return { ok: false, reason: 'not_found' } as const;

    const txId = uuid();
    const createdAt = new Date();
    await TokenTransaction.create({
      txId,
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      balanceAfter: updated.tokenBalance,
      description: params.description,
      referenceId: params.referenceId ?? null,
      createdAt,
    } as any, { transaction: t });

    return {
      ok: true,
      user: userRowToDoc(updated),
      tx: {
        tx_id: txId,
        user_id: params.userId,
        type: params.type,
        amount: params.amount,
        balance_after: updated.tokenBalance,
        description: params.description,
        reference_id: params.referenceId ?? null,
        created_at: createdAt.toISOString(),
      },
    } as const;
  });
}

export async function incrementTotalCost(userId: string, costUsd: number): Promise<void> {
  await User.update({
    totalCostUsd: literal(`round(("total_cost_usd" + ${costUsd})::numeric, 6)`),
    updatedAt: new Date(),
  }, { where: { userId } });
}
