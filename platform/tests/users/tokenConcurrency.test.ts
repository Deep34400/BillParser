/**
 * Concurrency contract for token billing.
 *
 * The Firestore implementation did read-modify-write in JavaScript:
 *   read balance → check in JS → write new balance
 * Two concurrent uploads both passed the check and both wrote, letting a user
 * overdraw. These tests pin the atomic behaviour that replaced it — a single
 * conditional UPDATE (`WHERE token_balance >= amount`) inside a transaction.
 *
 * The parallel test below FAILS against the old Firestore code by design.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/config/db.js';
import { users, tokenTransactions } from '../../src/db/schema.js';
import { createUser, getUser, applyTokenTransaction, getUserTransactions } from '../../src/users/repository.js';
import type { UserDoc } from '../../src/users/repository.js';

function makeUser(id: string, balance: number): UserDoc {
  return {
    user_id: id,
    email: `${id}@example.com`,
    name: id,
    password_hash: 'x:y',
    role: 'user',
    status: 'active',
    api_key_hash: '',
    api_key_prefix: '',
    token_balance: balance,
    total_tokens_used: 0,
    total_ocr_count: 0,
    total_cost_usd: 0,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

describe('applyTokenTransaction — atomicity', () => {
  beforeEach(async () => {
    await db().delete(tokenTransactions);
    await db().delete(users);
  });

  it('allows exactly N concurrent debits when the balance covers only N', async () => {
    // Balance 5.0, each debit 1.0 → exactly 5 of 10 attempts may succeed.
    await createUser(makeUser('u1', 5));

    const attempts = Array.from({ length: 10 }, () =>
      applyTokenTransaction({ userId: 'u1', type: 'debit', amount: 1, description: 'ocr' }),
    );
    const results = await Promise.all(attempts);

    const ok = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);

    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(5);
    expect(rejected.every((r) => !r.ok && r.reason === 'insufficient_balance')).toBe(true);

    const after = await getUser('u1');
    expect(after?.token_balance).toBe(0);
    expect(after?.total_ocr_count).toBe(5);
  });

  it('never lets the balance go negative under concurrent load', async () => {
    await createUser(makeUser('u2', 3));

    await Promise.all(
      Array.from({ length: 20 }, () =>
        applyTokenTransaction({ userId: 'u2', type: 'debit', amount: 1, description: 'ocr' }),
      ),
    );

    const after = await getUser('u2');
    expect(after!.token_balance).toBeGreaterThanOrEqual(0);
    expect(after!.token_balance).toBe(0);
  });

  it('writes exactly one ledger row per successful debit', async () => {
    await createUser(makeUser('u3', 4));

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyTokenTransaction({ userId: 'u3', type: 'debit', amount: 1, description: 'ocr' }),
      ),
    );
    const succeeded = results.filter((r) => r.ok).length;

    const ledger = await getUserTransactions('u3', 100);
    expect(ledger).toHaveLength(succeeded);
    expect(succeeded).toBe(4);
  });

  it('keeps the ledger consistent with the final balance', async () => {
    await createUser(makeUser('u4', 10));

    await Promise.all([
      ...Array.from({ length: 5 }, () =>
        applyTokenTransaction({ userId: 'u4', type: 'debit', amount: 1, description: 'ocr' }),
      ),
      ...Array.from({ length: 3 }, () =>
        applyTokenTransaction({ userId: 'u4', type: 'credit', amount: 2, description: 'topup' }),
      ),
    ]);

    const after = await getUser('u4');
    const ledger = await getUserTransactions('u4', 100);

    const net = ledger.reduce((sum, t) => sum + (t.type === 'credit' ? t.amount : -t.amount), 0);
    expect(after!.token_balance).toBeCloseTo(10 + net, 4);
  });

  it('rejects a debit on a missing user without creating a ledger row', async () => {
    const result = await applyTokenTransaction({
      userId: 'ghost', type: 'debit', amount: 1, description: 'ocr',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('not_found');
    expect(await getUserTransactions('ghost', 10)).toHaveLength(0);
  });
});
