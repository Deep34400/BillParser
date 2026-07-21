/**
 * Deterministic invoice-date fallback.
 *
 * Some dealer formats print the date as "Date: Jun 19 2026", which the LLM
 * occasionally drops. This re-reads the date straight from the OCR markdown.
 *
 * Output is normalized to DD/MM/YYYY (the dominant Indian invoice format).
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const EXCLUDED_LABELS = /(due|ro|next|serv|job|gate|deliver|print|order|valid|warranty|reg|birth)/i;
const SKIP_DATE_LINE = /job\s*card\s*date|gate\s*pass|next\s*service|due\s*date|delivery\s*date|print\s*date|bill\s*date\s*:/i;

function lineContaining(markdown: string, index: number): string {
  const start = markdown.lastIndexOf('\n', index) + 1;
  const end = markdown.indexOf('\n', index);
  return markdown.slice(start, end === -1 ? undefined : end);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDMY(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = year < 100 ? 2000 + year : year;
  if (y < 1990 || y > 2100) return null;
  return `${pad2(day)}/${pad2(month)}/${y}`;
}

function parseDateValue(value: string): string | null {
  const v = value.trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();

  const monDay = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s+(\d{4})\b/.exec(v);
  if (monDay) {
    const m = MONTHS[monDay[1].toLowerCase()];
    if (m) return toDMY(Number(monDay[2]), m, Number(monDay[3]));
  }

  const dayMon = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s+(\d{4})\b/.exec(v);
  if (dayMon) {
    const m = MONTHS[dayMon[2].toLowerCase()];
    if (m) return toDMY(Number(dayMon[1]), m, Number(dayMon[3]));
  }

  const numeric = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/.exec(v);
  if (numeric) {
    return toDMY(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  }

  return null;
}

export function extractInvoiceDateFromMarkdown(markdown?: string | null): string | null {
  if (!markdown) return null;

  const re = /([A-Za-z.]*)\s*\b(date)\b\s*[:.\-]?\s*([^\n|]{0,30})/gi;
  let bareDate: string | null = null;

  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) {
    const line = lineContaining(markdown, m.index ?? 0);
    if (SKIP_DATE_LINE.test(line)) continue;

    const before = (m[1] ?? '').trim();
    const value = m[3] ?? '';
    const parsed = parseDateValue(value);
    if (!parsed) continue;

    if (/invoice|bill|tax/i.test(before)) return parsed;

    if (before === '' && !EXCLUDED_LABELS.test(before)) {
      bareDate = parsed;
      continue;
    }

    if (!EXCLUDED_LABELS.test(before) && bareDate == null) bareDate = parsed;
  }

  return bareDate;
}

function splitDateTime(raw: string): { date: string; time: string | null } {
  const m = raw.trim().match(
    /^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/,
  );
  if (!m) return { date: raw.trim(), time: null };
  const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
  const normalized = parseDateValue(m[1]);
  return { date: normalized ?? m[1], time };
}

export interface InvoiceDateFields {
  invoice_date?: string | null;
  invoice_time?: string | null;
}

export function normalizeInvoiceDateFields(
  fields: InvoiceDateFields,
  markdown?: string | null,
): InvoiceDateFields {
  let invoice_date = fields.invoice_date ?? null;
  let invoice_time = fields.invoice_time ?? null;

  if (invoice_date && !invoice_time) {
    const split = splitDateTime(invoice_date);
    if (split.time) {
      invoice_date = split.date;
      invoice_time = split.time;
    }
  }

  if (invoice_date) {
    const normalized = parseDateValue(invoice_date);
    if (normalized) invoice_date = normalized;
  }

  if (!invoice_date && markdown) {
    const fromMd = extractInvoiceDateFromMarkdown(markdown);
    if (fromMd) {
      invoice_date = fromMd;
      if (!invoice_time) {
        const tm = markdown.match(
          /\b(?:invoice|bill|tax)?\s*date\b\s*[:.\-]?\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\s+(\d{1,2}:\d{2}(?::\d{2})?)/i,
        );
        if (tm?.[1]) invoice_time = tm[1].length === 5 ? `${tm[1]}:00` : tm[1];
      }
    }
  }

  return { invoice_date, invoice_time };
}
