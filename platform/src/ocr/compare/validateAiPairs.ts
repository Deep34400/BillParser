/**
 * Deterministic checks after the AI name-match step.
 * Money and "is this really the same part?" stay rule-based so a bad pair is dropped.
 */
import type { NamedLine } from './matchLines.js';
import { tokenOverlap } from './matchLines.js';
import type { AiNamePair } from './aiMatch.js';

export interface RejectedAiPair {
  a: string;
  b: string;
  reason: string;
  confidence: number;
}

export interface AiPairValidation {
  accepted: AiNamePair[];
  rejected: RejectedAiPair[];
}

function amountPct(a: NamedLine, b: NamedLine): number | null {
  const left = a.amount ?? a.rate;
  const right = b.amount ?? b.rate;
  if (left == null || right == null) return null;
  const den = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / den;
}

export function validateAiPairs(
  leftoverA: NamedLine[],
  leftoverB: NamedLine[],
  pairs: AiNamePair[],
): AiPairValidation {
  const accepted: AiNamePair[] = [];
  const rejected: RejectedAiPair[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  for (const pair of pairs) {
    const left = leftoverA[pair.a];
    const right = leftoverB[pair.b];
    if (!left || !right) {
      rejected.push({ a: String(pair.a), b: String(pair.b), reason: 'AI index out of range', confidence: pair.confidence });
      continue;
    }
    if (usedA.has(pair.a) || usedB.has(pair.b)) {
      rejected.push({ a: left.name, b: right.name, reason: 'AI reused an already paired line', confidence: pair.confidence });
      continue;
    }
    if (pair.confidence < 0.6) {
      rejected.push({ a: left.name, b: right.name, reason: 'AI confidence below 0.6', confidence: pair.confidence });
      continue;
    }
    const overlap = tokenOverlap(left.name, right.name);
    const pct = amountPct(left, right);
    if (pct != null && pct > 0.4 && overlap < 0.15) {
      rejected.push({
        a: left.name,
        b: right.name,
        reason: `Amounts differ by ${Math.round(pct * 100)}% and names do not overlap — treated as different items`,
        confidence: pair.confidence,
      });
      continue;
    }
    usedA.add(pair.a);
    usedB.add(pair.b);
    accepted.push(pair);
  }

  return { accepted, rejected };
}

export function validateSummaryClaims(
  claimed: { missing?: string[]; extra?: string[]; changed?: string[] },
  actualMissing: string[],
  actualExtra: string[],
  actualChanged: string[],
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const has = (list: string[], name: string) => list.some((x) => norm(x) === norm(name) || norm(x).includes(norm(name)) || norm(name).includes(norm(x)));

  for (const name of claimed.missing ?? []) {
    if (name && !has(actualMissing, name)) issues.push(`Summary said missing "${name}" but it is not in the structured miss list`);
  }
  for (const name of claimed.extra ?? []) {
    if (name && !has(actualExtra, name)) issues.push(`Summary said extra "${name}" but it is not in the structured extra list`);
  }
  for (const name of claimed.changed ?? []) {
    if (name && !has(actualChanged, name) && !has(actualMissing, name) && !has(actualExtra, name)) {
      issues.push(`Summary said changed "${name}" but that line is not in the diff`);
    }
  }
  return { ok: issues.length === 0, issues };
}
