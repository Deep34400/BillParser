/** Serialize user for JSON API — Infinity becomes null (admin = unlimited on client). */
import type { UserDoc } from '../models/users.js';

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
