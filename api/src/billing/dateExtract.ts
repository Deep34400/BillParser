/**
 * Deterministic invoice-date fallback.
 *
 * Some dealer formats (e.g. JN Car Care / Autorox) print the date as "Date: Jun 19 2026",
 * which the LLM occasionally drops — yielding invoice_date: null and breaking downstream
 * "bill_date is required" validation. This re-reads the date straight from the OCR markdown.
 *
 * Output is normalized to day-first DD/MM/YYYY (the dominant Indian invoice format the LLM
 * already emits for these dealers), so it stays consistent with LLM-extracted dates.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// Labels that are NOT the invoice date and must never be picked as a fallback.
const EXCLUDED_LABELS = /(due|ro|next|serv|job|gate|deliver|print|order|valid|warranty|reg|birth)/i;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDMY(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = year < 100 ? 2000 + year : year;
  if (y < 1990 || y > 2100) return null;
  return `${pad2(day)}/${pad2(month)}/${y}`;
}

/** Parse a single date token out of a short value string. Returns DD/MM/YYYY or null. */
function parseDateValue(value: string): string | null {
  const v = value.trim();

  // "Mon DD YYYY" / "Mon DD, YYYY" (e.g. "Jun 19 2026")
  const monDay = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s+(\d{4})\b/.exec(v);
  if (monDay) {
    const m = MONTHS[monDay[1].toLowerCase()];
    if (m) return toDMY(Number(monDay[2]), m, Number(monDay[3]));
  }

  // "DD Mon YYYY" (e.g. "19 Jun 2026")
  const dayMon = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s+(\d{4})\b/.exec(v);
  if (dayMon) {
    const m = MONTHS[dayMon[2].toLowerCase()];
    if (m) return toDMY(Number(dayMon[1]), m, Number(dayMon[3]));
  }

  // Numeric day-first "DD/MM/YYYY", "DD.MM.YYYY", "DD-MM-YYYY"
  const numeric = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/.exec(v);
  if (numeric) {
    return toDMY(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  }

  return null;
}

/**
 * Find the invoice date in OCR markdown.
 * Prefers an explicit "Invoice Date" / "Bill Date" label; otherwise falls back to a plain
 * "Date:" whose value parses to a valid date, skipping Due/RO/Next-Service style labels.
 */
export function extractInvoiceDateFromMarkdown(markdown?: string | null): string | null {
  if (!markdown) return null;

  // Capture the word(s) immediately before "date" plus the value after the separator.
  const re = /([A-Za-z.]*)\s*\b(date)\b\s*[:.\-]?\s*([^\n|]{0,30})/gi;
  let preferred: string | null = null;
  let fallback: string | null = null;

  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) {
    const before = m[1] ?? '';
    const value = m[3] ?? '';
    const parsed = parseDateValue(value);
    if (!parsed) continue;

    if (/invoice|bill|tax|^$/i.test(before.trim()) && !EXCLUDED_LABELS.test(before)) {
      // Explicit invoice/bill/tax date — highest priority.
      if (/invoice|bill|tax/i.test(before)) return parsed;
      // Bare "Date:" — keep as fallback.
      if (fallback == null) fallback = parsed;
    } else if (!EXCLUDED_LABELS.test(before) && fallback == null) {
      fallback = parsed;
    }
  }

  return preferred ?? fallback;
}
