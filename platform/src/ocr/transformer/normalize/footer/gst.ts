import type { TotalsAndTaxSummary, GstBreakdownLine } from '../../../types/invoice.js';

import { roundMoney } from '../../../../shared/numbers.js';

export function parseMoneyToken(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, '').trim());
  return Number.isFinite(n) ? roundMoney(n) : null;
}

/**
 * Extract money tokens — never split 1017.50 into 101 + 7.50. The bare-integer branch (4+ digits,
 * no comma/decimal) is guarded with letter look-arounds so digit runs embedded in alphanumeric IDs
 * (e.g. the "4998" in a GSTIN "36AABCS4998M1ZK") are never mistaken for an amount.
 */
export function moneyTokensFromText(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|(?<![A-Za-z])\d{4,}(?:\.\d{1,2})?(?![A-Za-z]))/g)]
    .map((m) => parseMoneyToken(m[1]))
    .filter((n): n is number => n != null);
}

/** Parts | Labour columns — handles 2-col and 3-col (Parts | 0 | Labour) footers. */
export function footerColumnAmounts(line: string): [number | null, number | null] {
  const tokens = moneyTokensFromText(line);
  if (tokens.length >= 3) return [tokens[0], tokens[tokens.length - 1]];
  if (tokens.length >= 2) return [tokens[tokens.length - 2], tokens[tokens.length - 1]];
  if (tokens.length === 1) return [tokens[0], null];
  return [null, null];
}

/** Strip CGST@ 9 / CGST @ 9% label so rate digits are not parsed as amounts. */
function stripGstLabel(line: string, kind: 'cgst' | 'sgst' | 'igst'): { rate: number | null; rest: string } {
  const rateM = line.match(new RegExp(`\\b${kind}\\b\\s*@?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:%|(?=\\s|:|$))`, 'i'));
  const rate = rateM ? parseFloat(rateM[1]) : null;
  const rest = rateM ? line.replace(rateM[0], ' ') : line.replace(new RegExp(`\\b${kind}\\b[^\\d]*`, 'i'), ' ');
  return { rate, rest };
}

/** @deprecated use footerColumnAmounts */
export function lastTwoAmounts(line: string): [number | null, number | null] {
  return footerColumnAmounts(line);
}

/** GST = rate% × subtotal (before discount) — common LLM mistake; printed invoice uses after-discount amounts. */
export function isCalculatedGstAmount(
  subtotal: number | null | undefined,
  rate: number | null | undefined,
  amount: number | null | undefined,
): boolean {
  if (subtotal == null || amount == null) return false;
  const r = rate ?? 9;
  return Math.abs(amount - roundMoney(subtotal * r / 100)) < 0.1;
}

/** GST = rate% × (subtotal − discount) — not gross subtotal. */
export function stripCalculatedFooterAmounts(t: TotalsAndTaxSummary): void {
  const bd = t.gst_breakdown;
  // GST printed per-side in the footer (captured into gst_breakdown) is authoritative even when it
  // happens to equal gross×rate — e.g. credit notes where the discount is a separate line.
  const footerSourced = (side: 'parts' | 'labour') =>
    Array.isArray(bd) && bd.some((e) => (e[side] ?? 0) > 0);
  for (const side of ['parts', 'labour'] as const) {
    if (footerSourced(side)) continue;
    const sub = side === 'parts' ? t.parts_total : t.labour_total;
    if (sub == null || sub === 0) continue;
    const disc = side === 'parts' ? (t.parts_discount ?? 0) : (t.labour_discount ?? 0);
    const taxable = roundMoney(sub - disc);
    if (taxable <= 0) continue;
    const rate = side === 'parts'
      ? (t.parts_cgst_rate ?? t.parts_sgst_rate ?? 9)
      : (t.labour_cgst_rate ?? t.labour_sgst_rate ?? 9);
    const expectedGst = roundMoney(taxable * rate / 100);
    const cgst = side === 'parts' ? t.parts_cgst_amount : t.labour_cgst_amount;
    const sgst = side === 'parts' ? t.parts_sgst_amount : t.labour_sgst_amount;
    const grossGst = roundMoney(sub * rate / 100);
    const matchesAfterDisc = (a: number | null | undefined) =>
      a != null && Math.abs(a - expectedGst) < 0.15;
    const matchesGrossOnly = (a: number | null | undefined) =>
      a != null && Math.abs(a - grossGst) < 0.15 && !matchesAfterDisc(a);
    if (matchesGrossOnly(cgst) || matchesGrossOnly(sgst)) {
      if (side === 'parts') { delete t.parts_cgst_amount; delete t.parts_sgst_amount; }
      else { delete t.labour_cgst_amount; delete t.labour_sgst_amount; }
    }
  }
}

/**
 * Tally "Less : O-CGST … O-SGST …" combined adjustment rows are NOT tax lines.
 * Standalone O-CGST / O-SGST rows with amounts (TyresNMore battery invoice) ARE real GST.
 */
function isGoodsTableGstAdjustment(line: string): boolean {
  return /less\s*:\s*.*\bo-?[cs]?gst\b/i.test(line) || /^\s*less\s*:/i.test(line);
}

function isTallyOutputGstLine(line: string, kind: 'cgst' | 'sgst' | 'igst'): boolean {
  return kind === 'cgst' ? /\bo-?cgst\b/i.test(line) : /\bo-?sgst\b/i.test(line);
}

export function isCgstLine(line: string): boolean {
  if (isGoodsTableGstAdjustment(line)) return false;
  return /\bo-?cgst\b|\bcgst\d*\b|central\s*gst/i.test(line);
}

export function isSgstLine(line: string): boolean {
  if (isGoodsTableGstAdjustment(line)) return false;
  return /\bo-?sgst\b|\bsgst\d*\b|state\s*gst/i.test(line);
}

/** "Integrated GST" is just IGST printed in full (Toyota/Tally dealers). */
export function isIgstLine(line: string): boolean {
  return /\bigst\d*\b|integrated\s*gst/i.test(line);
}

/** A footer GST line that names its side: "Central/State GST for Parts", "Integrated GST for Lubricants Parts". */
function isSideSpecificGstLine(line: string): boolean {
  return /\b(?:cgst|sgst|igst|central\s*gst|state\s*gst|integrated\s*gst)\s*for\s+[\w\s]*?(?:parts|labou?r|service)\b/i.test(line);
}

/** Which GST kinds appear as authoritative per-side splits — combined lines of those kinds are ignored. */
export function sideSpecificGstKinds(md: string): Set<'cgst' | 'sgst' | 'igst'> {
  const kinds = new Set<'cgst' | 'sgst' | 'igst'>();
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\|/g, ' ');
    const m = line.match(/\b(cgst|sgst|igst|central\s*gst|state\s*gst|integrated\s*gst)\s*for\s+[\w\s]*?(?:parts|labou?r|service)\b/i);
    if (!m) continue;
    const k = m[1].toLowerCase().replace(/\s+/g, '');
    if (k === 'igst' || k === 'integratedgst') kinds.add('igst');
    else if (k === 'cgst' || k === 'centralgst') kinds.add('cgst');
    else if (k === 'sgst' || k === 'stategst') kinds.add('sgst');
  }
  return kinds;
}

function parseSideSpecificGstLine(line: string): { rate: number | null; parts: number | null; labour: number | null } {
  // "Service" is labour in automotive invoices (e.g. Toyota "Central GST for Service").
  const forLabour = /\bfor\s+[\w\s]*?(labou?r|service)\b/i.test(line);
  const forParts = /\bfor\s+[\w\s]*?parts\b/i.test(line);
  const rateM = line.match(/@\s*(\d+(?:\.\d+)?)\s*%/i);
  const rate = rateM ? parseFloat(rateM[1]) : 9;
  const nums = moneyTokensFromText(line);
  const amount = nums.length ? nums[nums.length - 1] : null;
  if (forLabour && amount != null) return { rate, parts: null, labour: amount };
  if (forParts && amount != null) return { rate, parts: amount, labour: null };
  const [p, l] = footerColumnAmounts(line);
  return { rate, parts: p, labour: l };
}

function parseGstLine(line: string, kind: 'cgst' | 'sgst' | 'igst'): { rate: number | null; parts: number | null; labour: number | null } {
  if (isSideSpecificGstLine(line)) return parseSideSpecificGstLine(line);
  // Tally goods-table rows: "O-CGST (Karnataka) ... 271.14"
  if (isTallyOutputGstLine(line, kind)) {
    const nums = moneyTokensFromText(line);
    const amount = nums.length ? nums[nums.length - 1] : null;
    const [p, l] = footerColumnAmounts(line);
    return { rate: null, parts: p ?? amount, labour: l };
  }
  // Glued-rate form (Zoho): "CGST9 (9%)", "IGST18 (18%)" — take the glued rate, drop the name and
  // the parenthesised "(NN%)" so only the printed amount remains.
  const gluedM = line.match(new RegExp(`\\b${kind}(\\d+(?:\\.\\d+)?)\\b`, 'i'));
  if (gluedM) {
    const rest = line.replace(gluedM[0], ' ').replace(/\(\s*\d+(?:\.\d+)?\s*%\s*\)/g, ' ');
    const [p, l] = footerColumnAmounts(rest);
    return { rate: parseFloat(gluedM[1]), parts: p, labour: l };
  }
  const rateM = line.match(new RegExp(`\\b${kind}\\b\\s*@?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:%|(?=\\s|:|$))`, 'i'));
  const rate = rateM ? parseFloat(rateM[1]) : null;
  const rest = rateM ? line.replace(rateM[0], ' ') : line.replace(new RegExp(`\\b${kind}\\b[^\\d]*`, 'i'), ' ');
  const [p, l] = footerColumnAmounts(rest);
  return { rate, parts: p, labour: l };
}

function addGstAmount(
  out: Partial<TotalsAndTaxSummary>,
  kind: 'cgst' | 'sgst' | 'igst',
  side: 'parts' | 'labour',
  amount: number,
  rate: number | null,
): void {
  const rateKey = kind === 'cgst'
    ? (side === 'parts' ? 'parts_cgst_rate' : 'labour_cgst_rate')
    : kind === 'sgst'
      ? (side === 'parts' ? 'parts_sgst_rate' : 'labour_sgst_rate')
      : (side === 'parts' ? 'parts_igst_rate' : 'labour_igst_rate');
  const amtKey = kind === 'cgst'
    ? (side === 'parts' ? 'parts_cgst_amount' : 'labour_cgst_amount')
    : kind === 'sgst'
      ? (side === 'parts' ? 'parts_sgst_amount' : 'labour_sgst_amount')
      : (side === 'parts' ? 'parts_igst_amount' : 'labour_igst_amount');
  const prev = out[amtKey] ?? 0;
  out[amtKey] = roundMoney(prev + amount);
  if (rate != null) {
    const existing = out[rateKey];
    if (existing != null && existing !== rate) out[rateKey] = undefined;
    else if (existing == null) out[rateKey] = rate;
  }
}

export function applyGstLine(
  out: Partial<TotalsAndTaxSummary>,
  kind: 'cgst' | 'sgst' | 'igst',
  line: string,
  chargeTable: Set<'parts' | 'labour'>,
  gstBreakdown: GstBreakdownLine[],
  splitKinds: Set<'cgst' | 'sgst' | 'igst'>,
  seenGstValues: Set<string>,
): void {
  const sideSpecific = isSideSpecificGstLine(line);
  // Combined GST lines are ignored when a charge table or an authoritative per-side split
  // of this kind already supplies the columns (prevents double-counting the printed total).
  if (!sideSpecific && (chargeTable.size > 0 || splitKinds.has(kind))) return;
  const parsed = parseGstLine(line, kind);
  const rate = parsed.rate;
  let parts = parsed.parts;
  let labour = parsed.labour;

  // Single-column GST on a parts-less bill belongs to labour (e.g. body-shop invoices).
  if (!sideSpecific && parts != null && parts > 0 && (labour == null || labour === 0)
    && (out.parts_total ?? null) === 0 && (out.labour_total ?? 0) > 0) {
    labour = parts;
    parts = null;
  }

  const kindUpper = kind.toUpperCase() as GstBreakdownLine['kind'];
  if ((parts ?? 0) > 0 || (labour ?? 0) > 0) {
    // Merge side-specific lines of the same kind+rate into a single Parts/Labour row.
    const existing = gstBreakdown.find((e) => e.kind === kindUpper && (e.rate ?? null) === (rate ?? null));
    if (existing) {
      if (parts != null && parts > 0) existing.parts = parts;
      if (labour != null && labour > 0) existing.labour = labour;
    } else {
      gstBreakdown.push({ kind: kindUpper, rate, parts: parts ?? undefined, labour: labour ?? undefined });
    }
  }

  // The same printed GST total can appear on more than one OCR line (e.g. the goods table and
  // again in the bill summary) with different surrounding text. Apply each (kind, rate, side,
  // amount) only once so a single tax is never accumulated twice. Distinct rates/amounts (e.g.
  // IGST @ 28% + IGST @ 18%, or two real sub-lines) have different signatures and still sum.
  const once = (side: 'parts' | 'labour', amount: number): boolean => {
    const sig = `${kind}|${rate ?? ''}|${side}|${roundMoney(amount)}`;
    if (seenGstValues.has(sig)) return false;
    seenGstValues.add(sig);
    return true;
  };
  if (parts != null && parts > 0) {
    if ((sideSpecific || !chargeTable.has('parts')) && once('parts', parts)) addGstAmount(out, kind, 'parts', parts, rate);
  }
  if (labour != null && labour > 0) {
    if ((sideSpecific || !chargeTable.has('labour')) && once('labour', labour)) addGstAmount(out, kind, 'labour', labour, rate);
  }
}

/** Tally HSN/SAC summary table — fills GST rates/amounts when only O-CGST rows appear in the goods table. */
export function applyHsnSummaryTable(md: string, out: Partial<TotalsAndTaxSummary>): void {
  let best: {
    taxable: number; cgstRate: number; cgst: number; sgstRate: number; sgst: number;
  } | null = null;

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/\d/.test(line) || !/%/.test(line)) continue;
    const m = line.match(
      /(?:^total\b|\b\d{6,8}\b)\s+([\d,]+\.\d{2})\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+\.\d{2})\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+\.\d{2})/i,
    );
    if (!m) continue;
    const taxable = parseMoneyToken(m[1]);
    const cgstRate = parseFloat(m[2]);
    const cgst = parseMoneyToken(m[3]);
    const sgstRate = parseFloat(m[4]);
    const sgst = parseMoneyToken(m[5]);
    if (taxable == null || cgst == null || sgst == null) continue;
    best = { taxable, cgstRate, cgst, sgstRate, sgst };
    if (/^total\b/i.test(line)) break;
  }

  if (!best) return;

  if (out.parts_total == null || out.parts_total === 0) out.parts_total = best.taxable;
  if (out.parts_cgst_amount == null || out.parts_cgst_amount === 0) {
    out.parts_cgst_amount = best.cgst;
    out.parts_cgst_rate = best.cgstRate;
  } else if (out.parts_cgst_rate == null) {
    out.parts_cgst_rate = best.cgstRate;
  }
  if (out.parts_sgst_amount == null || out.parts_sgst_amount === 0) {
    out.parts_sgst_amount = best.sgst;
    out.parts_sgst_rate = best.sgstRate;
  } else if (out.parts_sgst_rate == null) {
    out.parts_sgst_rate = best.sgstRate;
  }
}
