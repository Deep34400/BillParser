import type { ParsedInvoiceData, TotalsAndTaxSummary, GstBreakdownLine } from '../types/index.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseMoneyToken(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, '').trim());
  return Number.isFinite(n) ? roundMoney(n) : null;
}

function moneyTokensFromText(text: string): number[] {
  // Bare-integer branch is guarded with letter look-arounds so digit runs embedded in alphanumeric
  // IDs (e.g. the "4998" in a GSTIN "36AABCS4998M1ZK") are never mistaken for an amount.
  return [...text.matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|(?<![A-Za-z])\d{4,}(?:\.\d{1,2})?(?![A-Za-z]))/g)]
    .map((m) => parseMoneyToken(m[1]))
    .filter((n): n is number => n != null);
}

function parseLooseNumber(s: string): number | null {
  const t = s.replace(/[₹,]/g, '').replace(/\(-\)/g, '-').trim();
  if (t === '' || !/\d/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

export function footerColumnAmounts(line: string): [number | null, number | null] {
  const tokens = moneyTokensFromText(line);
  if (tokens.length >= 3) return [tokens[0], tokens[tokens.length - 1]];
  if (tokens.length >= 2) return [tokens[tokens.length - 2], tokens[tokens.length - 1]];
  if (tokens.length === 1) return [tokens[0], null];
  return [null, null];
}

function stripGstLabel(line: string, kind: 'cgst' | 'sgst' | 'igst'): { rate: number | null; rest: string } {
  const rateM = line.match(new RegExp(`\\b${kind}\\b\\s*@?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:%|(?=\\s|:|$))`, 'i'));
  const rate = rateM ? parseFloat(rateM[1]) : null;
  const rest = rateM ? line.replace(rateM[0], ' ') : line.replace(new RegExp(`\\b${kind}\\b[^\\d]*`, 'i'), ' ');
  return { rate, rest };
}

function isGrossSubTotalLine(line: string): boolean {
  if (!/sub\s*total/i.test(line)) return false;
  if (/after\s*discount|net\s*bill/i.test(line)) return false;
  // "Sub Total (Tax Inclusive)" is the grand total, not the pre-tax base — handled separately.
  if (/inclusive/i.test(line)) return false;
  return true;
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

function partsLabourAfterLabel(flat: string, label: RegExp): [number | null, number | null] {
  const m = flat.match(label);
  if (!m || m.index == null) return [null, null];
  return footerColumnAmounts(flat.slice(m.index + m[0].length));
}

export function footerMissingInMarkdown(md: string): boolean {
  return !/(less\s*discount|cgst\s*@|sub\s*total)/i.test(md);
}

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

export function isCalculatedGstAmount(
  subtotal: number | null | undefined,
  rate: number | null | undefined,
  amount: number | null | undefined,
): boolean {
  if (subtotal == null || amount == null) return false;
  const r = rate ?? 9;
  return Math.abs(amount - roundMoney(subtotal * r / 100)) < 0.1;
}

export function clearUntrustedZeroDiscounts(t: TotalsAndTaxSummary, markdown: string): void {
  if (!footerMissingInMarkdown(markdown)) return;
  if (t.parts_discount === 0) delete t.parts_discount;
  if (t.labour_discount === 0) delete t.labour_discount;
}

export function stripCalculatedFooterAmounts(t: TotalsAndTaxSummary): void {
  const bd = t.gst_breakdown;
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
    const grossGst = roundMoney(sub * rate / 100);
    const cgst = side === 'parts' ? t.parts_cgst_amount : t.labour_cgst_amount;
    const sgst = side === 'parts' ? t.parts_sgst_amount : t.labour_sgst_amount;
    const matchesAfterDisc = (a: number | null | undefined) => a != null && Math.abs(a - expectedGst) < 0.15;
    const matchesGrossOnly = (a: number | null | undefined) =>
      a != null && Math.abs(a - grossGst) < 0.15 && !matchesAfterDisc(a);
    if (matchesGrossOnly(cgst) || matchesGrossOnly(sgst)) {
      if (side === 'parts') { delete t.parts_cgst_amount; delete t.parts_sgst_amount; }
      else { delete t.labour_cgst_amount; delete t.labour_sgst_amount; }
    }
  }
}

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

function isIgstLine(line: string): boolean {
  return /\bigst\d*\b|integrated\s*gst/i.test(line);
}

function isSideSpecificGstLine(line: string): boolean {
  return /\b(?:cgst|sgst|igst|central\s*gst|state\s*gst|integrated\s*gst)\s*for\s+[\w\s]*?(?:parts|labou?r|service)\b/i.test(line);
}

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

function parseSideSpecificGstLine(line: string) {
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

function parseGstLine(line: string, kind: 'cgst' | 'sgst' | 'igst') {
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

type ChargeTableRow = { gross: number; discount: number; taxable: number; cgst: number; sgst: number };

function applyChargeTableRows(
  out: Partial<TotalsAndTaxSummary>,
  rows: Partial<Record<'parts' | 'labour', ChargeTableRow>>,
): void {
  for (const side of ['parts', 'labour'] as const) {
    const row = rows[side];
    if (!row) continue;
    out[`${side}_total`] = row.gross;
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

function parseChargesTableRow(
  raw: string,
  side: 'parts' | 'labour',
  out: Partial<TotalsAndTaxSummary>,
  chargeTable: Set<'parts' | 'labour'>,
  chargeRows: Partial<Record<'parts' | 'labour', ChargeTableRow>>,
): void {
  if (!isChargeTableLabelRow(raw, side)) return;
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

function extractStructuredBillSummary(
  md: string,
  out: Partial<TotalsAndTaxSummary>,
  chargeTable: Set<'parts' | 'labour'>,
): void {
  const partsBlock = md.match(/(?:^|\n)Parts:\s*[\s\S]*?(?=(?:^|\n)(?:Labour:|Total:)|$)/im)?.[0] ?? '';
  const labourBlock = md.match(/(?:^|\n)Labour:\s*[\s\S]*?(?=(?:^|\n)(?:Parts:|Total:)|$)/im)?.[0] ?? '';
  const readField = (block: string, labels: string[]) => {
    for (const label of labels) {
      const m = block.match(new RegExp(`${label}\\s*:\\s*([\\d,.]+)`, 'i'));
      if (m) { const n = parseMoneyToken(m[1]); if (n != null) return n; }
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
  const labourHasActivity = (out.labour_total ?? 0) > 0 || (out.labour_discount ?? 0) > 0 || (out.labour_cgst_amount ?? 0) > 0;
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
  if (!sideSpecific && (chargeTable.size > 0 || splitKinds.has(kind))) return;
  const parsed = parseGstLine(line, kind);
  const rate = parsed.rate;
  let parts = parsed.parts;
  let labour = parsed.labour;

  if (!sideSpecific && parts != null && parts > 0 && (labour == null || labour === 0)
    && (out.parts_total ?? null) === 0 && (out.labour_total ?? 0) > 0) {
    labour = parts;
    parts = null;
  }

  const kindUpper = kind.toUpperCase() as GstBreakdownLine['kind'];
  if ((parts ?? 0) > 0 || (labour ?? 0) > 0) {
    const existing = gstBreakdown.find((e) => e.kind === kindUpper && (e.rate ?? null) === (rate ?? null));
    if (existing) {
      if (parts != null && parts > 0) existing.parts = parts;
      if (labour != null && labour > 0) existing.labour = labour;
    } else {
      gstBreakdown.push({ kind: kindUpper, rate, parts: parts ?? undefined, labour: labour ?? undefined });
    }
  }
  // The same printed GST total can appear on more than one OCR line with different surrounding
  // text. Apply each (kind, rate, side, amount) only once so a single tax is never doubled.
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

export function extractSummaryFromMarkdown(md: string): Partial<TotalsAndTaxSummary> {
  const out: Partial<TotalsAndTaxSummary> = {};
  const chargeTable = new Set<'parts' | 'labour'>();
  const chargeRows: Partial<Record<'parts' | 'labour', ChargeTableRow>> = {};
  const gstBreakdown: GstBreakdownLine[] = [];
  const splitKinds = sideSpecificGstKinds(md);
  const lines = md.split(/\r?\n/);
  const seenGstLines = new Set<string>();
  const seenGstValues = new Set<string>();
  // Zoho-style single-column "Taxable Amount" base (see API mirror for the full rationale).
  let taxableSubtotal: number | null = null;
  let subTotalHits = 0;

  for (const raw of lines) {
    parseChargesTableRow(raw, 'parts', out, chargeTable, chargeRows);
    parseChargesTableRow(raw, 'labour', out, chargeTable, chargeRows);
    const line = raw.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || !/\d/.test(line)) continue;

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
        const existingTotal = roundMoney((out.parts_discount ?? 0) + (out.labour_discount ?? 0));
        if (p > existingTotal + 0.01) {
          const remainder = roundMoney(p - existingTotal);
          const side = (out.parts_discount ?? 0) === 0 ? 'parts' : 'labour';
          out[`${side}_discount`] = roundMoney((out[`${side}_discount`] ?? 0) + remainder);
        }
      }
      continue;
    }

    if (isCgstLine(line) || isSgstLine(line) || isIgstLine(line)) {
      const sig = line.toLowerCase().replace(/[^a-z0-9.]/g, '');
      if (seenGstLines.has(sig)) continue;
      seenGstLines.add(sig);
    }
    if (isCgstLine(line)) { applyGstLine(out, 'cgst', line, chargeTable, gstBreakdown, splitKinds, seenGstValues); continue; }
    if (isSgstLine(line)) { applyGstLine(out, 'sgst', line, chargeTable, gstBreakdown, splitKinds, seenGstValues); continue; }
    if (isIgstLine(line)) { applyGstLine(out, 'igst', line, chargeTable, gstBreakdown, splitKinds, seenGstValues); continue; }

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
  // pre-tax base. Only when there is no per-side charge table or GST split.
  if (taxableSubtotal != null && chargeTable.size === 0 && splitKinds.size === 0) {
    out.parts_total = taxableSubtotal;
    out.labour_total = 0;
  }

  // Move a combined GST parked on a zero-subtotal side to the side that carries the base — mirrors
  // api/src/schema/footerExtract.ts (handles "IGST Total" printed before Parts/Labour subtotals).
  const moveGstToBaseSide = (from: 'parts' | 'labour', to: 'parts' | 'labour') => {
    for (const kind of ['cgst', 'sgst', 'igst'] as const) {
      const fa = `${from}_${kind}_amount` as const;
      const ta = `${to}_${kind}_amount` as const;
      const fr = `${from}_${kind}_rate` as const;
      const tr = `${to}_${kind}_rate` as const;
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

  finalizeZeroLabour(out, chargeTable);
  applyChargeTableRows(out, chargeRows);
  if (gstBreakdown.length) out.gst_breakdown = gstBreakdown;
  return out;
}

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

function sumParts(data: ParsedInvoiceData): number | null {
  const items = data.parts_line_items ?? [];
  if (!items.length) return null;
  return roundMoney(items.reduce((a, p) => a + (p.taxable_amount ?? 0), 0));
}

function sumLabour(data: ParsedInvoiceData): number | null {
  const items = data.labour_service_line_items ?? [];
  if (!items.length) return null;
  return roundMoney(items.reduce((a, l) => a + (l.labour_charges ?? 0), 0));
}

function coalesceColumnTotal(stored: number | null | undefined, lineSum: number | null): number | undefined {
  if (stored != null && stored > 0) return stored;
  if (lineSum != null && lineSum > 0) return lineSum;
  if (stored === 0) return 0;
  return stored ?? undefined;
}

function coalesceDiscount(stored: number | null | undefined, _otherSide: number | null | undefined): number | undefined {
  if (stored != null && stored >= 0) return stored;
  return stored ?? undefined;
}

function inferGstRates(t: TotalsAndTaxSummary, data: ParsedInvoiceData): void {
  const full = (items: { tax_percentage?: number | null }[]) =>
    items.find((i) => i.tax_percentage != null && i.tax_percentage > 0)?.tax_percentage ?? null;
  const pFull = full(data.parts_line_items ?? []);
  const lFull = full(data.labour_service_line_items ?? []);
  const half = (f: number | null) => (f != null ? f / 2 : null);
  const pHalf = half(pFull);
  const lHalf = half(lFull);
  if (t.parts_cgst_rate == null && pHalf != null) { t.parts_cgst_rate = pHalf; t.parts_sgst_rate = pHalf; }
  if (t.labour_cgst_rate == null && lHalf != null) { t.labour_cgst_rate = lHalf; t.labour_sgst_rate = lHalf; }
  // Inter-state: IGST = full GST rate. Infer when an IGST amount is charged but the rate is missing.
  if (t.parts_igst_rate == null && (t.parts_igst_amount ?? 0) > 0 && pFull != null) t.parts_igst_rate = pFull;
  if (t.labour_igst_rate == null && (t.labour_igst_amount ?? 0) > 0 && lFull != null) t.labour_igst_rate = lFull;
}

function reconcileSideGst(t: TotalsAndTaxSummary): void {
  for (const side of ['parts', 'labour'] as const) {
    if (t[`${side}_total`] === 0) {
      t[`${side}_cgst_amount`] = 0; t[`${side}_sgst_amount`] = 0; t[`${side}_igst_amount`] = 0;
      t[`${side}_cgst_rate`] = null; t[`${side}_sgst_rate`] = null; t[`${side}_igst_rate`] = null;
    } else if ((t[`${side}_igst_amount`] ?? 0) > 0) {
      t[`${side}_cgst_amount`] = null; t[`${side}_sgst_amount`] = null;
      t[`${side}_cgst_rate`] = null; t[`${side}_sgst_rate`] = null;
    }
  }
}

const SIDE_FIELDS = [
  '_total', '_discount', '_special_discount',
  '_cgst_amount', '_sgst_amount', '_igst_amount',
  '_cgst_rate', '_sgst_rate', '_igst_rate',
] as const;

function clearSide(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): void {
  t[`${side}_total`] = 0;
  t[`${side}_discount`] = 0; t[`${side}_special_discount`] = 0;
  t[`${side}_cgst_amount`] = 0; t[`${side}_sgst_amount`] = 0; t[`${side}_igst_amount`] = 0;
  t[`${side}_cgst_rate`] = null; t[`${side}_sgst_rate`] = null; t[`${side}_igst_rate`] = null;
}

function swapSides(t: TotalsAndTaxSummary): void {
  for (const f of SIDE_FIELDS) {
    const pk = `parts${f}` as keyof TotalsAndTaxSummary;
    const lk = `labour${f}` as keyof TotalsAndTaxSummary;
    const tmp = t[pk]; (t[pk] as unknown) = t[lk]; (t[lk] as unknown) = tmp;
  }
  if (Array.isArray(t.gst_breakdown)) {
    for (const e of t.gst_breakdown) { const tmp = e.parts; e.parts = e.labour; e.labour = tmp; }
  }
}

function hasPartsItems(data: ParsedInvoiceData): boolean {
  return (data.parts_line_items ?? []).some((p) => (p.taxable_amount ?? 0) > 0 || (p.quantity != null && p.rate != null));
}

function hasLabourItems(data: ParsedInvoiceData): boolean {
  return (data.labour_service_line_items ?? []).some((l) => (l.labour_charges ?? 0) > 0);
}

/** Single-column consolidation (drop duplicate + relocate to the line-item side) — mirrors API. */
function dedupeSingleColumnDuplicate(
  t: TotalsAndTaxSummary,
  data: ParsedInvoiceData,
  footerParts: number | null | undefined,
  footerLabour: number | null | undefined,
): void {
  const grand = t.grand_total_invoice;
  if (grand == null) return;
  const reconciles = (n: number | null) => n != null && Math.abs(n - grand) <= 1;
  if (footerLabour === 0 && (t.labour_total ?? 0) > 0 && reconciles(columnNet(t, 'parts'))) {
    clearSide(t, 'labour');
    if (hasLabourItems(data) && !hasPartsItems(data)) swapSides(t);
  } else if (footerParts === 0 && (t.parts_total ?? 0) > 0 && reconciles(columnNet(t, 'labour'))) {
    clearSide(t, 'parts');
    if (hasPartsItems(data) && !hasLabourItems(data)) swapSides(t);
  }
}

export function columnNet(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): number | null {
  const sub = side === 'parts' ? t.parts_total : t.labour_total;
  if (sub == null) return null;
  const disc = side === 'parts'
    ? (t.parts_discount ?? 0) + (t.parts_special_discount ?? 0)
    : (t.labour_discount ?? 0) + (t.labour_special_discount ?? 0);
  const cgst = side === 'parts' ? (t.parts_cgst_amount ?? 0) : (t.labour_cgst_amount ?? 0);
  const sgst = side === 'parts' ? (t.parts_sgst_amount ?? 0) : (t.labour_sgst_amount ?? 0);
  const igst = side === 'parts' ? (t.parts_igst_amount ?? 0) : (t.labour_igst_amount ?? 0);
  return roundMoney(sub - disc + cgst + sgst + igst);
}

/** Single bill-summary pipeline — mirrors api/src/schema/billSummary.ts */
export function resolveBillSummary(data: ParsedInvoiceData, markdown?: string | null): TotalsAndTaxSummary {
  let t: TotalsAndTaxSummary = { ...(data.totals_and_tax_summary ?? {}) };

  if (markdown) {
    t = applyFooterFromMarkdown(t, markdown);
  }

  const footerParts = markdown ? t.parts_total : undefined;
  const footerLabour = markdown ? t.labour_total : undefined;

  t.parts_total = coalesceColumnTotal(t.parts_total, sumParts(data));
  t.labour_total = coalesceColumnTotal(t.labour_total, sumLabour(data));

  t.parts_discount = coalesceDiscount(t.parts_discount, t.labour_discount);
  t.labour_discount = coalesceDiscount(t.labour_discount, t.parts_discount);

  inferGstRates(t, data);
  reconcileSideGst(t);
  stripCalculatedFooterAmounts(t);
  dedupeSingleColumnDuplicate(t, data, footerParts, footerLabour);

  const gp = markdown ? extractGatePassAmount(markdown) : null;
  if (gp != null && (t.grand_total_invoice == null || Math.abs(t.grand_total_invoice - gp) > 1)) {
    t.grand_total_invoice = gp;
  }

  return t;
}

function alignPartsTaxableToGross(data: ParsedInvoiceData, partsTotal?: number | null): ParsedInvoiceData {
  if (partsTotal == null || partsTotal <= 0) return data;
  const parts = data.parts_line_items ?? [];
  if (!parts.length) return data;
  const grossSum = roundMoney(parts.reduce((a, p) => {
    if (p.quantity != null && p.rate != null) return a + roundMoney(p.quantity * p.rate);
    return a + (p.taxable_amount ?? 0);
  }, 0));
  if (Math.abs(grossSum - partsTotal) > 2) return data;
  return {
    ...data,
    parts_line_items: parts.map((p) => (
      p.quantity != null && p.rate != null
        ? { ...p, taxable_amount: roundMoney(p.quantity * p.rate) }
        : p
    )),
  };
}

function alignLabourChargesToGross(
  items: ParsedInvoiceData['labour_service_line_items'],
  labourTotal?: number | null,
  labourDiscount?: number | null,
) {
  if (!items?.length || labourTotal == null || labourTotal <= 0 || items.length !== 1) return items ?? [];
  const li = items[0];
  const charges = li.labour_charges;
  if (charges == null) return [{ ...li, labour_charges: labourTotal }];
  const disc = labourDiscount ?? 0;
  if (Math.abs(charges + disc - labourTotal) < 2) {
    return [{ ...li, labour_charges: labourTotal }];
  }
  return items;
}

export function enrichInvoiceSummary(data: ParsedInvoiceData, markdown?: string | null): ParsedInvoiceData {
  const summary = resolveBillSummary(data, markdown);
  const withParts = alignPartsTaxableToGross(data, summary.parts_total);
  const labour = alignLabourChargesToGross(
    withParts.labour_service_line_items,
    summary.labour_total,
    summary.labour_discount,
  );
  const enriched = { ...withParts, labour_service_line_items: labour };
  return { ...enriched, totals_and_tax_summary: resolveBillSummary(enriched, markdown) };
}
