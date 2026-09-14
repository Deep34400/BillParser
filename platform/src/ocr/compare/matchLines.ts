import type { LabourServiceLineItem, PartsLineItem } from '../../shared/types.js';
import type { LineDiff, MatchHow } from './types.js';

export interface NamedLine {
  key: string;
  name: string;
  code: string | null;
  amount: number | null;
  qty: number | null;
  rate: number | null;
  hsn: string | null;
  tax: number | null;
}

export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter((t) => t.length > 1));
  const tb = new Set(normalizeName(b).split(' ').filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

export function toPartLine(p: PartsLineItem, index: number): NamedLine {
  const name = p.item_name_description ?? `part-${index + 1}`;
  return {
    key: `p-${index}`,
    name,
    code: p.part_number_item_code ?? null,
    amount: p.taxable_amount ?? null,
    qty: p.quantity ?? null,
    rate: p.rate ?? null,
    hsn: p.hsn_sac_code ?? null,
    tax: p.tax_percentage ?? null,
  };
}

export function toLabourLine(p: LabourServiceLineItem, index: number): NamedLine {
  const name = p.labour_description ?? `labour-${index + 1}`;
  return {
    key: `l-${index}`,
    name,
    code: p.labour_code ?? null,
    amount: p.labour_charges ?? null,
    qty: null,
    rate: p.labour_charges ?? null,
    hsn: p.hsn_sac_code ?? null,
    tax: p.tax_percentage ?? null,
  };
}

function amountClose(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  if (a === 0 && b === 0) return true;
  const den = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / den <= 0.15;
}

function lineChanges(a: NamedLine, b: NamedLine): LineDiff['changes'] {
  const fields: Array<[string, number | null, number | null]> = [
    ['qty', a.qty, b.qty],
    ['rate', a.rate, b.rate],
    ['amount', a.amount, b.amount],
    ['tax', a.tax, b.tax],
  ];
  const changes: NonNullable<LineDiff['changes']> = [];
  for (const [field, left, right] of fields) {
    if (left == null && right == null) continue;
    if (left === right) continue;
    const delta = left != null && right != null ? right - left : undefined;
    changes.push({
      field,
      a: left,
      b: right,
      status: left == null ? 'missing_in_a' : right == null ? 'missing_in_b' : 'diff',
      delta,
    });
  }
  if ((a.hsn ?? '') !== (b.hsn ?? '') && (a.hsn || b.hsn)) {
    changes.push({
      field: 'hsn',
      a: a.hsn,
      b: b.hsn,
      status: a.hsn && b.hsn ? 'diff' : a.hsn ? 'missing_in_b' : 'missing_in_a',
    });
  }
  return changes;
}

export interface LineMatchResult {
  lines: LineDiff[];
  leftoverA: NamedLine[];
  leftoverB: NamedLine[];
}

export function matchNamedLines(left: NamedLine[], right: NamedLine[]): LineMatchResult {
  const usedB = new Set<number>();
  const lines: LineDiff[] = [];
  const leftoverA: NamedLine[] = [];

  function take(ai: number, bi: number, how: MatchHow): void {
    usedB.add(bi);
    const a = left[ai];
    const b = right[bi];
    const changes = lineChanges(a, b);
    const sameMoney = (changes ?? []).length === 0;
    lines.push({
      status: sameMoney ? 'match' : 'same_item',
      how,
      description: a.name,
      a: a.name,
      b: b.name,
      aAmount: a.amount ?? a.rate,
      bAmount: b.amount ?? b.rate,
      changes: sameMoney ? undefined : changes,
    });
  }

  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    let found = -1;
    if (a.code) {
      found = right.findIndex((b, j) => !usedB.has(j) && b.code && b.code.toLowerCase() === a.code!.toLowerCase());
    }
    if (found < 0) {
      const want = normalizeName(a.name);
      found = right.findIndex((b, j) => !usedB.has(j) && normalizeName(b.name) === want && want);
    }
    if (found >= 0) {
      take(i, found, 'exact');
      continue;
    }
    leftoverA.push(a);
  }

  const leftoverB: NamedLine[] = [];
  const stillA: NamedLine[] = [];
  const leftoverAIdx = leftoverA.map((row) => left.indexOf(row));

  for (let k = 0; k < leftoverA.length; k++) {
    const a = leftoverA[k];
    let best = -1;
    let bestScore = 0;
    for (let j = 0; j < right.length; j++) {
      if (usedB.has(j)) continue;
      const score = tokenOverlap(a.name, right[j].name);
      if (score >= 0.5 && score > bestScore && amountClose(a.amount ?? a.rate, right[j].amount ?? right[j].rate)) {
        bestScore = score;
        best = j;
      }
    }
    if (best >= 0) take(leftoverAIdx[k], best, 'fuzzy');
    else stillA.push(a);
  }

  for (let j = 0; j < right.length; j++) {
    if (!usedB.has(j)) leftoverB.push(right[j]);
  }

  return { lines, leftoverA: stillA, leftoverB };
}

export function leftoversToDiffs(left: NamedLine[], right: NamedLine[]): LineDiff[] {
  return [
    ...left.map((a) => ({
      status: 'missing_in_b' as const,
      how: 'none' as const,
      description: a.name,
      a: a.name,
      aAmount: a.amount ?? a.rate,
    })),
    ...right.map((b) => ({
      status: 'extra_in_b' as const,
      how: 'none' as const,
      description: b.name,
      b: b.name,
      bAmount: b.amount ?? b.rate,
    })),
  ];
}

export function applyAiPairs(
  leftoverA: NamedLine[],
  leftoverB: NamedLine[],
  pairs: Array<{ a: number; b: number; confidence: number }>,
): { lines: LineDiff[]; leftoverA: NamedLine[]; leftoverB: NamedLine[] } {
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const lines: LineDiff[] = [];

  for (const p of pairs) {
    if (usedA.has(p.a) || usedB.has(p.b)) continue;
    const a = leftoverA[p.a];
    const b = leftoverB[p.b];
    if (!a || !b) continue;
    usedA.add(p.a);
    usedB.add(p.b);
    const changes = lineChanges(a, b);
    const sameMoney = (changes ?? []).length === 0;
    lines.push({
      status: sameMoney ? 'match' : 'same_item',
      how: 'ai',
      description: a.name,
      a: a.name,
      b: b.name,
      aAmount: a.amount ?? a.rate,
      bAmount: b.amount ?? b.rate,
      changes: sameMoney ? undefined : changes,
      confidence: p.confidence,
    });
  }

  return {
    lines,
    leftoverA: leftoverA.filter((_, i) => !usedA.has(i)),
    leftoverB: leftoverB.filter((_, i) => !usedB.has(i)),
  };
}
