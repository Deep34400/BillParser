/** Admin / unlimited accounts — Infinity is lost when JSON-serialized. */
export function hasUnlimitedBalance(role: string, balance: number | null | undefined): boolean {
  if (role === 'admin') return true;
  if (balance == null || balance === Infinity) return false;
  return balance > 999_999_999;
}

const USD_TO_INR = 83;

/** Format balance in ₹ (backend stores in USD, convert for display). */
export function formatBalance(role: string, balance: number | null | undefined): string {
  if (hasUnlimitedBalance(role, balance)) return '∞';
  const n = typeof balance === 'number' && Number.isFinite(balance) ? balance : 0;
  const inr = n * USD_TO_INR;
  return `₹${inr.toFixed(2)}`;
}

export function balanceNumber(role: string, balance: number | null | undefined): number {
  if (hasUnlimitedBalance(role, balance)) return Infinity;
  return typeof balance === 'number' && Number.isFinite(balance) ? balance : 0;
}
