import type { ParsedInvoiceData } from '../../shared/types.js';
import type { CompareResult, FieldDiff, LineDiff } from './types.js';
import {
  applyAiPairs,
  leftoversToDiffs,
  matchNamedLines,
  toLabourLine,
  toPartLine,
} from './matchLines.js';
import { summarizeDiff } from './summarize.js';

function scalar(field: string, a: string | number | null | undefined, b: string | number | null | undefined): FieldDiff {
  const left = a ?? null;
  const right = b ?? null;
  if (left == null && right == null) {
    return { field, a: null, b: null, status: 'match' };
  }
  if (left == null) return { field, a: null, b: right, status: 'missing_in_a' };
  if (right == null) return { field, a: left, b: null, status: 'missing_in_b' };

  if (typeof left === 'number' && typeof right === 'number') {
    const delta = right - left;
    const match = Math.abs(delta) < 0.01;
    return {
      field,
      a: left,
      b: right,
      status: match ? 'match' : 'diff',
      delta: match ? undefined : delta,
      deltaPct: match || left === 0 ? undefined : Math.round((delta / Math.abs(left)) * 10000) / 100,
    };
  }

  const same = String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
  return { field, a: left, b: right, status: same ? 'match' : 'diff' };
}

function card(parsed: ParsedInvoiceData, id: string | null) {
  return {
    id,
    vendorName: parsed.company_name ?? null,
    invoiceNumber: parsed.invoice_number ?? null,
    invoiceDate: parsed.invoice_date ?? null,
    total: parsed.totals_and_tax_summary?.grand_total_invoice ?? null,
  };
}

export function countLines(parts: LineDiff[], labour: LineDiff[]) {
  const all = [...parts, ...labour];
  return {
    matched: all.filter((l) => l.status === 'match').length,
    changed: all.filter((l) => l.status === 'same_item').length,
    missing: all.filter((l) => l.status === 'missing_in_b').length,
    extra: all.filter((l) => l.status === 'extra_in_b').length,
    aiPairs: all.filter((l) => l.how === 'ai').length,
  };
}

export function diffParsedInvoices(
  left: ParsedInvoiceData,
  right: ParsedInvoiceData,
  opts: {
    source: CompareResult['source'];
    idA?: string | null;
    idB?: string | null;
    aiPairs?: Array<{ group: 'parts' | 'labour'; a: number; b: number; confidence: number }>;
    aiSummary?: string | null;
  },
): CompareResult {
  const ta = left.totals_and_tax_summary ?? {};
  const tb = right.totals_and_tax_summary ?? {};
  const va = left.vehicle_details ?? {};
  const vb = right.vehicle_details ?? {};

  const header: FieldDiff[] = [
    scalar('company_name', left.company_name, right.company_name),
    scalar('gstin', left.gstin, right.gstin),
    scalar('pan', left.pan, right.pan),
    scalar('invoice_number', left.invoice_number, right.invoice_number),
    scalar('invoice_date', left.invoice_date, right.invoice_date),
    scalar('registration_number', va.registration_number, vb.registration_number),
    scalar('chassis_number', va.chassis_number, vb.chassis_number),
    scalar('odometer', va.mileage_odometer_reading, vb.mileage_odometer_reading),
  ];

  const totals: FieldDiff[] = [
    scalar('parts_total', ta.parts_total, tb.parts_total),
    scalar('labour_total', ta.labour_total, tb.labour_total),
    scalar('grand_total_invoice', ta.grand_total_invoice, tb.grand_total_invoice),
    scalar('sub_total_calculated', ta.sub_total_calculated, tb.sub_total_calculated),
    scalar('parts_discount', ta.parts_discount, tb.parts_discount),
    scalar('labour_discount', ta.labour_discount, tb.labour_discount),
  ];

  const partsA = (left.parts_line_items ?? []).map(toPartLine);
  const partsB = (right.parts_line_items ?? []).map(toPartLine);
  const labourA = (left.labour_service_line_items ?? []).map(toLabourLine);
  const labourB = (right.labour_service_line_items ?? []).map(toLabourLine);

  const partsMatch = matchNamedLines(partsA, partsB);
  const labourMatch = matchNamedLines(labourA, labourB);

  const partAi = (opts.aiPairs ?? []).filter((p) => p.group === 'parts');
  const labourAiPairs = (opts.aiPairs ?? []).filter((p) => p.group === 'labour');

  const partsAi = applyAiPairs(partsMatch.leftoverA, partsMatch.leftoverB, partAi);
  const labourAi = applyAiPairs(labourMatch.leftoverA, labourMatch.leftoverB, labourAiPairs);

  const parts = [
    ...partsMatch.lines,
    ...partsAi.lines,
    ...leftoversToDiffs(partsAi.leftoverA, partsAi.leftoverB),
  ];
  const labour = [
    ...labourMatch.lines,
    ...labourAi.lines,
    ...leftoversToDiffs(labourAi.leftoverA, labourAi.leftoverB),
  ];

  const counts = countLines(parts, labour);
  const result: CompareResult = {
    source: opts.source,
    invoiceA: card(left, opts.idA ?? null),
    invoiceB: card(right, opts.idB ?? null),
    header,
    totals,
    parts,
    labour,
    counts,
    summary: { rules: '', ai: opts.aiSummary ?? null },
    model: { provider: 'none', model: 'rules', used: false },
    validation: { acceptedAi: 0, rejectedAi: [], summaryOk: true, summaryIssues: [] },
    mismatches: [],
  };
  result.summary.rules = summarizeDiff(result);
  return result;
}

export function leftoverNames(parsedA: ParsedInvoiceData, parsedB: ParsedInvoiceData) {
  const parts = matchNamedLines(
    (parsedA.parts_line_items ?? []).map(toPartLine),
    (parsedB.parts_line_items ?? []).map(toPartLine),
  );
  const labour = matchNamedLines(
    (parsedA.labour_service_line_items ?? []).map(toLabourLine),
    (parsedB.labour_service_line_items ?? []).map(toLabourLine),
  );
  return { parts, labour };
}
