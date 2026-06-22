export const money = (v: number | null | undefined, currency = 'USD'): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
export const dateFmt = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
export const confLabel = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
export const confColor = (v: number): string => (v >= 0.85 ? '#1f9d63' : v >= 0.7 ? '#b07d12' : '#d1453b');
// Provider cost estimates are computed in USD; display them in rupees to match the
// (Indian) invoice amounts. Approximate fixed rate — these are estimates, not billed
// figures — adjust here if you want a different conversion.
export const USD_TO_INR = 83;
// Extraction + structuring cost. Local providers (ollama) are 0 -> "Free"; otherwise
// convert USD -> INR and format as ₹. Null/undefined -> em dash.
export const costFmt = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : v === 0
      ? 'Free'
      : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v * USD_TO_INR);
