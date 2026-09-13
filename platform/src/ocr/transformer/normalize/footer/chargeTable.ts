import type { TotalsAndTaxSummary, GstBreakdownLine } from '../../../types/invoice.js';

import { roundMoney } from '../../../../shared/numbers.js';
import {
  parseMoneyToken,
  moneyTokensFromText,
  footerColumnAmounts,
  sideSpecificGstKinds,
  isCgstLine,
  isSgstLine,
  isIgstLine,
  applyGstLine,
  applyHsnSummaryTable,
} from './gst.js';
import { applySpecialDiscountLine } from './discount.js';

/** Parse one table cell as a number, allowing bare integers and 0 (e.g. "0", "3,856.00", "(-)350.00"). */
function parseLooseNumber(s: string): number | null {
  const t = s.replace(/[₹,]/g, '').replace(/\(-\)/g, '-').trim();
  if (t === '' || !/\d/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

/** First gross subtotal row (not the after-tax net row). */
function isGrossSubTotalLine(line: string): boolean {
  if (!/sub\s*total/i.test(line)) return false;
  if (/after\s*discount|net\s*bill/i.test(line)) return false;
  // "Sub Total (Tax Inclusive)" is the grand total, not the pre-tax base — handled separately.
  if (/inclusive/i.test(line)) return false;
  return true;
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

function partsLabourAfterLabel(flat: string, label: RegExp): [number | null, number | null] {
  const m = flat.match(label);
  if (!m || m.index == null) return [null, null];
  return footerColumnAmounts(flat.slice(m.index + m[0].length));
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

    // Standalone "Parts Total" / "Labour Total" / "Parts Net Amt" / "Labour Net Amt" labels.
    if (/\bparts?\s+(?:total|net\s*amt)\b/i.test(line) && !/sub|grand|gst/i.test(line)) {
      const tok = moneyTokensFromText(line);
      if (tok.length && !chargeTable.has('parts')) out.parts_total = tok[tok.length - 1];
      continue;
    }
    if (/\blabou?r\s+(?:total|net\s*amt)\b/i.test(line) && !/sub|grand|gst/i.test(line)) {
      const tok = moneyTokensFromText(line);
      if (tok.length && !chargeTable.has('labour')) out.labour_total = tok[tok.length - 1];
      continue;
    }

    // Combined "Parts Net Amt : 3,509.32    Labour Net Amt : 7,750.00" on one line.
    if (/parts?\s+net\s*amt/i.test(line) && /labou?r\s+net\s*amt/i.test(line)) {
      const pM = line.match(/parts?\s+net\s*amt\s*[:.]\s*([\d,]+\.?\d*)/i);
      const lM = line.match(/labou?r\s+net\s*amt\s*[:.]\s*([\d,]+\.?\d*)/i);
      if (pM && !chargeTable.has('parts')) { const v = parseMoneyToken(pM[1]); if (v != null) out.parts_total = v; }
      if (lM && !chargeTable.has('labour')) { const v = parseMoneyToken(lM[1]); if (v != null) out.labour_total = v; }
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

    // Tally old-battery / scrap credit (negative amount in goods table).
    if (/old\s*battery|battery\s*_?\s*purchase|scrap\s*battery|exchange\s*battery/i.test(line)) {
      const neg = line.replace(/\(-\)/g, '-');
      const nums = moneyTokensFromText(neg);
      const val = nums.find((n) => n > 0) ?? null;
      if (val != null) out.deductibles = roundMoney((out.deductibles ?? 0) + val);
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
  applyHsnSummaryTable(md, out);
  finalizeZeroLabour(out, chargeTable);
  return out;
}
