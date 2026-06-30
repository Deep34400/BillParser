import type { TotalsAndTaxSummary, GstBreakdownLine } from '../parsing/types.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

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

/** Parse one table cell as a number, allowing bare integers and 0 (e.g. "0", "3,856.00", "(-)350.00"). */
function parseLooseNumber(s: string): number | null {
  const t = s.replace(/[₹,]/g, '').replace(/\(-\)/g, '-').trim();
  if (t === '' || !/\d/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? roundMoney(n) : null;
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

/** First gross subtotal row (not the after-tax net row). */
function isGrossSubTotalLine(line: string): boolean {
  if (!/sub\s*total/i.test(line)) return false;
  if (/after\s*discount|net\s*bill/i.test(line)) return false;
  // "Sub Total (Tax Inclusive)" is the grand total, not the pre-tax base — handled separately.
  if (/inclusive/i.test(line)) return false;
  return true;
}

/** @deprecated use footerColumnAmounts */
export function lastTwoAmounts(line: string): [number | null, number | null] {
  return footerColumnAmounts(line);
}

const FOOTER_KEYS: (keyof TotalsAndTaxSummary)[] = [
  'parts_total', 'labour_total', 'parts_discount', 'labour_discount',
  'parts_cgst_rate', 'parts_sgst_rate', 'parts_igst_rate',
  'labour_cgst_rate', 'labour_sgst_rate', 'labour_igst_rate',
  'parts_cgst_amount', 'parts_sgst_amount', 'parts_igst_amount',
  'labour_cgst_amount', 'labour_sgst_amount', 'labour_igst_amount',
  'parts_special_discount', 'labour_special_discount',
  'grand_total_invoice',
];

/** True when OCR markdown lacks the printed Parts|Labour bill summary footer. */
export function footerMissingInMarkdown(md: string): boolean {
  return !/(less\s*discount|cgst\s*@|sub\s*total)/i.test(md);
}

/** Net bill from Gate Pass / G.Total block. */
export function extractGatePassAmount(md: string): number | null {
  const patterns = [
    /\d{2}-[A-Z]{3}-\d{2}\s+([\d,]+\.\d{2})/,
    /Net Bill Amount[^\d]*([\d,]+\.\d{2})/i,
    /Bill Date[^\d]*[\d-]+\s+([\d,]+\.\d{2})/i,
    /\*\*Amount\*\*[\s\S]{0,120}?([\d,]+\.\d{2})/i,
    /G\.?\s*Total[^\d]*([\d,]+\.?\d*)/i,
  ];
  for (const re of patterns) {
    const m = md.match(re);
    if (m) {
      const n = parseMoneyToken(m[1]);
      if (n != null && n > 0) return n;
    }
  }
  return null;
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
 * Output-GST adjustments printed inside the goods table
 * (e.g. Tally "Less : O-CGST (Maharashtra) O-SGST ...") are NOT footer GST lines.
 */
function isGoodsTableGstAdjustment(line: string): boolean {
  return /\bo-?[cs]gst\b/i.test(line) || /^\s*less\s*:/i.test(line);
}

function isCgstLine(line: string): boolean {
  if (isGoodsTableGstAdjustment(line)) return false;
  return /\bcgst\d*\b|central\s*gst/i.test(line);
}

function isSgstLine(line: string): boolean {
  if (isGoodsTableGstAdjustment(line)) return false;
  return /\bsgst\d*\b|state\s*gst/i.test(line);
}

/** "Integrated GST" is just IGST printed in full (Toyota/Tally dealers). */
function isIgstLine(line: string): boolean {
  return /\bigst\d*\b|integrated\s*gst/i.test(line);
}

/** A footer GST line that names its side: "Central/State GST for Parts", "Integrated GST for Lubricants Parts". */
function isSideSpecificGstLine(line: string): boolean {
  return /\b(?:cgst|sgst|igst|central\s*gst|state\s*gst|integrated\s*gst)\s*for\s+[\w\s]*?(?:parts|labou?r|service)\b/i.test(line);
}

/** Which GST kinds appear as authoritative per-side splits — combined lines of those kinds are ignored. */
function sideSpecificGstKinds(md: string): Set<'cgst' | 'sgst' | 'igst'> {
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

/** Per-side charge-table row — re-applied at end so nothing can overwrite gross/discount/GST. */
type ChargeTableRow = { gross: number; discount: number; taxable: number; cgst: number; sgst: number };

function applyChargeTableRows(
  out: Partial<TotalsAndTaxSummary>,
  rows: Partial<Record<'parts' | 'labour', ChargeTableRow>>,
): void {
  for (const side of ['parts', 'labour'] as const) {
    const row = rows[side];
    if (!row) continue;
    out[`${side}_total`] = row.gross;
    // A reconstructed charge row may carry 0 discount while a printed "Less Discount" line
    // gave the real value — keep the larger, real discount instead of overwriting with 0.
    const printedDisc = out[`${side}_discount`] ?? 0;
    out[`${side}_discount`] = row.discount > 0 ? row.discount : (printedDisc > 0 ? printedDisc : row.discount);
    out[`${side}_cgst_amount`] = row.cgst;
    out[`${side}_sgst_amount`] = row.sgst;
    if (row.cgst > 0) {
      out.parts_cgst_rate = out.parts_cgst_rate ?? 9;
      out.parts_sgst_rate = out.parts_sgst_rate ?? 9;
      out.labour_cgst_rate = out.labour_cgst_rate ?? 9;
      out.labour_sgst_rate = out.labour_sgst_rate ?? 9;
    }
  }
}
/**
 * True only when the row's FIRST non-empty cell is exactly the side label.
 * Prevents line-item rows whose Description column says "Labour"/"Parts"
 * (e.g. Autorox body-shop invoices) from being misread as a charge-table row.
 */
function isChargeTableLabelRow(raw: string, side: 'parts' | 'labour'): boolean {
  if (!raw.includes('|')) return false;
  const cells = raw.split('|').map((c) => c.replace(/\*\*/g, '').replace(/[₹:]/g, '').trim());
  const first = cells.find((c) => c.length > 0);
  if (!first) return false;
  const norm = first.toLowerCase();
  return side === 'parts'
    ? norm === 'parts' || norm === 'part'
    : norm === 'labour' || norm === 'labor';
}

/** Toyota/Maruti 5-col row: | Parts | gross | discount | taxable | cgst | sgst | */
function parseChargesTableRow(
  raw: string,
  side: 'parts' | 'labour',
  out: Partial<TotalsAndTaxSummary>,
  chargeTable: Set<'parts' | 'labour'>,
  chargeRows: Partial<Record<'parts' | 'labour', ChargeTableRow>>,
): void {
  if (!isChargeTableLabelRow(raw, side)) return;
  // Read per-cell so bare integers / zeros (e.g. "| Parts | 3856 | 0 | 3856 | 0 | 0 |") are not dropped.
  const cells = raw.split('|').map((c) => c.replace(/\*\*/g, '').replace(/₹/g, '').trim());
  const labelIdx = cells.findIndex((c) => {
    const n = c.toLowerCase();
    return side === 'parts' ? (n === 'parts' || n === 'part') : (n === 'labour' || n === 'labor');
  });
  const tokens = cells.slice(labelIdx + 1).map(parseLooseNumber).filter((n): n is number => n != null);
  if (tokens.length >= 5) {
    const row: ChargeTableRow = {
      gross: tokens[0], discount: tokens[1], taxable: tokens[2],
      cgst: tokens[3], sgst: tokens[4],
    };
    chargeRows[side] = row;
    chargeTable.add(side);
    out[`${side}_total`] = row.gross;
    out[`${side}_discount`] = row.discount;
    out[`${side}_cgst_amount`] = row.cgst;
    out[`${side}_sgst_amount`] = row.sgst;
    if (out.parts_cgst_rate == null && row.cgst > 0) {
      out.parts_cgst_rate = 9;
      out.parts_sgst_rate = 9;
      out.labour_cgst_rate = 9;
      out.labour_sgst_rate = 9;
    }
  } else if (tokens.length >= 1 && tokens.every((n) => n === 0)) {
    chargeRows[side] = { gross: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0 };
    chargeTable.add(side);
    out[`${side}_total`] = 0;
    out[`${side}_discount`] = 0;
    out[`${side}_cgst_amount`] = 0;
    out[`${side}_sgst_amount`] = 0;
  }
}

/** Gemini supplement block — only fills fields not already set from charge table. */
function extractStructuredBillSummary(
  md: string,
  out: Partial<TotalsAndTaxSummary>,
  chargeTable: Set<'parts' | 'labour'>,
): void {
  const partsBlock = md.match(/(?:^|\n)Parts:\s*[\s\S]*?(?=(?:^|\n)(?:Labour:|Total:)|$)/im)?.[0] ?? '';
  const labourBlock = md.match(/(?:^|\n)Labour:\s*[\s\S]*?(?=(?:^|\n)(?:Parts:|Total:)|$)/im)?.[0] ?? '';

  const readField = (block: string, labels: string[]): number | null => {
    for (const label of labels) {
      const m = block.match(new RegExp(`${label}\\s*:\\s*([\\d,.]+)`, 'i'));
      if (m) {
        const n = parseMoneyToken(m[1]);
        if (n != null) return n;
      }
    }
    return null;
  };

  const pTotal = readField(partsBlock, ['Parts', 'Charges']);
  const pDisc = readField(partsBlock, ['Discount']);
  const pCgst = readField(partsBlock, ['CGST']);
  const pSgst = readField(partsBlock, ['SGST']);
  if (pTotal != null && !chargeTable.has('parts')) out.parts_total = pTotal;
  if (pDisc != null && !chargeTable.has('parts')) out.parts_discount = pDisc;
  if (pCgst != null && !chargeTable.has('parts')) out.parts_cgst_amount = pCgst;
  if (pSgst != null && !chargeTable.has('parts')) out.parts_sgst_amount = pSgst;

  const lTotal = readField(labourBlock, ['Labour', 'Charges']);
  const lDisc = readField(labourBlock, ['Discount']);
  const lCgst = readField(labourBlock, ['CGST']);
  const lSgst = readField(labourBlock, ['SGST']);
  if (lTotal != null && !chargeTable.has('labour')) out.labour_total = lTotal;
  if (lDisc != null && !chargeTable.has('labour')) out.labour_discount = lDisc;
  if (lCgst != null && !chargeTable.has('labour')) out.labour_cgst_amount = lCgst;
  if (lSgst != null && !chargeTable.has('labour')) out.labour_sgst_amount = lSgst;
}

function finalizeZeroLabour(out: Partial<TotalsAndTaxSummary>, chargeTable: Set<'parts' | 'labour'>): void {
  if (chargeTable.has('labour')) return;
  const labourHasActivity = (out.labour_total ?? 0) > 0
    || (out.labour_discount ?? 0) > 0
    || (out.labour_cgst_amount ?? 0) > 0;
  if (out.parts_total != null && !labourHasActivity) {
    out.labour_total = 0;
    out.labour_discount = out.labour_discount ?? 0;
    out.labour_cgst_amount = out.labour_cgst_amount ?? 0;
    out.labour_sgst_amount = out.labour_sgst_amount ?? 0;
  }
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

function applySpecialDiscountLine(out: Partial<TotalsAndTaxSummary>, line: string): void {
  const tokens = moneyTokensFromText(line);
  if (!tokens.length) return;
  const [p, l] = footerColumnAmounts(line);
  if (p != null && l != null) {
    if (p > 0) out.parts_special_discount = roundMoney((out.parts_special_discount ?? 0) + p);
    if (l > 0) out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + l);
    return;
  }
  if (tokens.length >= 3) {
    if (tokens[0] > 0) out.parts_special_discount = roundMoney((out.parts_special_discount ?? 0) + tokens[0]);
    if (tokens[tokens.length - 1] > 0) {
      out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + tokens[tokens.length - 1]);
    }
    return;
  }
  if (tokens.length === 2) {
    out.parts_special_discount = roundMoney((out.parts_special_discount ?? 0) + tokens[0]);
    out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + tokens[1]);
    return;
  }
  // Single amount in 3-column (Parts | 0 | Labour) footer → labour column
  out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + tokens[0]);
}

function applyGstLine(
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

/** First "Sub Total Amount" row only — second row on Sai/Popular is after-discount&tax column net. */
function applyGrossSubTotalLine(
  out: Partial<TotalsAndTaxSummary>,
  line: string,
  subTotalHits: number,
  chargeTable: Set<'parts' | 'labour'>,
): void {
  if (subTotalHits !== 1) return;
  const [p, l] = footerColumnAmounts(line);
  if (p != null && l != null) {
    if (!chargeTable.has('parts')) out.parts_total = p;
    if (!chargeTable.has('labour')) out.labour_total = l;
  } else if (p != null && chargeTable.size === 0) {
    out.parts_total = p;
    out.labour_total = 0;
  }
}

/** Extract Parts/Labour footer from OCR markdown. */
export function extractSummaryFromMarkdown(md: string): Partial<TotalsAndTaxSummary> {
  const out: Partial<TotalsAndTaxSummary> = {};
  const chargeTable = new Set<'parts' | 'labour'>();
  const chargeRows: Partial<Record<'parts' | 'labour', ChargeTableRow>> = {};
  const gstBreakdown: GstBreakdownLine[] = [];
  const splitKinds = sideSpecificGstKinds(md);
  const lines = md.split(/\r?\n/);
  // Toyota/Tally bills repeat the GST lines verbatim (body + "## Bill Summary"); apply each once.
  const seenGstLines = new Set<string>();
  // De-dupe by parsed value too, since the same total can be printed with different text.
  const seenGstValues = new Set<string>();
  // Zoho-style single-column bills print the real pre-tax base as a standalone "Taxable Amount"
  // line (the "Sub Total"/"SUBTOTAL" row is a tax-inclusive total or a qty·rate line). Captured
  // only when the line carries exactly one money token, so the parts-table column HEADER
  // ("… | Taxable Amount | Tax Paid Amount | …", zero tokens) is never mistaken for it.
  let taxableSubtotal: number | null = null;
  let subTotalHits = 0;

  for (const raw of lines) {
    parseChargesTableRow(raw, 'parts', out, chargeTable, chargeRows);
    parseChargesTableRow(raw, 'labour', out, chargeTable, chargeRows);

    const line = raw.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || !/\d/.test(line)) continue;

    // Side-qualified single-value subtotals: "Sub Total Amount (parts): 0.00" / "(labour): 4,400.00"
    const subQual = /sub\s*total[^()]*\((parts?|labou?r)\)/i.exec(line);
    if (subQual) {
      const tok = moneyTokensFromText(line);
      const val = tok.length ? tok[tok.length - 1] : null;
      if (val != null) {
        if (/part/i.test(subQual[1])) { if (!chargeTable.has('parts')) out.parts_total = val; }
        else if (!chargeTable.has('labour')) out.labour_total = val;
      }
      continue;
    }

    // Standalone "Parts Total" / "Labour Total" labels (Autorox-style), single value.
    if (/\bparts?\s+total\b/i.test(line) && !/sub|grand|gst/i.test(line)) {
      const tok = moneyTokensFromText(line);
      if (tok.length && !chargeTable.has('parts')) out.parts_total = tok[tok.length - 1];
      continue;
    }
    if (/\blabou?r\s+total\b/i.test(line) && !/sub|grand|gst/i.test(line)) {
      const tok = moneyTokensFromText(line);
      if (tok.length && !chargeTable.has('labour')) out.labour_total = tok[tok.length - 1];
      continue;
    }

    if (/taxable\s*amount/i.test(line) && !/sub\s*total/i.test(line)) {
      const tok = moneyTokensFromText(line);
      if (tok.length === 1) taxableSubtotal = tok[0];
      continue;
    }

    if (isGrossSubTotalLine(line)) {
      subTotalHits += 1;
      applyGrossSubTotalLine(out, line, subTotalHits, chargeTable);
      continue;
    }

    if (/special\s*discount/i.test(line)) {
      applySpecialDiscountLine(out, line);
      continue;
    }

    if (/less\s*discount|discount\s*on\s*parts/i.test(line)) {
      const [p, l] = footerColumnAmounts(line);
      if (p != null && l != null) {
        if (!chargeTable.has('parts')) out.parts_discount = p;
        if (!chargeTable.has('labour')) out.labour_discount = l;
      } else if (p != null && chargeTable.size === 0) {
        out.parts_discount = p;
        out.labour_discount = 0;
      } else if (p != null && p > 0) {
        // Combined single discount value alongside a charge table. Only apply the EXCESS over
        // what the charge table already captured (e.g. a festival discount the charge row missed),
        // assigning it to the side that currently has zero discount. If the printed total already
        // matches the charge-table discounts, do nothing.
        const existingTotal = roundMoney((out.parts_discount ?? 0) + (out.labour_discount ?? 0));
        if (p > existingTotal + 0.01) {
          const remainder = roundMoney(p - existingTotal);
          const side = (out.parts_discount ?? 0) === 0 ? 'parts' : 'labour';
          out[`${side}_discount`] = roundMoney((out[`${side}_discount`] ?? 0) + remainder);
        }
      }
      continue;
    }

    const isGst = isCgstLine(line) || isSgstLine(line) || isIgstLine(line);
    if (isGst) {
      const sig = line.toLowerCase().replace(/[^a-z0-9.]/g, '');
      if (seenGstLines.has(sig)) continue;
      seenGstLines.add(sig);
    }

    if (isCgstLine(line)) {
      applyGstLine(out, 'cgst', line, chargeTable, gstBreakdown, splitKinds, seenGstValues);
      continue;
    }

    if (isSgstLine(line)) {
      applyGstLine(out, 'sgst', line, chargeTable, gstBreakdown, splitKinds, seenGstValues);
      continue;
    }

    if (isIgstLine(line)) {
      applyGstLine(out, 'igst', line, chargeTable, gstBreakdown, splitKinds, seenGstValues);
      continue;
    }

    if (/net\s*bill\s*amount|g\.?\s*total/i.test(line)) {
      const nums = moneyTokensFromText(line);
      if (nums.length) out.grand_total_invoice = nums[nums.length - 1];
    }
  }

  extractStructuredBillSummary(md, out, chargeTable);

  const flat = md.replace(/\|/g, ' ');
  if ((out.parts_total == null || out.labour_total == null) && chargeTable.size === 0) {
    const [p, l] = partsLabourAfterLabel(flat, /Sub\s*Total\s*(?:Amount)?\s*:/i);
    if (p != null && out.parts_total == null) out.parts_total = p;
    if (l != null && out.labour_total == null) out.labour_total = l;
    else if (p != null && out.labour_total == null) out.labour_total = 0;
  }
  if ((out.parts_discount == null || out.labour_discount == null) && chargeTable.size === 0) {
    const [p, l] = partsLabourAfterLabel(flat, /Less\s*Discount/i);
    if (p != null && out.parts_discount == null) out.parts_discount = p;
    if (l != null && out.labour_discount == null) out.labour_discount = l;
    else if (p != null && out.labour_discount == null) out.labour_discount = 0;
  }
  if (out.parts_cgst_amount == null && chargeTable.size === 0 && gstBreakdown.length === 0) {
    const m = flat.match(/(?:Central\s*)?CGST\s*@?\s*(\d+(?:\.\d+)?)\s*(?:%[^\d]*)?\s*([\d,.]+)(?:\s+([\d,.]+))?/i);
    if (m) {
      out.parts_cgst_rate = parseFloat(m[1]);
      out.labour_cgst_rate = parseFloat(m[1]);
      out.parts_cgst_amount = parseMoneyToken(m[2]) ?? undefined;
      out.labour_cgst_amount = m[3] ? (parseMoneyToken(m[3]) ?? undefined) : 0;
    }
  }
  if (out.parts_sgst_amount == null && chargeTable.size === 0 && gstBreakdown.length === 0) {
    const m = flat.match(/(?:State\s*)?SGST\s*@?\s*(\d+(?:\.\d+)?)\s*(?:%[^\d]*)?\s*([\d,.]+)(?:\s+([\d,.]+))?/i);
    if (m) {
      out.parts_sgst_rate = parseFloat(m[1]);
      out.labour_sgst_rate = parseFloat(m[1]);
      out.parts_sgst_amount = parseMoneyToken(m[2]) ?? undefined;
      out.labour_sgst_amount = m[3] ? (parseMoneyToken(m[3]) ?? undefined) : 0;
    }
  }
  if (out.grand_total_invoice == null) {
    const m = flat.match(/Net Bill Amount[^\d]*([\d,.]+)/i);
    if (m) out.grand_total_invoice = parseMoneyToken(m[1]) ?? undefined;
  }
  if (out.grand_total_invoice == null) {
    const gp = extractGatePassAmount(md);
    if (gp != null) out.grand_total_invoice = gp;
  }

  // Zoho-style single-column override: a standalone "Taxable Amount" line is the authoritative
  // pre-tax base. Only when there is no per-side charge table or GST split (so two-column dealer
  // footers — which only ever carry "Taxable Amount" as a column header — are never touched).
  if (taxableSubtotal != null && chargeTable.size === 0 && splitKinds.size === 0) {
    out.parts_total = taxableSubtotal;
    out.labour_total = 0;
  }

  // A combined GST total ("IGST Total : 279.00") is parked on Parts by default, but the footer may
  // print the Parts/Labour subtotals AFTER it — so the single-column guess can be wrong. Now that
  // the subtotals are known, move any GST sitting on a zero-subtotal side to the side that actually
  // carries the base (otherwise reconcileSideGst would later drop it as "GST on a zero side").
  const moveGstToBaseSide = (from: 'parts' | 'labour', to: 'parts' | 'labour') => {
    for (const kind of ['cgst', 'sgst', 'igst'] as const) {
      const fa = `${from}_${kind}_amount` as const;
      const ta = `${to}_${kind}_amount` as const;
      const fr = `${from}_${kind}_rate` as const;
      const tr = `${to}_${kind}_rate` as const;
      // Only relocate when the base side has no GST of this kind — a genuinely misplaced combined
      // total, not noise (e.g. a rounding token) duplicating GST the base side already carries.
      if ((out[fa] ?? 0) > 0 && (out[ta] ?? 0) === 0) {
        out[ta] = out[fa];
        out[fa] = 0;
        if (out[fr] != null && out[tr] == null) out[tr] = out[fr];
        out[fr] = undefined;
      }
    }
    for (const e of gstBreakdown) {
      const fv = e[from] ?? 0;
      if (fv > 0 && !(e[to] ?? 0)) { e[to] = fv; e[from] = undefined; }
    }
  };
  if ((out.parts_total ?? null) === 0 && (out.labour_total ?? 0) > 0) moveGstToBaseSide('parts', 'labour');
  else if ((out.labour_total ?? null) === 0 && (out.parts_total ?? 0) > 0) moveGstToBaseSide('labour', 'parts');

  // Charge table is highest authority — always wins over combined supplement lines.
  applyChargeTableRows(out, chargeRows);
  if (gstBreakdown.length) out.gst_breakdown = gstBreakdown;
  finalizeZeroLabour(out, chargeTable);
  return out;
}

/**
 * When the summary footer was never OCR'd, the LLM's "0" discounts and computed GST amounts cannot
 * be trusted (there is no printed evidence to confirm them) — drop them so they show as unknown
 * rather than wrong. No-op when a footer is present, so footer-backed bills are unaffected.
 */
export function clearUntrustedZeroDiscounts(t: TotalsAndTaxSummary, markdown: string): void {
  if (!footerMissingInMarkdown(markdown)) return;
  if (t.parts_discount === 0) delete t.parts_discount;
  if (t.labour_discount === 0) delete t.labour_discount;
  for (const k of ['parts_cgst_amount', 'parts_sgst_amount', 'parts_igst_amount',
    'labour_cgst_amount', 'labour_sgst_amount', 'labour_igst_amount'] as const) {
    delete t[k];
  }
}

/** OCR footer wins over LLM — strips calculated GST, then applies printed footer values. */
export function applyFooterFromMarkdown(t: TotalsAndTaxSummary, markdown: string): TotalsAndTaxSummary {
  const out = { ...t };
  stripCalculatedFooterAmounts(out);
  clearUntrustedZeroDiscounts(out, markdown);
  const fromMd = extractSummaryFromMarkdown(markdown);
  for (const k of FOOTER_KEYS) {
    const v = fromMd[k];
    if (typeof v === 'number') out[k] = v as never;
  }
  if (fromMd.gst_breakdown?.length) out.gst_breakdown = fromMd.gst_breakdown;
  const gp = extractGatePassAmount(markdown);
  if (gp != null && (out.grand_total_invoice == null || Math.abs(out.grand_total_invoice - gp) > 1)) {
    out.grand_total_invoice = gp;
  }
  stripCalculatedFooterAmounts(out);
  return out;
}

export { FOOTER_KEYS };

function partsLabourAfterLabel(flat: string, label: RegExp): [number | null, number | null] {
  const m = flat.match(label);
  if (!m || m.index == null) return [null, null];
  return footerColumnAmounts(flat.slice(m.index + m[0].length));
}
