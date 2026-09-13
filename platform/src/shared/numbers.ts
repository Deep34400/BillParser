/** Coerce DB / JSON numerics to a finite number, or null. */
export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimal places (currency precision). */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
