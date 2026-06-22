export const money = (v: number | null | undefined, currency = 'USD'): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
export const dateFmt = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
export const confLabel = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
export const confColor = (v: number): string => (v >= 0.85 ? '#1f9d63' : v >= 0.7 ? '#b07d12' : '#d1453b');
// Extraction cost in USD. Local providers (ollama) are 0 -> "Free"; small cloud costs
// keep enough precision to be visible (e.g. $0.008). Null/undefined -> em dash.
export const costFmt = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v === 0 ? 'Free' : `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
