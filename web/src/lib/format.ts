export const money = (v: number | null | undefined, currency = 'INR'): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

/** Full precision — use in tooltips / detail rows. */
export const moneyFull = (v: number | null | undefined, currency = 'INR'): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** Compact Indian format for tables with many rows (₹5.2L, ₹1.3Cr). */
export const moneyCompact = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

export const countFmt = (n: number): string => n.toLocaleString('en-IN');

/** Plain number formatting — no currency symbol (for tables that show amounts only). */
export const amount = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** Parse Indian invoice dates (DD/MM/YYYY, DD.MM.YYYY) and ISO strings for display. */
function parseDisplayDate(v: string): Date | null {
  const trimmed = v.trim();
  // ISO / YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD/MM/YYYY HH:MM:SS (strip time for date-only display)
  const m = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const dateFmt = (v: string | null | undefined): string => {
  if (!v) return '—';
  const d = parseDisplayDate(v);
  if (!d) return v;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
};
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
