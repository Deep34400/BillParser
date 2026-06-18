function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.map(cell).join(',');
  const body = rows.map((r) => headers.map((h) => cell(r[h])).join(','));
  return [head, ...body].join('\r\n');
}
