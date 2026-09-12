import { usdToInrRate } from './format.js';
/** Admin / unlimited accounts — Infinity is lost when JSON-serialized. */
export function hasUnlimitedBalance(role: string, balance: number | null | undefined): boolean {
  if (role === 'admin') return true;
  if (balance == null || balance === Infinity) return false;
  return balance > 999_999_999;
}


function asUsd(balance: number | string | null | undefined): number {
  if (balance == null || balance === '') return 0;
  const n = typeof balance === 'number' ? balance : Number(balance);
  return Number.isFinite(n) ? n : 0;
}

/** Format balance in ₹ (backend stores in USD, convert for display). */
export function formatBalance(role: string, balance: number | string | null | undefined): string {
  if (hasUnlimitedBalance(role, asUsd(balance))) return '∞';
  const inr = asUsd(balance) * usdToInrRate();
  return `₹${inr.toFixed(2)}`;
}

export function balanceNumber(role: string, balance: number | string | null | undefined): number {
  if (hasUnlimitedBalance(role, asUsd(balance))) return Infinity;
  return asUsd(balance);
}
