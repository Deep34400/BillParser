import type { CompareResult, FieldDiff } from './types.js';

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

function notable(fields: FieldDiff[]): FieldDiff[] {
  return fields.filter((f) => f.status !== 'match');
}

export function summarizeDiff(diff: CompareResult): string {
  const a = diff.invoiceA;
  const b = diff.invoiceB;
  const total = diff.totals.find((f) => f.field === 'grand_total_invoice');
  const bits: string[] = [];

  bits.push(
    `Invoice A (${money(a.total)} from ${a.vendorName ?? 'unknown'}${a.invoiceDate ? `, ${a.invoiceDate}` : ''})`
    + ` vs Invoice B (${money(b.total)} from ${b.vendorName ?? 'unknown'}${b.invoiceDate ? `, ${b.invoiceDate}` : ''}).`,
  );

  if (total?.status === 'match') {
    bits.push('Grand totals match.');
  } else if (total?.delta != null) {
    const sign = total.delta > 0 ? '+' : '';
    bits.push(`Grand total differs by ${money(total.delta)} (${sign}${total.deltaPct ?? 0}%).`);
  }

  for (const f of notable(diff.totals).filter((x) => x.field !== 'grand_total_invoice')) {
    if (f.delta != null) bits.push(`${f.field.replace(/_/g, ' ')} differs by ${money(f.delta)}.`);
  }

  const headerMiss = notable(diff.header);
  if (headerMiss.length) {
    bits.push(`Header: ${headerMiss.map((f) => f.field.replace(/_/g, ' ')).join(', ')} differ.`);
  }

  const { matched, changed, missing, extra, aiPairs } = diff.counts;
  const lineBits = [
    matched ? `${matched} match` : null,
    changed ? `${changed} same item with field changes` : null,
    missing ? `${missing} missing in B` : null,
    extra ? `${extra} extra in B` : null,
    aiPairs ? `${aiPairs} paired by AI` : null,
  ].filter(Boolean);
  if (lineBits.length) bits.push(`Line items: ${lineBits.join(', ')}.`);
  else bits.push('No line items to compare.');

  const missingNames = [...diff.parts, ...diff.labour]
    .filter((l) => l.status === 'missing_in_b')
    .map((l) => l.a)
    .filter(Boolean)
    .slice(0, 4);
  const extraNames = [...diff.parts, ...diff.labour]
    .filter((l) => l.status === 'extra_in_b')
    .map((l) => l.b)
    .filter(Boolean)
    .slice(0, 4);
  if (missingNames.length) bits.push(`Missing in B: ${missingNames.join(', ')}.`);
  if (extraNames.length) bits.push(`Only in B: ${extraNames.join(', ')}.`);

  if (
    matched > 0
    && changed === 0
    && missing === 0
    && extra === 0
    && notable(diff.header).length === 0
    && notable(diff.totals).length === 0
  ) {
    return 'Invoices are identical.';
  }

  return bits.join(' ');
}
