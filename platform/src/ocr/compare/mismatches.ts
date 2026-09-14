import type { CompareMismatch, CompareResult } from './types.js';

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

export function buildMismatches(result: CompareResult): CompareMismatch[] {
  const rows: CompareMismatch[] = [];

  for (const f of result.header) {
    if (f.status === 'match') continue;
    rows.push({
      kind: 'header',
      label: f.field.replace(/_/g, ' '),
      detail: `${f.a ?? '—'} vs ${f.b ?? '—'}`,
      check: 'review',
    });
  }
  for (const f of result.totals) {
    if (f.status === 'match') continue;
    rows.push({
      kind: 'total',
      label: f.field.replace(/_/g, ' '),
      detail: f.delta != null ? `${money(f.a as number)} → ${money(f.b as number)} (Δ ${money(f.delta)})` : `${f.a ?? '—'} vs ${f.b ?? '—'}`,
      check: 'review',
    });
  }
  for (const line of [...result.parts, ...result.labour]) {
    if (line.status === 'missing_in_b') {
      rows.push({ kind: 'missing', label: line.a ?? line.description, detail: 'Only on invoice A', check: 'review' });
    } else if (line.status === 'extra_in_b') {
      rows.push({ kind: 'extra', label: line.b ?? line.description, detail: 'Only on invoice B', check: 'review' });
    } else if (line.status === 'same_item') {
      const delta = line.changes?.find((c) => c.delta != null);
      rows.push({
        kind: 'changed',
        label: `${line.a} ↔ ${line.b}`,
        detail: delta ? `${delta.field} Δ ${money(delta.delta)} (${line.how})` : `Same item via ${line.how}, fields differ`,
        check: 'review',
      });
    }
  }
  for (const r of result.validation.rejectedAi) {
    rows.push({
      kind: 'rejected_ai',
      label: `${r.a} ↔ ${r.b}`,
      detail: r.reason,
      check: 'review',
    });
  }
  return rows;
}
