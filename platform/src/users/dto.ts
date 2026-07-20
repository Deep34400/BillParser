/**
 * User DTOs — data transfer shapes for API responses.
 * Strips sensitive fields (password_hash, api_key_hash) before sending to clients.
 */
import type { UserDoc } from './repository.js';

/** Public user view for authenticated users — hides password + api key internals. */
export function clientUserView(user: UserDoc) {
  const unlimited = user.role === 'admin'
    || user.token_balance === Infinity
    || !Number.isFinite(user.token_balance);

  return {
    user_id: user.user_id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    token_balance: unlimited ? null : user.token_balance,
    total_tokens_used: user.total_tokens_used,
    total_ocr_count: user.total_ocr_count,
    total_cost_usd: user.total_cost_usd,
  };
}

/** Admin user view — everything except sensitive hashes. */
export function sanitizeUser(u: UserDoc) {
  const { password_hash: _, api_key_hash: _2, ...rest } = u;
  return rest;
}
